import type { LanguageCourse } from "@prisma/client";
import { prisma } from "@/lib/db";
import { ApiError, badRequest, notFound } from "@/lib/api";
import { dayKey } from "@/lib/polylingue/progress";
import { EXERCISE_TYPES } from "@/lib/polylingue/levels";
import {
  ACHIEVEMENTS,
  achievementDef,
  addDays,
  goalDaysInRow,
  leagueCode,
  localClock,
  minutesOf,
  newAchievements,
  normalizeLeagueCode,
  rankLeague,
  streakAtRisk,
  visibleStreak,
  weekDays,
  weekStart,
  FREEZE_XP,
  MAX_FREEZES,
  type AchievementStats,
} from "@/lib/polylingue/habits";

/**
 * Phase 3 services: badges, in-app notifications, friends' leagues, reminder
 * settings and the weekly summary. Push sending lives in push.ts.
 */

// ----------------------------------------------------------- achievements

async function achievementStats(course: LanguageCourse): Promise<AchievementStats> {
  const today = dayKey(new Date(), course.timeZone);
  const [lessons, perfectLessons, words, reviews, practices, ownMaterialLessons, recent, freezesUsed] = await Promise.all([
    prisma.langLessonProgress.count({ where: { courseId: course.id, completedAt: { not: null } } }),
    prisma.langLessonProgress.count({ where: { courseId: course.id, completedAt: { not: null }, bestScore: { gte: 100 } } }),
    prisma.langCard.count({ where: { courseId: course.id } }),
    prisma.langDailyActivity.aggregate({ where: { courseId: course.id }, _sum: { reviews: true } }),
    prisma.langPracticeProgress.findMany({ where: { courseId: course.id, completedAt: { not: null } }, select: { practice: { select: { skill: true } } } }),
    prisma.langLessonProgress.count({ where: { courseId: course.id, completedAt: { not: null }, lesson: { courseId: course.id, sourceId: { not: null } } } }),
    prisma.langDailyActivity.findMany({ where: { courseId: course.id, day: { gte: addDays(today, -40) } }, select: { day: true, seconds: true } }),
    prisma.langDailyActivity.count({ where: { courseId: course.id, frozen: true } }),
  ]);
  const skills = { READING: 0, LISTENING: 0, WRITING: 0, SPEAKING: 0 };
  for (const p of practices) skills[p.practice.skill as keyof typeof skills]++;
  return {
    lessons,
    perfectLessons,
    bestStreak: course.bestStreak,
    words,
    xp: course.xp,
    reviews: reviews._sum.reviews ?? 0,
    skills,
    ownMaterialLessons,
    goalDaysInRow: goalDaysInRow(new Map(recent.map((r) => [r.day, r.seconds])), today, course.dailyGoalMinutes * 60),
    freezesUsed,
  };
}

/** Stores the badges just earned (unseen until the learner is told). */
export async function checkAchievements(courseId: string): Promise<string[]> {
  const course = await prisma.languageCourse.findUnique({ where: { id: courseId } });
  if (!course) return [];
  const have = new Set((await prisma.langAchievement.findMany({ where: { courseId }, select: { key: true } })).map((a) => a.key));
  const earned = newAchievements(await achievementStats(course), have);
  if (earned.length) await prisma.langAchievement.createMany({ data: earned.map((key) => ({ courseId, key })), skipDuplicates: true });
  return earned;
}

/** Every badge of every language: earned (with the date) or still to earn. */
export async function listAchievements(userId: string) {
  const courses = await prisma.languageCourse.findMany({
    where: { userId },
    orderBy: { updatedAt: "desc" },
    include: { achievements: true },
  });
  return courses.map((c) => {
    const earned = new Map(c.achievements.map((a) => [a.key, a.earnedAt]));
    return {
      courseId: c.id,
      targetLang: c.targetLang,
      level: c.level,
      streakFreezes: c.streakFreezes,
      freezeXp: c.freezeXp,
      freezeXpNeeded: FREEZE_XP,
      maxFreezes: MAX_FREEZES,
      badges: ACHIEVEMENTS.map((a) => ({ key: a.key, title: a.title, description: a.description, icon: a.icon, earnedAt: earned.get(a.key) ?? null })),
    };
  });
}

// ------------------------------------------------------ in-app notifications

export interface LearnerDay {
  courseId: string;
  targetLang: string;
  goalMinutes: number;
  minutesToday: number;
  goalMet: boolean;
  streak: number;
  atRisk: boolean;
  freezes: number;
}

