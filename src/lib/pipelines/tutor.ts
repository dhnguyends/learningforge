import { prisma } from "@/lib/db";
import { getGenerator } from "@/lib/ai";
import { searchChunks, formatRetrievedContext, type RetrievedChunk } from "@/lib/retrieval";
import { createAnchorsForChunks } from "@/lib/pipelines/anchors";
import { tutorResponseSchema, type TutorResponse } from "@/lib/pipelines/schemas";
import { TUTOR_SYSTEM, TUTOR_SYSTEM_GENERAL, TUTOR_USER, PROMPT_VERSION } from "@/lib/prompts";
import { extractInlineChunkIds, resolveChunkRef } from "@/lib/pipelines/validation";
import { audit } from "@/lib/audit";
import { aiLabel } from "@/lib/ai/settings";

export type TutorMode = "answer" | "hint" | "explain_differently" | "show_source" | "challenge" | "reveal_solution";

export interface TutorResult {
  messageId: string;
  answer: string;
  claimType: TutorResponse["claimType"];
  foundInSources: boolean;
  followUpQuestion: string;
  warnings: string[];
  anchors: Array<{ id: string; excerpt: string; sourceTitle: string; sourceId: string }>;
  /** false: the learner turned source search off; the answer is general knowledge. */
  sourceSearch: boolean;
}

