import { apiHandler, ok, requireSession } from "@/lib/api";
import { deletePracticeRecordings, practiceRecordings } from "@/lib/polylingue/recordings";

type Ctx = { params: { courseId: string; practiceId: string } };

/** The learner's kept spoken answers of a speaking practice: latest and best per item. */
export const GET = apiHandler<Ctx>(async (_req, { params }) => {
  const session = await requireSession();
  return ok(await practiceRecordings(session.user.id, params.courseId, params.practiceId));
});

/** Deletes them (rows and audio files). */
export const DELETE = apiHandler<Ctx>(async (_req, { params }) => {
  const session = await requireSession();
  return ok({ deleted: await deletePracticeRecordings(session.user.id, params.courseId, params.practiceId) });
});
