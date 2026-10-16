import { z } from "zod";
import { apiHandler, ok, parseJsonBody, requireSession } from "@/lib/api";
import { answerWeakWord, weakWordsSession } from "@/lib/polylingue/service";

type Ctx = { params: { courseId: string } };

/** A short session on the learner's weakest words (from their own lessons, no AI). */
export const GET = apiHandler<Ctx>(async (_req, { params }) => {
  const session = await requireSession();
  return ok(await weakWordsSession(session.user.id, params.courseId));
});

const schema = z.object({ cardId: z.string().min(1), kind: z.enum(["choose", "listen", "type"]), answer: z.string().max(200) });

/** Checks one answer and grades the word's spaced-repetition card. */
export const POST = apiHandler<Ctx>(async (req, { params }) => {
  const session = await requireSession();
  return ok(await answerWeakWord(session.user.id, params.courseId, await parseJsonBody(req, schema)));
});
