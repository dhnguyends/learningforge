import { prisma, jsonSafe } from "@/lib/db";
import { apiHandler, ok, requireSession, notFound, badRequest } from "@/lib/api";
import { assertStudySetAccess } from "@/lib/access";
import { audit } from "@/lib/audit";

type Ctx = { params: { exerciseId: string } };

/**
 * Explicit solution reveal. The tutor pipeline never calls this implicitly;
 * the UI asks for confirmation first (academic-integrity principle #7).
 */
export const POST = apiHandler<Ctx>(async (_req, { params }) => {
  const session = await requireSession();
  const exercise = await prisma.exercise.findUnique({ where: { id: params.exerciseId }, include: { exerciseSet: true } });
  if (!exercise) throw notFound("Exercise");
  await assertStudySetAccess(session.user.id, exercise.exerciseSet.studySetId);

  if (!exercise.solution) throw badRequest("This exercise has no stored solution.");
  await audit({ userId: session.user.id, action: "exercise.solution_revealed", entityType: "exercise", entityId: exercise.id });
  return ok(jsonSafe({ solution: exercise.solution }));
});
