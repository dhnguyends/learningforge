import { z } from "zod";
import { apiHandler, ok, parseJsonBody, requireSession } from "@/lib/api";
import { submitWriting } from "@/lib/polylingue/practice-service";

type Ctx = { params: { courseId: string; practiceId: string } };

const schema = z.object({
  index: z.number().int().min(0).max(10),
  text: z.string().trim().min(1, "Write something first").max(4000),
});

/** Writing task corrected by the AI model: score, corrected text, explanations, feedback and a model answer. */
export const POST = apiHandler<Ctx>(async (req, { params }) => {
  const session = await requireSession();
  return ok(await submitWriting(session.user.id, params.courseId, params.practiceId, await parseJsonBody(req, schema)));
});
