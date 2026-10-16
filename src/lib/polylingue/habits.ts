import { previousDay } from "@/lib/polylingue/progress";

/**
 * Phase 3, habit and motivation: streak freezes, badges, weeks, league codes
 * and reminder timing. Pure functions; the services store and send.
 */

// ---------------------------------------------------------------- days

export function addDays(day: string, n: number): string {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Whole days from `a` to `b` (YYYY-MM-DD), negative when b is earlier. */
export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86_400_000);
}

/** Monday of the week of `day`. */
export function weekStart(day: string): string {
  const dow = new Date(`${day}T12:00:00Z`).getUTCDay(); // 0 = Sunday
  return addDays(day, -((dow + 6) % 7));
}

/** The 7 days of the week starting on Monday `monday`. */
export function weekDays(monday: string): string[] {
  return Array.from({ length: 7 }, (_, i) => addDays(monday, i));
}

// ------------------------------------------------------- streak freezes

/** XP to earn one streak freeze, and how many can be held. */
export const FREEZE_XP = 300;
export const MAX_FREEZES = 2;

/** Freezes earned by adding XP: one per FREEZE_XP, up to MAX_FREEZES held (progress stops when full). */
export function earnFreezes(freezes: number, freezeXp: number, addXp: number): { freezes: number; freezeXp: number; earned: number } {
  let f = freezes;
  let progress = freezeXp + Math.max(0, addXp);
  let earned = 0;
  while (progress >= FREEZE_XP && f < MAX_FREEZES) {
    progress -= FREEZE_XP;
    f++;
    earned++;
  }
  if (f >= MAX_FREEZES) progress = Math.min(progress, FREEZE_XP);
  return { freezes: f, freezeXp: progress, earned };
}

/** Days missed between the last active day and today (today itself is not missed yet). */
export function missedDays(lastActiveDay: string | null, today: string): number {
  if (!lastActiveDay) return 0;
  return Math.max(0, daysBetween(lastActiveDay, today) - 1);
}

/**
 * The streak after activity today. Missed days are covered by freezes when
 * there are enough of them; the frozen days are returned to mark them.
 */
export function streakOnActivity(
  lastActiveDay: string | null,
  today: string,
  streak: number,
  freezes: number,
): { streak: number; freezesUsed: number; frozenDays: string[] } {
  if (!lastActiveDay) return { streak: 1, freezesUsed: 0, frozenDays: [] };
  if (lastActiveDay === today) return { streak: Math.max(streak, 1), freezesUsed: 0, frozenDays: [] };
  const missed = missedDays(lastActiveDay, today);
  if (missed === 0) return { streak: streak + 1, freezesUsed: 0, frozenDays: [] };
  if (missed <= freezes && streak > 0) {
    const frozenDays = Array.from({ length: missed }, (_, i) => addDays(lastActiveDay, i + 1));
    return { streak: streak + 1, freezesUsed: missed, frozenDays };
  }
  return { streak: 1, freezesUsed: 0, frozenDays: [] };
}

/** The streak shown before today's activity: kept while the missed days can still be covered by freezes. */
export function visibleStreak(lastActiveDay: string | null, today: string, streak: number, freezes: number): number {
  if (!lastActiveDay) return 0;
  return missedDays(lastActiveDay, today) <= freezes ? streak : 0;
}

/** True when the streak is lost unless the learner does something today. */
export function streakAtRisk(lastActiveDay: string | null, today: string, streak: number, freezes: number): boolean {
  if (!lastActiveDay || lastActiveDay === today || visibleStreak(lastActiveDay, today, streak, freezes) === 0) return false;
  // Without activity today, today becomes one more missed day.
  return missedDays(lastActiveDay, addDays(today, 1)) > freezes;
}

// ---------------------------------------------------------- achievements

export interface AchievementStats {
  lessons: number;
  perfectLessons: number;
  bestStreak: number;
  words: number;
  xp: number;
  reviews: number;
  /** Practices completed per skill. */
  skills: { READING: number; LISTENING: number; WRITING: number; SPEAKING: number };
  ownMaterialLessons: number;
  /** Days in a row (ending today or yesterday) on which the daily goal was met. */
  goalDaysInRow: number;
  freezesUsed: number;
}

export interface AchievementDef {
  key: string;
  title: string;
  description: string;
  /** Lucide icon name used by the badge. */
  icon: "sparkles" | "star" | "flame" | "book" | "trophy" | "brain" | "target" | "layers" | "file" | "snowflake";
  earned: (s: AchievementStats) => boolean;
}

