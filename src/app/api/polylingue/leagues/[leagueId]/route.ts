import { apiHandler, ok, requireSession } from "@/lib/api";
import { leaveLeague } from "@/lib/polylingue/habits-service";

type Ctx = { params: { leagueId: string } };

/** Leave a league (the last member leaving deletes it). */
export const DELETE = apiHandler<Ctx>(async (_req, { params }) => {
  const session = await requireSession();
  await leaveLeague(session.user.id, params.leagueId);
  return ok({ ok: true });
});
