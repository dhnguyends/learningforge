import { z } from "zod";
import { apiHandler, ok, parseJsonBody, requireSession } from "@/lib/api";
import { answerPractice } from "@/lib/polylingue/practice-service";

type Ctx = { params: { courseId: string; practiceId: string } };

const schema = z.object({
  part: z.enum(["question", "dictation"]),
  index: z.number().int().min(0).max(50),
  answer: z.string().max(500),
});

/** Reading / listening question or dictation sentence: instant correction with XP. */
export const POST = apiHandler<Ctx>(async (req, { params }) => {
  const session = await requireSession();
  return ok(await answerPractice(session.user.id, params.courseId, params.practiceId, await parseJsonBody(req, schema)));
});