export async function answerTutorMessage(opts: {
  conversationId: string;
  question: string;
  mode: TutorMode;
  /**
   * Search the study set's sources (RAG, the default). false: no semantic
   * search and no passages in the prompt; the tutor answers from general
   * knowledge, labelled as such, without citations.
   */
  sourceSearch?: boolean;
}): Promise<TutorResult> {
  const sourceSearch = opts.sourceSearch !== false;
  if (!sourceSearch && opts.mode === "show_source") throw new Error("Show source needs source search");
  const conversation = await prisma.tutorConversation.findUnique({
    where: { id: opts.conversationId },
    include: {
      studySet: { select: { id: true, title: true, settings: true } },
      messages: { orderBy: { createdAt: "desc" }, take: 8 },
    },
  });
  if (!conversation) throw new Error("Conversation not found");
  const settings = conversation.studySet.settings as Record<string, unknown>;
  const allowExternal = settings.includeExternal === true;

  // Retrieve evidence (the "R" in RAG) — conversation-aware, see retrieveForTutor.
  // Skipped entirely when the learner turned source search off.
  const previousQuestion = conversation.messages.find((m) => m.role === "USER")?.content;
  const chunks: RetrievedChunk[] = sourceSearch ? await retrieveForTutor(conversation.studySet.id, opts.question, previousQuestion) : [];

  await prisma.tutorMessage.create({
    data: { conversationId: opts.conversationId, role: "USER", content: opts.question, metadata: { sourceSearch } },
  });

  const conversationExcerpt = conversation.messages
    .reverse()
    .map((m) => `${m.role === "USER" ? "Learner" : "Tutor"}: ${m.content.slice(0, 600)}`)
    .join("\n");

  const hintsUsed = opts.mode === "hint" ? conversation.hintsUsed + 1 : conversation.hintsUsed;

  const result = await (await getGenerator()).generate({
    system: sourceSearch ? TUTOR_SYSTEM : TUTOR_SYSTEM_GENERAL,
    user: TUTOR_USER({
      studySetTitle: conversation.studySet.title,
      mode: opts.mode,
      question: opts.question,
      hintsUsed,
      allowExternal,
      chunkContext: sourceSearch ? formatRetrievedContext(chunks) : "",
      conversationExcerpt,
      sourcesOff: !sourceSearch,
    }),
    schema: tutorResponseSchema,
    mock: () => (sourceSearch ? mockTutor(opts.mode, opts.question, chunks, hintsUsed, allowExternal) : mockGeneralTutor(opts.mode)),
  });
  const data = result.data;

  // Trust boundary: only citations that resolve to RETRIEVED chunks survive.
  // Models also cite inline ("[CHUNK 1] (id=…)", bare ids) — those are taken
  // out of the prose and turned into structured citations (citation chips).
  const chunkIds = chunks.map((c) => c.id);
  const inline = extractCitationsFromProse(data.answer, chunkIds);
  const citationById = new Map<string, { chunkId: string; excerpt?: string }>();
  for (const c of data.citations) {
    const id = resolveChunkRef(c.chunkId, chunkIds);
    if (id && !citationById.has(id)) citationById.set(id, { chunkId: id, excerpt: c.excerpt });
  }
  for (const id of inline.ids) if (!citationById.has(id)) citationById.set(id, { chunkId: id });
  const citations = [...citationById.values()];
  const citedChunks = citations.map((c) => chunks.find((ch) => ch.id === c.chunkId)!).filter(Boolean);
  const anchorIds = await createAnchorsForChunks(citedChunks.slice(0, 5));

  // Honest labels: an answer that cites nothing cannot claim to come from the
  // sources; with source search off it is general knowledge, whatever the model says.
  const foundInSources = sourceSearch && data.foundInSources && citedChunks.length > 0;
  const claimType = !sourceSearch
    ? "external"
    : data.claimType === "source_grounded" && citedChunks.length === 0
      ? "inference"
      : data.claimType;
  const warnings =
    sourceSearch && claimType !== data.claimType
      ? [...data.warnings, "No source passage was cited for this answer — verify it against your materials."]
      : data.warnings;
  const answer = inline.content;

  const message = await prisma.tutorMessage.create({
    data: {
      conversationId: opts.conversationId,
      role: "ASSISTANT",
      content: answer,
      claimType: claimType === "source_grounded" ? "SOURCE_GROUNDED" : claimType === "inference" ? "INFERENCE" : "EXTERNAL",
      mode: opts.mode,
      metadata: {
        foundInSources,
        warnings,
        sourceSearch,
        retrievalScores: chunks.slice(0, 5).map((c) => ({ chunkId: c.id, score: Number(c.score.toFixed(3)) })),
        provider: result.provider,
        // The model that wrote this answer, for the timer's tooltip ("DeepSeek-R1 8B · local").
        model: result.model,
        modelLabel: aiLabel({ provider: result.provider as never, model: result.model }),
        promptVersion: PROMPT_VERSION,
      },
      anchors: { connect: anchorIds.map((id) => ({ id })) },
    },
  });

  await prisma.tutorConversation.update({
    where: { id: opts.conversationId },
    data: { hintsUsed, updatedAt: new Date() },
  });
  await audit({
    action: "ai.generation",
    entityType: "tutor_conversation",
    entityId: opts.conversationId,
    metadata: { type: "tutor", mode: opts.mode, provider: result.provider, citedChunks: citations.length, sourceSearch },
  });

  const chunkTitles = new Map(chunks.map((c) => [c.id, c.sourceTitle]));
  return {
    messageId: message.id,
    answer,
    claimType,
    foundInSources,
    followUpQuestion: data.followUpQuestion,
    warnings,
    anchors: citedChunks.slice(0, 5).map((c, i) => ({
      id: anchorIds[i] ?? c.id,
      excerpt: citations.find((cit) => cit.chunkId === c.id)?.excerpt ?? c.content.slice(0, 160),
      sourceTitle: chunkTitles.get(c.id) ?? "Source",
      sourceId: c.sourceId,
    })),
    sourceSearch,
  };
}

/**
 * Conversation-aware retrieval. The question alone is searched first; when
 * there is an earlier learner message, "previous + current" is searched too
 * and the two result lists are merged (best score per chunk). A bare
 * follow-up like "Why?" used to retrieve nothing and the tutor answered
 * "I cannot find that in your uploaded sources" mid-conversation.
 */
export async function retrieveForTutor(studySetId: string, question: string, previousQuestion?: string): Promise<RetrievedChunk[]> {
  const k = 8;
  const direct = await searchChunks(studySetId, question, { k });
  if (!previousQuestion?.trim()) return direct;
  const contextual = await searchChunks(studySetId, `${previousQuestion.slice(0, 500)}\n${question}`, { k });
  const best = new Map<string, RetrievedChunk>();
  for (const c of [...direct, ...contextual]) {
    const seen = best.get(c.id);
    if (!seen || c.score > seen.score) best.set(c.id, c);
  }
  return [...best.values()].sort((a, b) => b.score - a.score).slice(0, k);
}