/** Today for each of the learner's languages (their own time zones). */
export async function learnerDays(userId: string): Promise<LearnerDay[]> {
  const courses = await prisma.languageCourse.findMany({ where: { userId }, orderBy: { updatedAt: "desc" } });
  return Promise.all(
    courses.map(async (c) => {
      const today = dayKey(new Date(), c.timeZone);
      const day = await prisma.langDailyActivity.findUnique({ where: { courseId_day: { courseId: c.id, day: today } } });
      const minutesToday = Math.round(((day?.seconds ?? 0) / 60) * 10) / 10;
      return {
        courseId: c.id,
        targetLang: c.targetLang,
        goalMinutes: c.dailyGoalMinutes,
        minutesToday,
        goalMet: minutesToday >= c.dailyGoalMinutes,
        streak: visibleStreak(c.lastActiveDay, today, c.streak, c.streakFreezes),
        atRisk: streakAtRisk(c.lastActiveDay, today, c.streak, c.streakFreezes),
        freezes: c.streakFreezes,
      };
    }),
  );
}

/** Courses the learner is following: active in the last 14 days (or the most recent one). */
export function followed(days: LearnerDay[], activeCourseIds: Set<string>): LearnerDay[] {
  const recent = days.filter((d) => activeCourseIds.has(d.courseId));
  return recent.length ? recent : days.slice(0, 1);
}

async function recentlyActive(userId: string): Promise<Set<string>> {
  const since = addDays(new Date().toISOString().slice(0, 10), -14);
  const rows = await prisma.langDailyActivity.findMany({
    where: { course: { userId }, day: { gte: since } },
    select: { courseId: true },
    distinct: ["courseId"],
  });
  return new Set(rows.map((r) => r.courseId));
}

/**
 * What the PolyLingue pages show the learner: badges not seen yet, and the
 * reminders due now (goal not met after the reminder time, streak at risk in
 * the evening, the weekly summary on Mondays).
 */
export async function notifications(userId: string) {
  const [unseen, reminder, days, active] = await Promise.all([
    prisma.langAchievement.findMany({
      where: { seenAt: null, course: { userId } },
      orderBy: { earnedAt: "asc" },
      include: { course: { select: { targetLang: true } } },
    }),
    reminderSettings(userId),
    learnerDays(userId),
    recentlyActive(userId),
  ]);
  const clock = localClock(new Date(), reminder.timeZone);
  const mine = followed(days, active);
  const reminders: { kind: "daily" | "streak" | "summary"; courseId?: string; targetLang?: string; text: string }[] = [];
  const atRisk = mine.find((d) => d.atRisk);
  if (atRisk && reminder.streakWarning && clock.minutes >= 18 * 60) {
    reminders.push({ kind: "streak", courseId: atRisk.courseId, targetLang: atRisk.targetLang, text: `Your ${atRisk.streak}-day streak is at risk: a short lesson today keeps it.` });
  }
  const behind = mine.find((d) => !d.goalMet);
  if (behind && reminder.enabled && clock.minutes >= minutesOf(reminder.time) && !reminders.some((r) => r.courseId === behind.courseId)) {
    const left = Math.max(1, Math.ceil(behind.goalMinutes - behind.minutesToday));
    reminders.push({ kind: "daily", courseId: behind.courseId, targetLang: behind.targetLang, text: `${left} minute${left > 1 ? "s" : ""} left to reach today's goal.` });
  }
  if (reminder.weeklySummary && clock.weekday === 1 && days.length > 0) {
    reminders.push({ kind: "summary", text: "Your weekly summary is ready." });
  }
  return {
    badges: unseen.map((a) => ({ id: a.id, key: a.key, targetLang: a.course.targetLang, courseId: a.courseId, ...pickDef(a.key) })),
    reminders,
  };
}

function pickDef(key: string) {
  const d = achievementDef(key);
  return { title: d?.title ?? key, description: d?.description ?? "", icon: d?.icon ?? "trophy" };
}

export async function markBadgesSeen(userId: string, ids: string[]): Promise<void> {
  await prisma.langAchievement.updateMany({ where: { id: { in: ids }, course: { userId }, seenAt: null }, data: { seenAt: new Date() } });
}

// -------------------------------------------------------------- reminders

export async function reminderSettings(userId: string) {
  const row = await prisma.langReminder.findUnique({ where: { userId } });
  if (row) return row;
  // Defaults follow the learner's most recent course time zone.
  const course = await prisma.languageCourse.findFirst({ where: { userId }, orderBy: { updatedAt: "desc" }, select: { timeZone: true } });
  return {
    userId,
    enabled: true,
    time: "19:00",
    timeZone: course?.timeZone ?? "UTC",
    streakWarning: true,
    push: false,
    weeklySummary: true,
    lastReminderDay: null,
    lastWarningDay: null,
    lastSummaryWeek: null,
    updatedAt: new Date(0),
  };
}

