import { apiHandler, ok, requireSession } from "@/lib/api";
import { progressStats } from "@/lib/polylingue/service";

type Ctx = { params: { courseId: string } };

/** Progress page: XP, streaks, lessons, words, accuracy, the last 35 days and the words to strengthen. */
export const GET = apiHandler<Ctx>(async (_req, { params }) => {
  const session = await requireSession();
  return ok(await progressStats(session.user.id, params.courseId));
});
