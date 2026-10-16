import { z } from "zod";
import { apiHandler, ok, parseJsonBody, requireSession } from "@/lib/api";
import { answerExercise } from "@/lib/polylingue/service";

type Ctx = { params: { courseId: string; lessonId: string } };

const schema = z.object({
  index: z.number().int().min(0).max(50),
  answer: z.string().max(500),
  /** A missed exercise coming back at the end of the lesson. */
  retry: z.boolean().default(false),
  /** The learner asked for a hint: half the XP. */
  hinted: z.boolean().default(false),
});

/** Instant correction: verdict, the correct answer, a one-line explanation and the XP earned. */
export const POST = apiHandler<Ctx>(async (req, { params }) => {
  const session = await requireSession();
  const input = await parseJsonBody(req, schema);
  return ok(await answerExercise(session.user.id, params.courseId, params.lessonId, input));
});
