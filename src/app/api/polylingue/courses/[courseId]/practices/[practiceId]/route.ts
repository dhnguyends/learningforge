import { apiHandler, ok, requireSession } from "@/lib/api";
import { practiceForLearner } from "@/lib/polylingue/practice-service";

type Ctx = { params: { courseId: string; practiceId: string } };

/** A practice ready to play (answers hidden), or "being written" while the AI model prepares it. */
export const GET = apiHandler<Ctx>(async (_req, { params }) => {
  const session = await requireSession();
  return ok(await practiceForLearner(session.user.id, params.courseId, params.practiceId));
});