export const ACHIEVEMENTS: AchievementDef[] = [
  { key: "first_lesson", title: "First steps", description: "Finish your first lesson.", icon: "sparkles", earned: (s) => s.lessons >= 1 },
  { key: "perfect_lesson", title: "Flawless", description: "Finish a lesson without a mistake.", icon: "star", earned: (s) => s.perfectLessons >= 1 },
  { key: "lessons_10", title: "Getting serious", description: "Finish 10 lessons.", icon: "book", earned: (s) => s.lessons >= 10 },
  { key: "lessons_50", title: "Scholar", description: "Finish 50 lessons.", icon: "book", earned: (s) => s.lessons >= 50 },
  { key: "streak_3", title: "On a roll", description: "A 3-day streak.", icon: "flame", earned: (s) => s.bestStreak >= 3 },
  { key: "streak_7", title: "One week strong", description: "A 7-day streak.", icon: "flame", earned: (s) => s.bestStreak >= 7 },
  { key: "streak_30", title: "Unstoppable", description: "A 30-day streak.", icon: "flame", earned: (s) => s.bestStreak >= 30 },
  { key: "words_100", title: "100 words", description: "Meet 100 words.", icon: "brain", earned: (s) => s.words >= 100 },
  { key: "words_500", title: "500 words", description: "Meet 500 words.", icon: "brain", earned: (s) => s.words >= 500 },
  { key: "xp_1000", title: "1,000 XP", description: "Earn 1,000 XP.", icon: "trophy", earned: (s) => s.xp >= 1000 },
  { key: "xp_5000", title: "5,000 XP", description: "Earn 5,000 XP.", icon: "trophy", earned: (s) => s.xp >= 5000 },
  { key: "reviews_100", title: "Memory keeper", description: "Do 100 reviews.", icon: "brain", earned: (s) => s.reviews >= 100 },
  {
    key: "all_skills",
    title: "All-rounder",
    description: "Finish a reading, listening, writing and speaking practice.",
    icon: "layers",
    earned: (s) => Object.values(s.skills).every((n) => n >= 1),
  },
  { key: "own_material", title: "My own material", description: "Finish a lesson made from one of your sources.", icon: "file", earned: (s) => s.ownMaterialLessons >= 1 },
  { key: "goal_week", title: "Goal getter", description: "Meet your daily goal 7 days in a row.", icon: "target", earned: (s) => s.goalDaysInRow >= 7 },
  { key: "freeze_saved", title: "Saved by the ice", description: "A streak freeze kept your streak alive.", icon: "snowflake", earned: (s) => s.freezesUsed >= 1 },
];

export function newAchievements(stats: AchievementStats, have: Set<string>): string[] {
  return ACHIEVEMENTS.filter((a) => !have.has(a.key) && a.earned(stats)).map((a) => a.key);
}

export function achievementDef(key: string): AchievementDef | undefined {
  return ACHIEVEMENTS.find((a) => a.key === key);
}

/** Days in a row, ending today (or yesterday, today not over yet), with at least `goalSeconds`. */
export function goalDaysInRow(secondsByDay: Map<string, number>, today: string, goalSeconds: number): number {
  let day = (secondsByDay.get(today) ?? 0) >= goalSeconds ? today : previousDay(today);
  let n = 0;
  while ((secondsByDay.get(day) ?? 0) >= goalSeconds) {
    n++;
    day = previousDay(day);
  }
  return n;
}

// ---------------------------------------------------------------- leagues

/** Invite codes avoid look-alike characters (0/O, 1/I/L). */
const CODE_CHARS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

export function leagueCode(random: (n: number) => number = (n) => Math.floor(Math.random() * n)): string {
  const pick = () => CODE_CHARS[random(CODE_CHARS.length)];
  return `${pick()}${pick()}${pick()}-${pick()}${pick()}${pick()}`;
}

/** "k7q 2mx", "K7Q2MX" → "K7Q-2MX". */
export function normalizeLeagueCode(input: string): string | null {
  const raw = input.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (raw.length !== 6 || [...raw].some((c) => !CODE_CHARS.includes(c))) return null;
  return `${raw.slice(0, 3)}-${raw.slice(3)}`;
}

export interface LeagueRow {
  memberId: string;
  nickname: string;
  xp: number;
  you: boolean;
}

/** Ranked by XP; equal XP share a rank. */
export function rankLeague(rows: LeagueRow[]): (LeagueRow & { rank: number })[] {
  const sorted = [...rows].sort((a, b) => b.xp - a.xp || a.nickname.localeCompare(b.nickname));
  let rank = 0;
  let prev: number | null = null;
  return sorted.map((r, i) => {
    if (r.xp !== prev) rank = i + 1;
    prev = r.xp;
    return { ...r, rank };
  });
}

// --------------------------------------------------------------- reminders

/** Minutes since midnight of "HH:MM". */
export function minutesOf(time: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(time);
  if (!m) return 19 * 60;
  return Math.min(23, Number(m[1])) * 60 + Math.min(59, Number(m[2]));
}

/** Local date and minutes since midnight of `now` in a time zone. */
export function localClock(now: Date, timeZone: string): { day: string; minutes: number; weekday: number } {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
      weekday: "short",
    }).formatToParts(now);
    const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
    const day = `${get("year")}-${get("month")}-${get("day")}`;
    const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(get("weekday"));
    return { day, minutes: Number(get("hour")) * 60 + Number(get("minute")), weekday };
  } catch {
    return localClock(now, "UTC");
  }
}

/** The evening "streak at risk" warning time. */
export const STREAK_WARNING_MINUTES = 21 * 60;

export type ReminderKind = "daily" | "streak" | "summary";

export interface ReminderState {
  enabled: boolean;
  time: string;
  streakWarning: boolean;
  weeklySummary: boolean;
  lastReminderDay: string | null;
  lastWarningDay: string | null;
  lastSummaryWeek: string | null;
}

/**
 * Which reminders are due now (once a day each): the daily reminder after its
 * time when today's goal is not met; the streak warning from 21:00 when a
 * streak would be lost; the weekly summary on Monday from the reminder time.
 */
export function dueReminders(
  r: ReminderState,
  clock: { day: string; minutes: number; weekday: number },
  learner: { goalMet: boolean; atRisk: boolean },
): ReminderKind[] {
  const out: ReminderKind[] = [];
  const at = minutesOf(r.time);
  if (r.enabled && clock.minutes >= at && r.lastReminderDay !== clock.day && !learner.goalMet) out.push("daily");
  if (r.streakWarning && clock.minutes >= STREAK_WARNING_MINUTES && r.lastWarningDay !== clock.day && learner.atRisk) out.push("streak");
  if (r.weeklySummary && clock.weekday === 1 && clock.minutes >= Math.min(at, 12 * 60) && r.lastSummaryWeek !== clock.day) out.push("summary");
  return out;
}
