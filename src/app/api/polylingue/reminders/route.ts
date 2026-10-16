import { z } from "zod";
import { apiHandler, ok, parseJsonBody, requireSession, badRequest } from "@/lib/api";
import { prisma } from "@/lib/db";
import { reminderSettings, updateReminderSettings } from "@/lib/polylingue/habits-service";
import { isValidTimeZone } from "@/lib/polylingue/progress";
import { pushConfigured, vapidPublicKey } from "@/lib/polylingue/push";

const schema = z.object({
  enabled: z.boolean().optional(),
  time: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
    .optional(),
  timeZone: z.string().max(64).optional(),
  streakWarning: z.boolean().optional(),
  push: z.boolean().optional(),
  weeklySummary: z.boolean().optional(),
});

async function view(userId: string) {
  const r = await reminderSettings(userId);
  return {
    enabled: r.enabled,
    time: r.time,
    timeZone: r.timeZone,
    streakWarning: r.streakWarning,
    push: r.push,
    weeklySummary: r.weeklySummary,
    pushAvailable: pushConfigured(),
    vapidPublicKey: vapidPublicKey(),
    browsers: await prisma.pushSubscription.count({ where: { userId } }),
  };
}

/** Reminder settings, and whether browser notifications can be used. */
export const GET = apiHandler(async () => {
  const session = await requireSession();
  return ok(await view(session.user.id));
});

export const PUT = apiHandler(async (req) => {
  const session = await requireSession();
  const input = await parseJsonBody(req, schema);
  if (input.timeZone && !isValidTimeZone(input.timeZone)) throw badRequest("Unknown time zone.");
  await updateReminderSettings(session.user.id, input);
  return ok(await view(session.user.id));
});
