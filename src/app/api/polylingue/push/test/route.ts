import { apiHandler, ok, requireSession, rateLimited } from "@/lib/api";
import { rateLimit } from "@/lib/rate-limit";
import { sendPush } from "@/lib/polylingue/push";

/** A test notification to every browser of the learner. */
export const POST = apiHandler(async () => {
  const session = await requireSession();
  const limit = rateLimit(`push-test:${session.user.id}`, 5, 5 * 60_000);
  if (!limit.allowed) throw rateLimited(limit.retryAfterSec);
  const sent = await sendPush(session.user.id, {
    title: "PolyLingue reminders are on",
    body: "This is how your daily reminder will look.",
    url: "/polylingue",
    tag: "polylingue-test",
  });
  return ok({ sent });
});
