import { z } from "zod";
import { apiHandler, ok, parseJsonBody, requireSession, rateLimited, badRequest } from "@/lib/api";
import { rateLimit } from "@/lib/rate-limit";
import { joinClass, previewJoin } from "@/lib/polylingue/classes-service";
import { isValidTimeZone } from "@/lib/polylingue/progress";

const schema = z.object({ code: z.string().trim().min(6).max(12), timeZone: z.string().max(64).default("UTC") });

function slowDown(userId: string) {
  // Codes are short: slow down guessing.
  const limit = rateLimit(`class-join:${userId}`, 20, 10 * 60_000);
  if (!limit.allowed) throw rateLimited(limit.retryAfterSec);
}

/** What joining this class means (shown before confirming). */
export const GET = apiHandler(async (req) => {
  const session = await requireSession();
  slowDown(session.user.id);
  return ok(await previewJoin(session.user.id, new URL(req.url).searchParams.get("code") ?? ""));
});

/** Joins the class; the course in its language follows the class. */
export const POST = apiHandler(async (req) => {
  const session = await requireSession();
  slowDown(session.user.id);
  const body = await parseJsonBody(req, schema);
  if (!isValidTimeZone(body.timeZone)) throw badRequest("Unknown time zone.");
  return ok(await joinClass(session.user.id, body));
});
