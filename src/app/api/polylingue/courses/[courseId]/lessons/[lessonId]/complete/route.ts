import { z } from "zod";
import { apiHandler, ok, parseJsonBody, requireSession } from "@/lib/api";
import { completeLesson } from "@/lib/polylingue/service";

type Ctx = { params: { courseId: string; lessonId: string } };

const schema = z.object({
  firstTryCorrect: z.number().int().min(0).max(50),
  total: z.number().int().min(1).max(50),
  seconds: z.number().min(0).max(24 * 3600),
});

/** Lesson finished: score, bonus XP, time towards the daily goal, and its words added to review. */
export const POST = apiHandler<Ctx>(async (req, { params }) => {
  const session = await requireSession();
  const input = await parseJsonBody(req, schema);
  return ok(await completeLesson(session.user.id, params.courseId, params.lessonId, input));
});
