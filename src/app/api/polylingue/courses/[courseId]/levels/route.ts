import { apiHandler, ok, requireSession } from "@/lib/api";
import { levelOptions } from "@/lib/polylingue/service";

type Ctx = { params: { courseId: string } };

/** Levels the course can switch to, and whether each level's shared course is ready. */
export const GET = apiHandler<Ctx>(async (_req, { params }) => {
  const session = await requireSession();
  return ok(await levelOptions(session.user.id, params.courseId));
});
