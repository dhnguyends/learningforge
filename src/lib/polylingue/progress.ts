import type { Verdict } from "@/lib/polylingue/check";

/**
 * XP, days and streaks. Days are counted in the learner's time zone, so a
 * lesson at 23:30 in Paris counts for that evening, not for UTC's next day.
 */

export const XP = {
  correct: 10,
  almost: 6,
  wrong: 0,
  /** A missed exercise answered right when it comes back at the end. */
  retry: 3,
  lessonComplete: 20,
  perfectLesson: 10,
  reviewGood: 2,
  reviewAgain: 1,
} as const;

export function answerXp(verdict: Verdict, retry: boolean): number {
  if (retry) return verdict === "wrong" ? 0 : XP.retry;
  return XP[verdict];
}

export function lessonBonus(scorePercent: number): number {
  return XP.lessonComplete + (scorePercent >= 100 ? XP.perfectLesson : 0);
}

/** YYYY-MM-DD in a time zone (falls back to UTC for an unknown zone). */
export function dayKey(date: Date, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
  } catch {
    return date.toISOString().slice(0, 10);
  }
}

export function previousDay(day: string): string {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/**
 * The streak after activity on `today`: unchanged if already active today,
 * +1 after yesterday, otherwise a new streak of 1.
 */
export function nextStreak(lastActiveDay: string | null, today: string, streak: number): number {
  if (lastActiveDay === today) return Math.max(streak, 1);
  if (lastActiveDay && previousDay(today) === lastActiveDay) return streak + 1;
  return 1;
}

/** The streak shown on a day without activity yet: kept until the end of today, lost after a missed day. */
export function currentStreak(lastActiveDay: string | null, today: string, streak: number): number {
  if (!lastActiveDay) return 0;
  return lastActiveDay === today || lastActiveDay === previousDay(today) ? streak : 0;
}

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}
