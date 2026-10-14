import { prisma } from "@/lib/db";
import { getGenerator } from "@/lib/ai";
import { searchChunks, formatRetrievedContext, type RetrievedChunk } from "@/lib/retrieval";
import { createAnchorsForChunks } from "@/lib/pipelines/anchors";
import { tutorResponseSchema, type TutorResponse } from "@/lib/pipelines/schemas";
import { TUTOR_SYSTEM, TUTOR_USER, PROMPT_VERSION } from "@/lib/prompts";
import { audit } from "@/lib/audit";

export type TutorMode = "answer" | "hint" | "explain_differently" | "show_source" | "challenge" | "reveal_solution";

export interface TutorResult {
  messageId: string;
  answer: string;
  claimType: TutorResponse["claimType"];
  foundInSources: boolean;
  followUpQuestion: string;
  warnings: string[];
  anchors: Array<{ id: string; excerpt: string; sourceTitle: string; sourceId: string }>;
}

export async function answerTutorMessage(opts: {
  conversationId: string;
  question: string;
  mode: TutorMode;
}): Promise<TutorResult> {
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

  // Retrieve evidence for this question.
  const chunks: RetrievedChunk[] = await searchChunks(conversation.studySet.id, opts.question, { k: 8, minScore: 0.04 });

  await prisma.tutorMessage.create({
    data: { conversationId: opts.conversationId, role: "USER", content: opts.question },
  });

  const conversationExcerpt = conversation.messages
    .reverse()
    .map((m) => `${m.role === "USER" ? "Learner" : "Tutor"}: ${m.content.slice(0, 600)}`)
    .join("\n");

  const hintsUsed = opts.mode === "hint" ? conversation.hintsUsed + 1 : conversation.hintsUsed;

  const result = await getGenerator().generate({
    system: TUTOR_SYSTEM,
    user: TUTOR_USER({
      studySetTitle: conversation.studySet.title,
      mode: opts.mode,
      question: opts.question,
      hintsUsed,
      allowExternal,
      chunkContext: formatRetrievedContext(chunks),
      conversationExcerpt,
    }),
    schema: tutorResponseSchema,
    mock: () => mockTutor(opts.mode, opts.question, chunks, hintsUsed, allowExternal),
  });
  const data = result.data;

  // Trust boundary: only keep citations that point at retrieved chunks.
  const validIds = new Set(chunks.map((c) => c.id));
  const citations = data.citations.filter((c) => validIds.has(c.chunkId));
  const citedChunks = citations.map((c) => chunks.find((ch) => ch.id === c.chunkId)!).filter(Boolean);
  const anchorIds = await createAnchorsForChunks(citedChunks.slice(0, 5));

  const message = await prisma.tutorMessage.create({
    data: {
      conversationId: opts.conversationId,
      role: "ASSISTANT",
      content: data.answer,
      claimType: data.claimType === "source_grounded" ? "SOURCE_GROUNDED" : data.claimType === "inference" ? "INFERENCE" : "EXTERNAL",
      mode: opts.mode,
      metadata: {
        foundInSources: data.foundInSources && chunks.length > 0,
        warnings: data.warnings,
        retrievalScores: chunks.slice(0, 5).map((c) => ({ chunkId: c.id, score: Number(c.score.toFixed(3)) })),
        provider: result.provider,
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
    metadata: { type: "tutor", mode: opts.mode, provider: result.provider, citedChunks: citations.length },
  });

  const chunkTitles = new Map(chunks.map((c) => [c.id, c.sourceTitle]));
  return {
    messageId: message.id,
    answer: data.answer,
    claimType: data.claimType,
    foundInSources: data.foundInSources && chunks.length > 0,
    followUpQuestion: data.followUpQuestion,
    warnings: data.warnings,
    anchors: citedChunks.slice(0, 5).map((c, i) => ({
      id: anchorIds[i] ?? c.id,
      excerpt: citations.find((cit) => cit.chunkId === c.id)?.excerpt ?? c.content.slice(0, 160),
      sourceTitle: chunkTitles.get(c.id) ?? "Source",
      sourceId: c.sourceId,
    })),
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
