import { apiHandler, ok, requireSession } from "@/lib/api";
import { lessonForPlayer } from "@/lib/polylingue/service";

type Ctx = { params: { courseId: string; lessonId: string } };

/** A lesson ready to play (without its answers), or "being written" while the AI model prepares it. */
export const GET = apiHandler<Ctx>(async (_req, { params }) => {
  const session = await requireSession();
  return ok(await lessonForPlayer(session.user.id, params.courseId, params.lessonId));
});
