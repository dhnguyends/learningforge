import { prisma, jsonSafe } from "@/lib/db";
import { apiHandler, ok, requireSession, notFound } from "@/lib/api";
import { assertStudySetAccess } from "@/lib/access";

type Ctx = { params: { exerciseSetId: string } };

/**
 * Exercises WITHOUT solutions — full solutions are revealed only through the
 * explicit reveal endpoint. Hints are included (UI releases them one at a time).
 */
export const GET = apiHandler<Ctx>(async (_req, { params }) => {
  const session = await requireSession();
  const exerciseSet = await prisma.exerciseSet.findUnique({
    where: { id: params.exerciseSetId },
    include: {
      exercises: {
        orderBy: { ordinal: "asc" },
        include: { anchors: { include: { source: { select: { id: true, title: true, type: true } } } } },
      },
    },
  });
  if (!exerciseSet) throw notFound("Exercise set");
  await assertStudySetAccess(session.user.id, exerciseSet.studySetId);

  return ok(
    jsonSafe({
      exerciseSet: {
        id: exerciseSet.id,
        title: exerciseSet.title,
        status: exerciseSet.status,
        config: exerciseSet.config,
        exercises: exerciseSet.exercises.map((e) => ({
          id: e.id,
          ordinal: e.ordinal,
          type: e.type,
          title: e.title,
          prompt: e.prompt,
          prerequisites: e.prerequisites,
          assumptions: e.assumptions,
          requiredKnowledge: e.requiredKnowledge,
          expectedOutput: e.expectedOutput,
          estimatedMinutes: e.estimatedMinutes,
          difficulty: e.difficulty,
          grounded: e.grounded,
          hints: e.hints,
          warnings: e.warnings,
          anchors: e.anchors,
          hasSolution: Boolean(e.solution),
        })),
      },
    }),
  );
});
