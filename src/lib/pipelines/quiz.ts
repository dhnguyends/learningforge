import { prisma } from "@/lib/db";
import { getGenerator } from "@/lib/ai";
import { searchChunks, retrieveForWholeSet, formatRetrievedContext, emptyRetrievalError, type RetrievedChunk } from "@/lib/retrieval";
import { createAnchorsForChunks } from "@/lib/pipelines/anchors";
import { quizSchema, type QuizQuestionDraft } from "@/lib/pipelines/schemas";
import { validateQuizQuestion, resolveChunkRef, normalizeQuizQuestion } from "@/lib/pipelines/validation";
import { QUIZ_SYSTEM, QUIZ_USER, PROMPT_VERSION } from "@/lib/prompts";
import type { JobContext } from "@/lib/queue/types";
import { audit } from "@/lib/audit";

interface QuizJobPayload {
  studySetId: string;
  quizId: string;
  generationJobId?: string;
}

export async function generateQuizJob(ctx: JobContext<QuizJobPayload>): Promise<void> {
  const { quizId } = ctx.payload;
  const quiz = await prisma.quiz.findUnique({
    where: { id: quizId },
    include: { studySet: { select: { id: true, title: true } } },
  });
  if (!quiz) throw new Error(`Quiz ${quizId} not found`);
  const config = quiz.config as { topic?: string; count?: number; types?: string[]; difficulty?: string; sourceIds?: string[] };

  await ctx.updateStage("retrieving-sources", 15);
  // An explicit topic is a real query; without one the quiz covers the set.
  const chunks = config.topic
    ? await searchChunks(quiz.studySet.id, config.topic, { k: 18, sourceIds: config.sourceIds })
    : await retrieveForWholeSet(quiz.studySet.id, quiz.studySet.title, { k: 18, sourceIds: config.sourceIds });
  if (chunks.length === 0) throw await emptyRetrievalError(quiz.studySet.id);

  await ctx.updateStage("generating-questions", 45);
  const result = await getGenerator().generate({
    system: QUIZ_SYSTEM,
    user: QUIZ_USER({
      studySetTitle: quiz.studySet.title,
      count: config.count ?? 8,
      topic: config.topic,
      types: config.types,
      difficulty: config.difficulty,
      chunkContext: formatRetrievedContext(chunks),
    }),
    schema: quizSchema,
    mock: () => mockQuiz(quiz.studySet.title, chunks, config.count ?? 8),
  });

  await ctx.updateStage("validating", 80);
  const chunkIds = chunks.map((c) => c.id);
  const chunkById = new Map(chunks.map((c) => [c.id, c] as const));
  const cited = result.data.questions
    .map((q) => ({ ...q, chunkId: resolveChunkRef(q.chunkId, chunkIds) ?? "" }))
    .filter((q) => chunkById.has(q.chunkId));
  // Only answerable, gradable questions are stored (see normalizeQuizQuestion).
  const drafts: Array<(typeof cited)[number]> = [];
  const dropped: string[] = [];
  for (const q of cited) {
    const n = normalizeQuizQuestion(q);
    if ("dropped" in n) dropped.push(n.dropped);
    else drafts.push({ ...n.question, warnings: n.note ? [...n.question.warnings, n.note] : n.question.warnings });
  }
  if (dropped.length) ctx.log(`dropped ${dropped.length} malformed question(s)`, { reasons: dropped });

  await prisma.quizQuestion.deleteMany({ where: { quizId } });
  let ordinal = 0;
  for (const draft of drafts) {
    const warnings = validateQuizQuestion(draft);
    const chunk = chunkById.get(draft.chunkId)!;
    const anchorIds = await createAnchorsForChunks([chunk]);
    await prisma.quizQuestion.create({
      data: {
        quizId,
        ordinal: ordinal++,
        type: draft.type.toUpperCase() as never,
        stem: draft.stem,
        options: (draft.options.length ? draft.options : undefined) as object | undefined,
        answer: draft.answer as object,
        explanation: draft.explanation,
        distractorRationale: (draft.distractorRationale ?? undefined) as object | undefined,
        learningObjective: draft.learningObjective,
        difficulty: draft.difficulty.toUpperCase() as never,
        warnings,
        anchors: { connect: anchorIds.map((id) => ({ id })) },
      },
    });
  }
  if (ordinal === 0) {
    throw new Error(
      result.data.questions.length > cited.length
        ? "Generation produced no questions citing the provided sources. Try again."
        : `Generation produced no answerable questions (${dropped.length} malformed: ${[...new Set(dropped)].slice(0, 2).join("; ")}). Try again.`,
    );
  }

  await prisma.quiz.update({
    where: { id: quizId },
    data: {
      status: "READY",
      title: result.data.title,
      generatedAt: new Date(),
      config: { ...config, promptVersion: PROMPT_VERSION, provider: result.provider, mock: result.provider === "mock" },
    },
  });
  await audit({
    action: "ai.generation",
    entityType: "quiz",
    entityId: quizId,
    metadata: { type: "quiz", questions: ordinal, provider: result.provider, promptVersion: PROMPT_VERSION },
  });
  await ctx.updateStage("complete", 100);
}

/** Builds a real, grounded quiz by using one chunk as the correct answer and sibling excerpts as distractors. */
function mockQuiz(title: string, chunks: RetrievedChunk[], count: number) {
  const questions: QuizQuestionDraft[] = [];
  const usable = chunks.filter((c) => c.content.length > 120);
  for (let i = 0; i < Math.min(count, Math.max(usable.length, 1)); i++) {
    const chunk = usable[i % Math.max(usable.length, 1)];
    const distractors = usable
      .filter((c) => c.id !== chunk.id)
      .slice(0, 3)
      .map((c, j) => ({ id: `opt${j + 2}`, text: excerpt(c.content, 140) }));
    const statement = excerpt(chunk.content, 160);
    questions.push({
      type: "multiple_choice",
      stem: `Which statement comes directly from your source "${chunk.sourceTitle}"${
        chunk.startMs != null ? ` around ${Math.floor(chunk.startMs / 60000)}m` : chunk.page != null ? ` (page ${chunk.page})` : ""
      }?`,
      options: [{ id: "opt1", text: statement }, ...distractors],
      answer: { correctIds: ["opt1"] },
      explanation: `The cited chunk states: "${statement}" — verify against the source. (Offline mock question; configure AI_PROVIDER for concept-level questions.)`,
      distractorRationale: Object.fromEntries(distractors.map((d) => [d.id, "This text comes from a different part of your sources."])),
      learningObjective: `Recognize source-grounded statements about ${topicOf(chunk.content)}`,
      difficulty: "medium",
      chunkId: chunk.id,
      warnings: ["Generated by the offline mock generator."],
    });
  }
  return { title: `${title} — source recognition quiz (mock)`, questions };
}

function excerpt(text: string, len: number): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length <= len ? clean : `${clean.slice(0, len - 1)}…`;
}

function topicOf(content: string): string {
  const words = content.replace(/[^A-Za-z0-9\s]/g, " ").split(/\s+/).filter((w) => w.length > 5);
  return (words.slice(0, 3).join(" ") || "the material").toLowerCase();
}
