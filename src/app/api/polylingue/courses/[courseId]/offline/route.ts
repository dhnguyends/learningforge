import { apiHandler, ok, requireSession } from "@/lib/api";
import { offlinePackage } from "@/lib/polylingue/offline";

type Ctx = { params: { courseId: string } };

/** The next lessons to play offline (with their answers) and the audio to cache. */
export const GET = apiHandler<Ctx>(async (_req, { params }) => {
  const session = await requireSession();
  return ok(await offlinePackage(session.user.id, params.courseId));
});
