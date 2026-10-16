import { z } from "zod";
import { apiHandler, ok, parseJsonBody, requireSession } from "@/lib/api";
import { dueCards, gradeCard } from "@/lib/polylingue/service";

type Ctx = { params: { courseId: string } };

/** Words due for review (spaced repetition). */
export const GET = apiHandler<Ctx>(async (_req, { params }) => {
  const session = await requireSession();
  return ok({ cards: await dueCards(session.user.id, params.courseId) });
});

const gradeSchema = z.object({
  cardId: z.string().min(1),
  grade: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
  seconds: z.number().min(0).max(3600).default(0),
});

/** Grade one word (Again / Hard / Good / Easy): schedules its next review. */
export const POST = apiHandler<Ctx>(async (req, { params }) => {
  const session = await requireSession();
  const { cardId, grade, seconds } = await parseJsonBody(req, gradeSchema);
  return ok(await gradeCard(session.user.id, params.courseId, cardId, { grade, seconds }));
});
