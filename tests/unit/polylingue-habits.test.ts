import { describe, it, expect } from "vitest";
import {
  ACHIEVEMENTS,
  FREEZE_XP,
  MAX_FREEZES,
  addDays,
  dueReminders,
  earnFreezes,
  goalDaysInRow,
  leagueCode,
  localClock,
  missedDays,
  newAchievements,
  normalizeLeagueCode,
  rankLeague,
  streakAtRisk,
  streakOnActivity,
  visibleStreak,
  weekDays,
  weekStart,
  type AchievementStats,
  type ReminderState,
} from "@/lib/polylingue/habits";

describe("weeks and days", () => {
  it("starts weeks on Monday", () => {
    expect(weekStart("2026-10-16")).toBe("2026-10-12"); // Friday
    expect(weekStart("2026-10-12")).toBe("2026-10-12"); // Monday
    expect(weekStart("2026-10-18")).toBe("2026-10-12"); // Sunday
    expect(weekDays("2026-12-28")).toEqual(["2026-12-28", "2026-12-29", "2026-12-30", "2026-12-31", "2027-01-01", "2027-01-02", "2027-01-03"]);
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });
});

describe("streak freezes", () => {
  it("are earned with XP, two at most", () => {
    expect(earnFreezes(0, 250, 60)).toEqual({ freezes: 1, freezeXp: 10, earned: 1 });
    expect(earnFreezes(0, 0, FREEZE_XP * 3)).toEqual({ freezes: MAX_FREEZES, freezeXp: FREEZE_XP, earned: 2 });
    expect(earnFreezes(2, 300, 50)).toEqual({ freezes: 2, freezeXp: 300, earned: 0 });
  });

  it("cover missed days when there are enough of them", () => {
    expect(missedDays("2026-10-14", "2026-10-16")).toBe(1);
    expect(streakOnActivity("2026-10-15", "2026-10-16", 4, 0)).toEqual({ streak: 5, freezesUsed: 0, frozenDays: [] });
    expect(streakOnActivity("2026-10-14", "2026-10-16", 4, 1)).toEqual({ streak: 5, freezesUsed: 1, frozenDays: ["2026-10-15"] });
    expect(streakOnActivity("2026-10-13", "2026-10-16", 4, 1)).toEqual({ streak: 1, freezesUsed: 0, frozenDays: [] });
    expect(streakOnActivity("2026-10-16", "2026-10-16", 4, 2)).toEqual({ streak: 4, freezesUsed: 0, frozenDays: [] });
    expect(streakOnActivity(null, "2026-10-16", 0, 2)).toEqual({ streak: 1, freezesUsed: 0, frozenDays: [] });
  });

  it("keep the streak visible, and say when it is at risk", () => {
    expect(visibleStreak("2026-10-14", "2026-10-16", 6, 0)).toBe(0);
    expect(visibleStreak("2026-10-14", "2026-10-16", 6, 1)).toBe(6);
    expect(streakAtRisk("2026-10-15", "2026-10-16", 6, 0)).toBe(true);
    expect(streakAtRisk("2026-10-15", "2026-10-16", 6, 1)).toBe(false); // a freeze would cover today
    expect(streakAtRisk("2026-10-14", "2026-10-16", 6, 1)).toBe(true); // the freeze already covers yesterday
    expect(streakAtRisk("2026-10-16", "2026-10-16", 6, 0)).toBe(false);
    expect(streakAtRisk("2026-10-10", "2026-10-16", 6, 0)).toBe(false); // already lost
  });
});

describe("achievements", () => {
  const base: AchievementStats = {
    lessons: 0,
    perfectLessons: 0,
    bestStreak: 0,
    words: 0,
    xp: 0,
    reviews: 0,
    skills: { READING: 0, LISTENING: 0, WRITING: 0, SPEAKING: 0 },
    ownMaterialLessons: 0,
    goalDaysInRow: 0,
    freezesUsed: 0,
  };

  it("have unique keys and are earned once", () => {
    expect(new Set(ACHIEVEMENTS.map((a) => a.key)).size).toBe(ACHIEVEMENTS.length);
    expect(newAchievements(base, new Set())).toEqual([]);
    const stats = { ...base, lessons: 1, perfectLessons: 1, bestStreak: 7, words: 120 };
    expect(newAchievements(stats, new Set())).toEqual(["first_lesson", "perfect_lesson", "streak_3", "streak_7", "words_100"]);
    expect(newAchievements(stats, new Set(["first_lesson", "streak_3"]))).toEqual(["perfect_lesson", "streak_7", "words_100"]);
    expect(newAchievements({ ...base, skills: { READING: 1, LISTENING: 2, WRITING: 1, SPEAKING: 0 } }, new Set())).toEqual([]);
    expect(newAchievements({ ...base, skills: { READING: 1, LISTENING: 2, WRITING: 1, SPEAKING: 1 } }, new Set())).toEqual(["all_skills"]);
  });

  it("counts goal days in a row, today included once met", () => {
    const s = new Map([
      ["2026-10-13", 700],
      ["2026-10-14", 600],
      ["2026-10-15", 600],
      ["2026-10-16", 100],
    ]);
    expect(goalDaysInRow(s, "2026-10-16", 600)).toBe(3);
    s.set("2026-10-16", 650);
    expect(goalDaysInRow(s, "2026-10-16", 600)).toBe(4);
  });
});

