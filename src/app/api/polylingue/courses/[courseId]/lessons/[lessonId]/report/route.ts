import { z } from "zod";
import { apiHandler, ok, parseJsonBody, requireSession, rateLimited } from "@/lib/api";
import { rateLimit } from "@/lib/rate-limit";
import { REPORT_REASONS, reportExercise } from "@/lib/polylingue/review";

type Ctx = { params: { courseId: string; lessonId: string } };

const schema = z.object({ index: z.number().int().min(0).max(50), reason: z.enum(REPORT_REASONS), comment: z.string().trim().max(500).optional() });

/** "Report a problem" with one exercise; 3 learners' reports hide it until an admin reviews it. */
export const POST = apiHandler<Ctx>(async (req, { params }) => {
  const session = await requireSession();
  const limit = rateLimit(`polylingue-report:${session.user.id}`, 30);
  if (!limit.allowed) throw rateLimited(limit.retryAfterSec);
  return ok(await reportExercise(session.user.id, params.courseId, params.lessonId, await parseJsonBody(req, schema)), { status: 201 });
});
