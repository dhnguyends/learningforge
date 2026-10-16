import webpush from "web-push";
import { prisma } from "@/lib/db";
import { getEnv } from "@/lib/env";
import { dueReminders, localClock, type ReminderKind } from "@/lib/polylingue/habits";
import { followed, learnerDays } from "@/lib/polylingue/habits-service";
import { addDays } from "@/lib/polylingue/habits";

/**
 * PolyLingue reminders as browser notifications (Web Push, VAPID keys from
 * .env). Without keys, reminders stay in the app. The ticker runs in the
 * server process once a minute and sends each reminder once a day.
 */

export function pushConfigured(): boolean {
  const env = getEnv();
  return Boolean(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY);
}

export function vapidPublicKey(): string | null {
  return getEnv().VAPID_PUBLIC_KEY ?? null;
}

let configured = false;
function configure() {
  if (configured) return;
  const env = getEnv();
  webpush.setVapidDetails(env.VAPID_SUBJECT || "mailto:admin@learningforge.local", env.VAPID_PUBLIC_KEY!, env.VAPID_PRIVATE_KEY!);
  configured = true;
}

export interface PushPayload {
  title: string;
  body: string;
  /** Page opened by a click on the notification. */
  url: string;
  /** Same tag = replaces the previous notification of that kind. */
  tag: string;
}

export async function saveSubscription(userId: string, sub: { endpoint: string; keys: { p256dh: string; auth: string } }, userAgent?: string | null) {
  // A browser's endpoint belongs to whoever subscribed last on it.
  await prisma.pushSubscription.upsert({
    where: { endpoint: sub.endpoint },
    create: { userId, endpoint: sub.endpoint, p256dh: sub.keys.p256dh, auth: sub.keys.auth, userAgent: userAgent?.slice(0, 300) ?? null },
    update: { userId, p256dh: sub.keys.p256dh, auth: sub.keys.auth, userAgent: userAgent?.slice(0, 300) ?? null },
  });
}

export async function removeSubscription(userId: string, endpoint: string) {
  await prisma.pushSubscription.deleteMany({ where: { userId, endpoint } });
}

/** Sends to every browser the learner subscribed; expired subscriptions are removed. */
export async function sendPush(userId: string, payload: PushPayload): Promise<number> {
  if (!pushConfigured()) return 0;
  configure();
  const subs = await prisma.pushSubscription.findMany({ where: { userId } });
  let sent = 0;
  for (const s of subs) {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify(payload), { TTL: 6 * 3600 });
      await prisma.pushSubscription.update({ where: { id: s.id }, data: { lastUsedAt: new Date() } });
      sent++;
    } catch (err) {
      const status = (err as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) await prisma.pushSubscription.delete({ where: { id: s.id } }).catch(() => undefined);
      else console.warn("[push] send failed", status ?? (err as Error).message);
    }
  }
  return sent;
}

/** The notification for a reminder kind. */
export function reminderPayload(kind: ReminderKind, info: { courseId?: string; streak?: number; minutesLeft?: number; language?: string }): PushPayload {
  const course = info.courseId ? `/polylingue/${info.courseId}` : "/polylingue";
  switch (kind) {
    case "daily":
      return {
        title: "Time for PolyLingue",
        body: `${info.minutesLeft ?? 5} minute${info.minutesLeft === 1 ? "" : "s"} of ${info.language ?? "practice"} to reach today's goal.`,
        url: course,
        tag: "polylingue-daily",
      };
    case "streak":
      return {
        title: "Your streak is at risk",
        body: `Keep your ${info.streak ?? 1}-day ${info.language ?? ""} streak: one short lesson is enough.`.replace("  ", " "),
        url: course,
        tag: "polylingue-streak",
      };
    case "summary":
      return { title: "Your PolyLingue week", body: "Your weekly summary is ready: XP, time, words and what to work on.", url: "/polylingue/summary", tag: "polylingue-summary" };
  }
}

/** One pass: sends the reminders due now to learners who turned on notifications (`only`: these users, for tests). */
export async function runReminderTick(now = new Date(), only?: string[]): Promise<number> {
  if (!pushConfigured()) return 0;
  const rows = await prisma.langReminder.findMany({
    where: { push: true, user: { pushSubscriptions: { some: {} } }, ...(only ? { userId: { in: only } } : {}) },
  });
  let sent = 0;
  for (const r of rows) {
    const clock = localClock(now, r.timeZone);
    const days = await learnerDays(r.userId);
    if (days.length === 0) continue;
    const since = addDays(clock.day, -14);
    const active = new Set(
      (await prisma.langDailyActivity.findMany({ where: { course: { userId: r.userId }, day: { gte: since } }, select: { courseId: true }, distinct: ["courseId"] })).map(
        (a) => a.courseId,
      ),
    );
    const mine = followed(days, active);
    const behind = mine.find((d) => !d.goalMet);
    const risky = mine.find((d) => d.atRisk);
    const due = dueReminders(r, clock, { goalMet: !behind, atRisk: Boolean(risky) });
    if (due.length === 0) continue;
    const language = (code: string) => {
      try {
        return new Intl.DisplayNames(["en"], { type: "language" }).of(code) ?? code;
      } catch {
        return code;
      }
    };
    for (const kind of due) {
      const d = kind === "streak" ? risky : behind;
      const payload = reminderPayload(kind, {
        courseId: d?.courseId,
        streak: d?.streak,
        minutesLeft: d ? Math.max(1, Math.ceil(d.goalMinutes - d.minutesToday)) : undefined,
        language: d ? language(d.targetLang) : undefined,
      });
      sent += await sendPush(r.userId, payload);
    }
    await prisma.langReminder.update({
      where: { userId: r.userId },
      data: {
        ...(due.includes("daily") ? { lastReminderDay: clock.day } : {}),
        ...(due.includes("streak") ? { lastWarningDay: clock.day } : {}),
        ...(due.includes("summary") ? { lastSummaryWeek: clock.day } : {}),
      },
    });
  }
  return sent;
}

const TICKER = Symbol.for("learningforge.polylingue.reminderTicker");

/** Starts the once-a-minute reminder pass (one per server process). */
export function startReminderTicker(): void {
  const g = globalThis as unknown as Record<symbol, NodeJS.Timeout | undefined>;
  if (g[TICKER] || !pushConfigured()) return;
  g[TICKER] = setInterval(() => {
    runReminderTick().catch((err) => console.error("[push] reminder pass failed", err));
  }, 60_000);
  g[TICKER].unref?.();
  console.log("[push] PolyLingue reminders: browser notifications on");
}