export async function updateReminderSettings(
  userId: string,
  input: Partial<{ enabled: boolean; time: string; timeZone: string; streakWarning: boolean; push: boolean; weeklySummary: boolean }>,
) {
  const current = await reminderSettings(userId);
  const data = {
    enabled: input.enabled ?? current.enabled,
    time: input.time ?? current.time,
    timeZone: input.timeZone ?? current.timeZone,
    streakWarning: input.streakWarning ?? current.streakWarning,
    push: input.push ?? current.push,
    weeklySummary: input.weeklySummary ?? current.weeklySummary,
  };
  return prisma.langReminder.upsert({ where: { userId }, create: { userId, ...data }, update: data });
}

// ---------------------------------------------------------------- leagues

const MAX_LEAGUES = 5;
const MAX_MEMBERS = 50;

/** XP earned by each user over the given days (all their languages, each in its own time zone). */
async function xpByUser(userIds: string[], days: string[]): Promise<Map<string, number>> {
  const rows = await prisma.langDailyActivity.findMany({
    where: { day: { in: days }, course: { userId: { in: userIds } } },
    select: { xp: true, course: { select: { userId: true } } },
  });
  const out = new Map<string, number>();
  for (const r of rows) out.set(r.course.userId, (out.get(r.course.userId) ?? 0) + r.xp);
  return out;
}

export async function myLeagues(userId: string) {
  const today = new Date().toISOString().slice(0, 10);
  const thisWeek = weekStart(today);
  const lastWeek = addDays(thisWeek, -7);
  const memberships = await prisma.langLeagueMember.findMany({
    where: { userId },
    orderBy: { joinedAt: "asc" },
    include: { league: { include: { members: { select: { id: true, userId: true, nickname: true } } } } },
  });
  const userIds = [...new Set(memberships.flatMap((m) => m.league.members.map((x) => x.userId)))];
  const [now, before] = await Promise.all([xpByUser(userIds, weekDays(thisWeek)), xpByUser(userIds, weekDays(lastWeek))]);
  const table = (members: { id: string; userId: string; nickname: string }[], xp: Map<string, number>) =>
    rankLeague(members.map((x) => ({ memberId: x.id, nickname: x.nickname, xp: xp.get(x.userId) ?? 0, you: x.userId === userId })));
  return {
    week: { start: thisWeek, end: addDays(thisWeek, 6) },
    leagues: memberships.map((m) => ({
      id: m.league.id,
      name: m.league.name,
      code: m.league.code,
      nickname: m.nickname,
      createdByYou: m.league.createdById === userId,
      ranking: table(m.league.members, now),
      lastWeekPodium: table(m.league.members, before).filter((r) => r.xp > 0 && r.rank <= 3),
    })),
  };
}

async function assertRoomForLeague(userId: string) {
  if ((await prisma.langLeagueMember.count({ where: { userId } })) >= MAX_LEAGUES) throw badRequest(`You can be in ${MAX_LEAGUES} leagues at most: leave one first.`);
}

export async function createLeague(userId: string, input: { name: string; nickname: string }) {
  await assertRoomForLeague(userId);
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = leagueCode();
    if (await prisma.langLeague.findUnique({ where: { code } })) continue;
    return prisma.langLeague.create({
      data: { name: input.name, code, createdById: userId, members: { create: { userId, nickname: input.nickname } } },
    });
  }
  throw new ApiError(500, "Could not make an invite code, try again", "code_collision");
}

export async function joinLeague(userId: string, input: { code: string; nickname: string }) {
  const code = normalizeLeagueCode(input.code);
  if (!code) throw badRequest("An invite code looks like K7Q-2MX.");
  const league = await prisma.langLeague.findUnique({ where: { code }, include: { _count: { select: { members: true } } } });
  if (!league) throw notFound("League");
  if (await prisma.langLeagueMember.findUnique({ where: { leagueId_userId: { leagueId: league.id, userId } } })) return league;
  await assertRoomForLeague(userId);
  if (league._count.members >= MAX_MEMBERS) throw badRequest(`This league is full (${MAX_MEMBERS} members).`);
  await prisma.langLeagueMember.create({ data: { leagueId: league.id, userId, nickname: input.nickname } });
  return league;
}

/** Leaving the last member's place deletes the league. */
export async function leaveLeague(userId: string, leagueId: string): Promise<void> {
  const member = await prisma.langLeagueMember.findUnique({ where: { leagueId_userId: { leagueId, userId } } });
  if (!member) throw notFound("League");
  await prisma.langLeagueMember.delete({ where: { id: member.id } });
  if ((await prisma.langLeagueMember.count({ where: { leagueId } })) === 0) await prisma.langLeague.delete({ where: { id: leagueId } });
}

// ----------------------------------------------------------- weekly summary

