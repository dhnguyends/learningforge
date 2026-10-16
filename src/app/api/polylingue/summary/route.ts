import { apiHandler, ok, requireSession, badRequest } from "@/lib/api";
import { weeklySummary } from "@/lib/polylingue/habits-service";

/** Weekly summary per language (?week=YYYY-MM-DD, any day of the week; last week by default). */
export const GET = apiHandler(async (req) => {
  const session = await requireSession();
  const week = new URL(req.url).searchParams.get("week");
  if (week && !/^\d{4}-\d{2}-\d{2}$/.test(week)) throw badRequest("week must be a date (YYYY-MM-DD).");
  return ok(await weeklySummary(session.user.id, week ?? undefined));
});
