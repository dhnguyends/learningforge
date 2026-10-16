import { z } from "zod";
import { apiHandler, ok, parseJsonBody, requireSession } from "@/lib/api";
import { addWordToReview } from "@/lib/polylingue/practice-service";

type Ctx = { params: { courseId: string } };

const schema = z.object({
  term: z.string().trim().min(1).max(80),
  translation: z.string().trim().min(1).max(160),
  example: z.string().max(240).optional(),
});

/** Adds a word met in practice (for example tapped in a reading text) to spaced review. */
export const POST = apiHandler<Ctx>(async (req, { params }) => {
  const session = await requireSession();
  return ok(await addWordToReview(session.user.id, params.courseId, await parseJsonBody(req, schema)));
});
