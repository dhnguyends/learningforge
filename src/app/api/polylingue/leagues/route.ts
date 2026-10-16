import { z } from "zod";
import { apiHandler, ok, parseJsonBody, requireSession } from "@/lib/api";
import { createLeague, myLeagues } from "@/lib/polylingue/habits-service";

const schema = z.object({ name: z.string().trim().min(2).max(40), nickname: z.string().trim().min(2).max(24) });

/** The learner's friends' leagues with this week's ranking. */
export const GET = apiHandler(async () => {
  const session = await requireSession();
  return ok(await myLeagues(session.user.id));
});

/** A new league: the learner joins it and gets its invite code. */
export const POST = apiHandler(async (req) => {
  const session = await requireSession();
  const league = await createLeague(session.user.id, await parseJsonBody(req, schema));
  return ok({ id: league.id, code: league.code }, { status: 201 });
});
