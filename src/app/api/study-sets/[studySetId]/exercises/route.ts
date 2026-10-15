import { z } from "zod";
import { prisma, jsonSafe } from "@/lib/db";
import { apiHandler, ok, parseJsonBody, requireSession } from "@/lib/api";
import { assertStudySetAccess } from "@/lib/access";
import { assertSourcesIndexed, startGeneration } from "@/lib/api/generations";

type Ctx = { params: { studySetId: string } };

export const GET = apiHandler<Ctx>(async (_req, { params }) => {
  const session = await requireSession();
  const studySet = await assertStudySetAccess(session.user.id, params.studySetId);
  const exerciseSets = await prisma.exerciseSet.findMany({
    where: { studySetId: studySet.id },
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { exercises: true } } },
  });
  return ok(jsonSafe({ exerciseSets }));
});

const generateSchema = z.object({
  title: z.string().max(160).optional(),
  topic: z.string().max(300).optional(),
  count: z.number().int().min(1).max(10).default(4),
  types: z
    .array(
      z.enum([
        "derivation",
        "quantitative",
        "proof",
        "algorithm_design",
        "code_completion",
        "code_debugging",
        "conceptual_transfer",
        "paper_critique",
      ]),
    )
    .optional(),
  difficulty: z.enum(["medium", "hard", "advanced"]).default("hard"),
  groundedOnly: z.boolean().default(false),
});

export const POST = apiHandler<Ctx>(async (req, { params }) => {
  const session = await requireSession();
  const studySet = await assertStudySetAccess(session.user.id, params.studySetId, "write");
  await assertSourcesIndexed(studySet.id);
  const body = await parseJsonBody(req, generateSchema);

  const exerciseSet = await prisma.exerciseSet.create({
    data: {
      studySetId: studySet.id,
      title: body.title ?? (body.topic ? `Exercises: ${body.topic}` : `${studySet.title} — problem set`),
      status: "QUEUED",
      config: { topic: body.topic, count: body.count, types: body.types, difficulty: body.difficulty, groundedOnly: body.groundedOnly },
    },
  });

  const { jobId } = await startGeneration({
    userId: session.user.id,
    studySetId: studySet.id,
    type: "GENERATE_EXERCISES",
    jobName: "generate.exercises",
    payload: { exerciseSetId: exerciseSet.id },
  });
  return ok({ exerciseSetId: exerciseSet.id, jobId }, { status: 202 });
});
