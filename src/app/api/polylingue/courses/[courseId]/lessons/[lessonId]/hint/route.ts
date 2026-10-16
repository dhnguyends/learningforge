import { z } from "zod";
import { apiHandler, ok, parseJsonBody, requireSession } from "@/lib/api";
import { hintForExercise } from "@/lib/polylingue/service";

type Ctx = { params: { courseId: string; lessonId: string } };

const schema = z.object({ index: z.number().int().min(0).max(50) });

/** A hint for one exercise (never the answer); using it halves the exercise's XP. */
export const POST = apiHandler<Ctx>(async (req, { params }) => {
  const session = await requireSession();
  const { index } = await parseJsonBody(req, schema);
  return ok(await hintForExercise(session.user.id, params.courseId, params.lessonId, index));
});