describe("leagues", () => {
  it("makes readable invite codes and accepts them typed loosely", () => {
    expect(leagueCode()).toMatch(/^[A-HJKMNP-Z2-9]{3}-[A-HJKMNP-Z2-9]{3}$/);
    expect(normalizeLeagueCode(" k7q 2mx ")).toBe("K7Q-2MX");
    expect(normalizeLeagueCode("K7Q2MX")).toBe("K7Q-2MX");
    expect(normalizeLeagueCode("K7Q-2M")).toBeNull();
    expect(normalizeLeagueCode("O0I-1LL")).toBeNull();
  });

  it("ranks by weekly XP, ties sharing a rank", () => {
    const r = rankLeague([
      { memberId: "a", nickname: "Ana", xp: 120, you: false },
      { memberId: "b", nickname: "Ben", xp: 300, you: true },
      { memberId: "c", nickname: "Cleo", xp: 120, you: false },
      { memberId: "d", nickname: "Dan", xp: 0, you: false },
    ]);
    expect(r.map((x) => [x.nickname, x.rank])).toEqual([
      ["Ben", 1],
      ["Ana", 2],
      ["Cleo", 2],
      ["Dan", 4],
    ]);
  });
});

describe("reminders", () => {
  const r: ReminderState = {
    enabled: true,
    time: "19:00",
    streakWarning: true,
    weeklySummary: true,
    lastReminderDay: null,
    lastWarningDay: null,
    lastSummaryWeek: null,
  };
  const at = (minutes: number, weekday = 3) => ({ day: "2026-10-14", minutes, weekday });

  it("sends the daily reminder after its time while the goal is not met, once a day", () => {
    expect(dueReminders(r, at(18 * 60 + 59), { goalMet: false, atRisk: false })).toEqual([]);
    expect(dueReminders(r, at(19 * 60), { goalMet: false, atRisk: false })).toEqual(["daily"]);
    expect(dueReminders(r, at(20 * 60), { goalMet: true, atRisk: false })).toEqual([]);
    expect(dueReminders({ ...r, lastReminderDay: "2026-10-14" }, at(20 * 60), { goalMet: false, atRisk: false })).toEqual([]);
    expect(dueReminders({ ...r, enabled: false }, at(20 * 60), { goalMet: false, atRisk: false })).toEqual([]);
  });

  it("warns about a streak at risk from 21:00, and announces the summary on Monday", () => {
    expect(dueReminders({ ...r, lastReminderDay: "2026-10-14" }, at(21 * 60), { goalMet: false, atRisk: true })).toEqual(["streak"]);
    expect(dueReminders({ ...r, streakWarning: false, lastReminderDay: "2026-10-14" }, at(21 * 60), { goalMet: false, atRisk: true })).toEqual([]);
    expect(dueReminders(r, { day: "2026-10-12", minutes: 12 * 60, weekday: 1 }, { goalMet: true, atRisk: false })).toEqual(["summary"]);
    expect(dueReminders({ ...r, lastSummaryWeek: "2026-10-12" }, { day: "2026-10-12", minutes: 13 * 60, weekday: 1 }, { goalMet: true, atRisk: false })).toEqual([]);
  });

  it("reads the local clock of a time zone", () => {
    const c = localClock(new Date("2026-10-12T22:30:00Z"), "Europe/Paris");
    expect(c).toEqual({ day: "2026-10-13", minutes: 30, weekday: 2 });
    expect(localClock(new Date("2026-10-12T22:30:00Z"), "Not/AZone").day).toBe("2026-10-12");
  });
});
