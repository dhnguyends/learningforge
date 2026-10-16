import { z } from "zod";
import { apiHandler, ok, parseJsonBody, requireSession, badRequest } from "@/lib/api";
import { pushConfigured, removeSubscription, saveSubscription } from "@/lib/polylingue/push";
import { updateReminderSettings } from "@/lib/polylingue/habits-service";

const subscription = z.object({
  endpoint: z
    .string()
    .url()
    .max(1000)
    .refine((u) => u.startsWith("https://"), "The push endpoint must use https"),
  keys: z.object({ p256dh: z.string().min(16).max(200), auth: z.string().min(8).max(100) }),
});

/** This browser receives the learner's reminders (browser notifications on). */
export const POST = apiHandler(async (req) => {
  const session = await requireSession();
  if (!pushConfigured()) throw badRequest("Browser notifications are not set up on this server (VAPID keys).");
  const sub = await parseJsonBody(req, subscription);
  await saveSubscription(session.user.id, sub, req.headers.get("user-agent"));
  await updateReminderSettings(session.user.id, { push: true });
  return ok({ ok: true }, { status: 201 });
});

/** This browser stops receiving them. */
export const DELETE = apiHandler(async (req) => {
  const session = await requireSession();
  const { endpoint } = await parseJsonBody(req, z.object({ endpoint: z.string().max(1000) }));
  await removeSubscription(session.user.id, endpoint);
  return ok({ ok: true });
});
