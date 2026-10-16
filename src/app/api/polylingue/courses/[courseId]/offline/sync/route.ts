import { z } from "zod";
import { apiHandler, ok, parseJsonBody, requireSession } from "@/lib/api";
import { syncOfflineLesson } from "@/lib/polylingue/offline";

type Ctx = { params: { courseId: string } };

const schema = z.object({
  syncId: z.string().min(8).max(64),
  lessonId: z.string().min(1).max(64),
  answers: z
    .array(z.object({ index: z.number().int().min(0).max(50), answer: z.string().max(500), retry: z.boolean(), hinted: z.boolean().optional() }))
    .max(120),
  complete: z.object({ firstTryCorrect: z.number().int().min(0).max(50), total: z.number().int().min(1).max(50), seconds: z.number().min(0).max(24 * 3600) }).nullable(),
});

/** A lesson played offline, sent once back online (applied once per sync id). */
export const POST = apiHandler<Ctx>(async (req, { params }) => {
  const session = await requireSession();
  const input = await parseJsonBody(req, schema);
  return ok(await syncOfflineLesson(session.user.id, params.courseId, input));
});