/**
 * Pull citation markers out of an answer: context headers the model copied
 * ("[CHUNK 3] (id=…, source=…, page 2)" — resolved by position, which also
 * rescues ids the model garbled), "(id=…)" parentheticals, and bare ids
 * (via extractInlineChunkIds). Returns the cleaned prose and the RETRIEVED
 * chunk ids cited, in order. Pure.
 */
export function extractCitationsFromProse(text: string, chunkIds: string[]): { content: string; ids: string[] } {
  const ids: string[] = [];
  const add = (id: string | null | undefined) => {
    if (id && chunkIds.includes(id) && !ids.includes(id)) ids.push(id);
  };
  let content = text
    .replace(/[ \t]*\[\s*CHUNK\s+(\d{1,3})\s*\](?:\s*\(([^)\n]{0,300})\))?/gi, (_m, n: string, paren?: string) => {
      const byPosition = chunkIds[Number(n) - 1];
      const byId = paren?.match(/id\s*=\s*([A-Za-z0-9_-]+)/i)?.[1];
      add(byPosition ?? (byId ? resolveChunkRef(byId, chunkIds) : null));
      return "";
    })
    .replace(/[ \t]*\(\s*id\s*=\s*([A-Za-z0-9_-]+)[^)\n]{0,300}\)/gi, (_m, id: string) => {
      add(resolveChunkRef(id, chunkIds));
      return "";
    });
  const bare = extractInlineChunkIds(content, chunkIds);
  bare.ids.forEach(add);
  content = bare.content.replace(/[ \t]+([.,;:!?])/g, "$1");
  return { content, ids };
}

function mockGeneralTutor(mode: TutorMode): TutorResponse {
  return {
    answer: `${mode === "hint" ? "A hint, from general knowledge:" : "From general knowledge (your sources were not searched):"} think about what the question asks you to relate, and which definition connects the two.\n\n*(Offline mock tutor — configure AI_PROVIDER for real answers.)*`,
    claimType: "external",
    citations: [],
    followUpQuestion: "Want to check this against your sources? Turn source search back on.",
    foundInSources: false,
    warnings: [],
  };
}

function mockTutor(mode: TutorMode, question: string, chunks: RetrievedChunk[], hintsUsed: number, allowExternal: boolean): TutorResponse {
  if (chunks.length === 0) {
    return {
      answer: `I cannot find that in your uploaded sources.\n\n${
        allowExternal
          ? "You have external knowledge enabled — but with no matching chunks I have nothing verified to add. Try rephrasing using the lecture's own terminology."
          : "This study set is in source-only mode, so I will not answer from general knowledge. Try rephrasing using the lecture's own terminology."
      }`,
      claimType: "source_grounded",
      citations: [],
      followUpQuestion: "Which of your sources should cover this — the video, the slides, or the paper?",
      foundInSources: false,
      warnings: ["Offline mock tutor: no chunk passed the relevance threshold."],
    };
  }
  const top = chunks[0];
  const loc = top.startMs != null ? `${Math.floor(top.startMs / 60000)}m${String(Math.floor((top.startMs % 60000) / 1000)).padStart(2, "0")}s` : `page ${top.page ?? 1}`;
  const citations = chunks.slice(0, 3).map((c) => ({ chunkId: c.id, excerpt: c.content.slice(0, 140) }));

  const modeText: Record<TutorMode, string> = {
    answer: `Here is what your sources say about that:`,
    hint: `Hint ${Math.min(hintsUsed, 3)} — look at:`,
    explain_differently: `Let me point you at the source and put it another way:`,
    show_source: `The source passage to read is:`,
    challenge: `Before I answer — a challenge for you first. Study this passage, then predict:`,
    reveal_solution: `Working from the source (full reveal):`,
  };

  return {
    answer: `${modeText[mode]}\n\n> ${top.content.slice(0, 480)}\n\n_Source: **${top.sourceTitle}** (${loc})_\n\n${
      mode === "hint"
        ? "Try extracting the key relationship from that passage before asking for more."
        : mode === "challenge"
          ? "Can you state the claim in your own words before I confirm it?"
          : "Does that match your mental model, or should I go one step deeper?"
    }\n\n*(Offline mock tutor — configure AI_PROVIDER for Socratic synthesis.)*`,
    claimType: "source_grounded",
    citations,
    followUpQuestion: "Want the next logical step, or a challenge question on this?",
    foundInSources: true,
    warnings: [],
  };
}
