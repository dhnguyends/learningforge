import { apiHandler, ok, requireTeacher, rateLimited } from "@/lib/api";
import { rateLimit } from "@/lib/rate-limit";
import { classDifficulties, suggestActivities } from "@/lib/polylingue/classes-service";

type Ctx = { params: { classId: string } };

/** What the class misses most (words, exercises, grammar) and the suggested activities. */
export const GET = apiHandler<Ctx>(async (_req, { params }) => {
  const session = await requireTeacher();
  return ok(await classDifficulties(session.user.id, params.classId));
});

/** Writes (again) the suggested in-class activities with the AI model. */
export const POST = apiHandler<Ctx>(async (_req, { params }) => {
  const session = await requireTeacher();
  const limit = rateLimit(`class-activities:${session.user.id}`, 20);
  if (!limit.allowed) throw rateLimited(limit.retryAfterSec);
  return ok(await suggestActivities(session.user.id, params.classId));
});