/**
 * One week (Monday to Sunday) per language: XP, minutes, active days,
 * lessons, reviews, new words, accuracy per skill, and what to work on, with
 * the week before for comparison. Defaults to last week.
 */
export async function weeklySummary(userId: string, monday?: string) {
  const courses = await prisma.languageCourse.findMany({ where: { userId }, orderBy: { updatedAt: "desc" } });
  const tz = courses[0]?.timeZone ?? "UTC";
  const start = weekStart(monday ?? addDays(weekStart(dayKey(new Date(), tz)), -7));
  const days = weekDays(start);
  const before = weekDays(addDays(start, -7));
  const end = days[6];
  // Attempts and new words are dated in UTC; a day either side is close enough for a summary.
  const from = new Date(`${start}T00:00:00Z`);
  const to = new Date(`${addDays(end, 1)}T00:00:00Z`);

  const languages = await Promise.all(
    courses.map(async (c) => {
      const [activity, previous, newWords, attempts, weak] = await Promise.all([
        prisma.langDailyActivity.findMany({ where: { courseId: c.id, day: { in: days } } }),
        prisma.langDailyActivity.findMany({ where: { courseId: c.id, day: { in: before } } }),
        prisma.langCard.count({ where: { courseId: c.id, createdAt: { gte: from, lt: to } } }),
        prisma.langExerciseAttempt.groupBy({ by: ["type", "verdict"], where: { courseId: c.id, createdAt: { gte: from, lt: to } }, _count: true }),
        prisma.langCard.count({ where: { courseId: c.id, lapses: { gt: 0 } } }),
      ]);
      const sum = (rows: typeof activity, k: "xp" | "seconds" | "lessons" | "reviews") => rows.reduce((n, r) => n + r[k], 0);
      const skills = skillAccuracy(attempts);
      const goalDays = activity.filter((a) => a.seconds >= c.dailyGoalMinutes * 60).length;
      const practised = skills.filter((s) => s.answers > 0);
      const weakest = practised.length ? practised.reduce((a, b) => ((a.accuracy ?? 100) <= (b.accuracy ?? 100) ? a : b)) : null;
      const untouched = skills.filter((s) => s.answers === 0 && s.name !== "Weak words").map((s) => s.name);
      const focus: string[] = [];
      if (weakest && (weakest.accuracy ?? 100) < 80) focus.push(`${weakest.name}: ${weakest.accuracy}% right this week`);
      if (untouched.length) focus.push(`Not practised this week: ${untouched.join(", ")}`);
      if (weak >= 5) focus.push(`${weak} words to strengthen (Weak words)`);
      if (goalDays < 4) focus.push(`Daily goal met on ${goalDays} of 7 days`);
      return {
        courseId: c.id,
        targetLang: c.targetLang,
        level: c.level,
        xp: sum(activity, "xp"),
        xpBefore: sum(previous, "xp"),
        minutes: Math.round(sum(activity, "seconds") / 60),
        minutesBefore: Math.round(sum(previous, "seconds") / 60),
        activeDays: activity.filter((a) => a.xp > 0).length,
        goalDays,
        lessons: sum(activity, "lessons"),
        reviews: sum(activity, "reviews"),
        newWords,
        skills,
        focus,
        days: days.map((d) => {
          const a = activity.find((x) => x.day === d);
          return { day: d, xp: a?.xp ?? 0, minutes: Math.round((a?.seconds ?? 0) / 60), frozen: a?.frozen ?? false };
        }),
      };
    }),
  );
  return { week: { start, end }, languages };
}

const SKILLS = ["Lessons", "Reading", "Listening", "Writing", "Speaking", "Weak words"] as const;

function skillOf(type: string): (typeof SKILLS)[number] | null {
  if (type.startsWith("reading")) return "Reading";
  if (type.startsWith("listening")) return "Listening";
  if (type.startsWith("writing")) return "Writing";
  if (type.startsWith("speaking")) return "Speaking";
  if (type.startsWith("weak")) return "Weak words";
  return (EXERCISE_TYPES as readonly string[]).includes(type) ? "Lessons" : null;
}

export function skillAccuracy(rows: { type: string; verdict: string; _count: number }[]) {
  const totals = new Map<string, { points: number; answers: number }>();
  for (const r of rows) {
    const skill = skillOf(r.type);
    if (!skill) continue;
    const t = totals.get(skill) ?? { points: 0, answers: 0 };
    t.points += r._count * (r.verdict === "correct" ? 1 : r.verdict === "almost" ? 0.5 : 0);
    t.answers += r._count;
    totals.set(skill, t);
  }
  return SKILLS.map((name) => {
    const t = totals.get(name);
    return { name, answers: t?.answers ?? 0, accuracy: t?.answers ? Math.round((t.points / t.answers) * 100) : null };
  });
}
