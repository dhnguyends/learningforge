import { z } from "zod";
import { apiHandler, ok, parseJsonBody, requireSession, rateLimited } from "@/lib/api";
import { rateLimit } from "@/lib/rate-limit";
import { joinLeague } from "@/lib/polylingue/habits-service";

const schema = z.object({ code: z.string().trim().min(6).max(12), nickname: z.string().trim().min(2).max(24) });

/** Join a league with its invite code (opt-in). */
export const POST = apiHandler(async (req) => {
  const session = await requireSession();
  // Codes are short: slow down guessing.
  const limit = rateLimit(`league-join:${session.user.id}`, 10, 10 * 60_000);
  if (!limit.allowed) throw rateLimited(limit.retryAfterSec);
  const league = await joinLeague(session.user.id, await parseJsonBody(req, schema));
  return ok({ id: league.id, name: league.name });
});
