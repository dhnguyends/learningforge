import { z } from "zod";
import { prisma, jsonSafe } from "@/lib/db";
import { apiHandler, ok, parseJsonBody, requireSession } from "@/lib/api";
import { assertStudySetAccess } from "@/lib/access";
import { startGeneration } from "@/lib/api/generations";
import { recommendDifficulty } from "@/lib/pipelines/grading";

type Ctx = { params: { studySetId: string } };

export const GET = apiHandler<Ctx>(async (_req, { params }) => {
  const session = await requireSession();
  const studySet = await assertStudySetAccess(session.user.id, params.studySetId);
  const quizzes = await prisma.quiz.findMany({
    where: { studySetId: studySet.id },
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { questions: true } } },
  });
  return ok(jsonSafe({ quizzes }));
});

const generateSchema = z.object({
  title: z.string().max(160).optional(),
  topic: z.string().max(300).optional(),
  sourceIds: z.array(z.string()).optional(),
  count: z.number().int().min(3).max(30).default(8),
  types: z
    .array(
      z.enum([
        "multiple_choice",
        "multi_select",
        "short_answer",
        "ordering",
        "matching",
        "derivation_steps",
        "code_tracing",
        "numerical",
      ]),
    )
    .optional(),
  difficulty: z.enum(["easy", "medium", "hard", "advanced", "adaptive"]).default("adaptive"),
});

export const POST = apiHandler<Ctx>(async (req, { params }) => {
  const session = await requireSession();
  const studySet = await assertStudySetAccess(session.user.id, params.studySetId, "write");
  const body = await parseJsonBody(req, generateSchema);

  // Adaptive: pick difficulty from the learner's mastery metrics (transparently recorded).
  let difficulty = body.difficulty;
  let adaptiveReason: string | undefined;
  if (difficulty === "adaptive") {
    const metrics = await prisma.progressMetric.findMany({
      where: { studySetId: studySet.id, userId: session.user.id },
      select: { topic: true, mastery: true, attempts: true },
    });
    const rec = recommendDifficulty(metrics);
    difficulty = rec.difficulty;
    adaptiveReason = rec.reason;
  }

  const quiz = await prisma.quiz.create({
    data: {
      studySetId: studySet.id,
      title: body.title ?? (body.topic ? `Quiz: ${body.topic}` : `${studySet.title} — quiz`),
      status: "QUEUED",
      config: { topic: body.topic, sourceIds: body.sourceIds, count: body.count, types: body.types, difficulty, adaptiveReason },
    },
  });

  const { jobId } = await startGeneration({
    userId: session.user.id,
    studySetId: studySet.id,
    type: "GENERATE_QUIZ",
    jobName: "generate.quiz",
    payload: { quizId: quiz.id },
  });
  return ok({ quizId: quiz.id, jobId, difficulty, adaptiveReason }, { status: 202 });
});
