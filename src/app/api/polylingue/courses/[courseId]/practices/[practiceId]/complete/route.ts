import { z } from "zod";
import { apiHandler, ok, parseJsonBody, requireSession } from "@/lib/api";
import { completePractice } from "@/lib/polylingue/practice-service";

type Ctx = { params: { courseId: string; practiceId: string } };

const schema = z.object({ score: z.number().min(0).max(100), seconds: z.number().min(0).max(24 * 3600) });

/** Practice finished: score, bonus XP and time; a listening practice reveals its transcript. */
export const POST = apiHandler<Ctx>(async (req, { params }) => {
  const session = await requireSession();
  return ok(await completePractice(session.user.id, params.courseId, params.practiceId, await parseJsonBody(req, schema)));
});
