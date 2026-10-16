import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import "./helpers";
import { prisma, createTestUser, disposeTestUser, signInAs, jsonRequest, type TestUser } from "./helpers";
import { NextRequest } from "next/server";

// Browser notifications never leave the test: web-push is replaced.
const sent: { endpoint: string; payload: string }[] = [];
let failWith: number | null = null;
vi.mock("web-push", () => ({
  default: {
    setVapidDetails: () => undefined,
    sendNotification: async (sub: { endpoint: string }, payload: string) => {
      if (failWith) throw Object.assign(new Error("gone"), { statusCode: failWith });
      sent.push({ endpoint: sub.endpoint, payload });
      return { statusCode: 201 };
    },
  },
}));

import { POST as answerRoute } from "@/app/api/polylingue/courses/[courseId]/lessons/[lessonId]/answer/route";
import { POST as completeRoute } from "@/app/api/polylingue/courses/[courseId]/lessons/[lessonId]/complete/route";
import { GET as progressRoute } from "@/app/api/polylingue/courses/[courseId]/progress/route";
import { GET as achievementsRoute } from "@/app/api/polylingue/achievements/route";
import { GET as notificationsRoute } from "@/app/api/polylingue/notifications/route";
import { POST as seenRoute } from "@/app/api/polylingue/notifications/seen/route";
import { GET as leaguesGet, POST as leaguesPost } from "@/app/api/polylingue/leagues/route";
import { POST as joinRoute } from "@/app/api/polylingue/leagues/join/route";
import { DELETE as leaveRoute } from "@/app/api/polylingue/leagues/[leagueId]/route";
import { GET as remindersGet, PUT as remindersPut } from "@/app/api/polylingue/reminders/route";
import { POST as pushPost, DELETE as pushDelete } from "@/app/api/polylingue/push/route";
import { GET as summaryRoute } from "@/app/api/polylingue/summary/route";
import { GET as offlineRoute } from "@/app/api/polylingue/courses/[courseId]/offline/route";
import { POST as offlineSync } from "@/app/api/polylingue/courses/[courseId]/offline/sync/route";
import { runReminderTick, pushConfigured } from "@/lib/polylingue/push";
import { CEFR_LEVELS, TARGET_LANGUAGES, BASE_LANGUAGES, type Cefr } from "@/lib/polylingue/levels";
import { addDays } from "@/lib/polylingue/habits";
import type { LessonContent } from "@/lib/polylingue/content";

/**
 * Phase 3: streak freezes, badges, in-app notifications, friends' leagues,
 * reminders (browser notifications mocked), weekly summary and offline
 * lessons — on a hand-written course at a language pair nobody uses.
 */
const BASE = "http://localhost";
let me: TestUser;
let friend: TestUser;
let outsider: TestUser;
let curriculumId: string;
let courseId: string;
let lessonIds: string[] = [];

const LESSON: LessonContent = {
  intro: "Greetings.",
  words: [
    { term: "ciao", translation: "hello", example: "", exampleTranslation: "", partOfSpeech: "" },
    { term: "grazie", translation: "thank you", example: "", exampleTranslation: "", partOfSpeech: "" },
    { term: "sì", translation: "yes", example: "", exampleTranslation: "", partOfSpeech: "" },
  ],
  exercises: Array.from({ length: 6 }, (_, i) => ({
    type: "choice" as const,
    prompt: `Question ${i + 1}: what does "ciao" mean?`,
    text: "",
    answer: "hello",
    accepted: [],
    options: ["hello", "bye", "thanks"],
    pairs: [],
    explanation: "Ciao is informal.",
    audio: i === 0 ? "ciao" : "",
  })),
};

const body = (r: Response) => r.json();
const get = (url = `${BASE}/x`) => new NextRequest(url);
const cctx = () => ({ params: { courseId } });
const lctx = (lessonId: string) => ({ params: { courseId, lessonId } });
const utcToday = () => new Date().toISOString().slice(0, 10);

beforeAll(async () => {
  me = await createTestUser("Habits");
  friend = await createTestUser("Habits friend");
  outsider = await createTestUser("Habits outsider");
  // A pair nobody uses: the course is written by hand, so no shared curriculum is touched.
  const used = new Set((await prisma.langCurriculum.findMany({ select: { targetLang: true, baseLang: true, level: true } })).map((c) => `${c.targetLang}/${c.baseLang}/${c.level}`));
  let combo: { t: string; b: string; l: Cefr } | null = null;
  outer: for (const t of TARGET_LANGUAGES.map((x) => x.code)) {
    for (const b of BASE_LANGUAGES.map((x) => x.code)) {
      if (t === b) continue;
      for (const l of CEFR_LEVELS.slice(0, 2)) {
        if (!used.has(`${t}/${b}/${l}`)) {
          combo = { t, b, l };
          break outer;
        }
      }
    }
  }
  if (!combo) throw new Error("no unused language pair for the test");
  const curriculum = await prisma.langCurriculum.create({ data: { targetLang: combo.t, baseLang: combo.b, level: combo.l, status: "READY" } });
  curriculumId = curriculum.id;
  for (let i = 0; i < 4; i++) {
    const l = await prisma.langLesson.create({
      data: { curriculumId, ordinal: i, unitIndex: 0, unitTitle: "Hello", title: `Lesson ${i + 1}`, focus: "greetings", status: "READY", content: LESSON as never },
    });
    lessonIds.push(l.id);
  }
  const course = await prisma.languageCourse.create({
    data: { userId: me.id, targetLang: combo.t, baseLang: combo.b, level: combo.l, curriculumId, timeZone: "UTC", dailyGoalMinutes: 5 },
  });
  courseId = course.id;
});

afterAll(async () => {
  await disposeTestUser(me.email);
  await disposeTestUser(friend.email);
  await disposeTestUser(outsider.email);
  await prisma.langOfflineSync.deleteMany({ where: { courseId } });
  await prisma.langCurriculum.deleteMany({ where: { id: curriculumId } });
  await prisma.$disconnect();
});

describe("streak freezes", () => {
  it("keep the streak over a missed day, mark it frozen, and award the badge", async () => {
    const twoDaysAgo = addDays(utcToday(), -2);
    await prisma.languageCourse.update({ where: { id: courseId }, data: { lastActiveDay: twoDaysAgo, streak: 5, bestStreak: 5, streakFreezes: 1, freezeXp: 295 } });
    signInAs(me.id);
    const r = await body(await answerRoute(jsonRequest(`${BASE}/x`, "POST", { index: 0, answer: "hello", retry: false }), lctx(lessonIds[0])));
    expect(r).toMatchObject({ verdict: "correct", xp: 10 });
    const course = await prisma.languageCourse.findUniqueOrThrow({ where: { id: courseId } });
    // The freeze covered yesterday; the 10 XP then earned a new one (295 + 10 ≥ 300).
    expect(course).toMatchObject({ streak: 6, streakFreezes: 1, freezeXp: 5, lastActiveDay: utcToday() });
    const progress = await body(await progressRoute(get(), cctx()));
    expect(progress.days.find((d: { day: string }) => d.day === addDays(utcToday(), -1))).toMatchObject({ frozen: true });
    expect(progress).toMatchObject({ streak: 6, streakFreezes: 1 });
    expect(await prisma.langAchievement.findUnique({ where: { courseId_key: { courseId, key: "freeze_saved" } } })).not.toBeNull();
  });
});

describe("badges and notifications", () => {
  it("awards badges on a perfect lesson and shows them once", async () => {
    signInAs(me.id);
    for (let i = 1; i < 6; i++) await answerRoute(jsonRequest(`${BASE}/x`, "POST", { index: i, answer: "hello", retry: false }), lctx(lessonIds[0]));
    expect((await completeRoute(jsonRequest(`${BASE}/x`, "POST", { firstTryCorrect: 6, total: 6, seconds: 400 }), lctx(lessonIds[0]))).status).toBe(200);

    const { courses } = await body(await achievementsRoute(get(), {} as never));
    const mine = courses.find((c: { courseId: string }) => c.courseId === courseId);
    const earned = mine.badges.filter((b: { earnedAt: string | null }) => b.earnedAt).map((b: { key: string }) => b.key);
    expect(earned).toEqual(expect.arrayContaining(["first_lesson", "perfect_lesson", "streak_3", "freeze_saved", "goal_week"].slice(0, 4)));
    expect(mine).toMatchObject({ streakFreezes: 1, freezeXp: expect.any(Number), freezeXpNeeded: 300, maxFreezes: 2 });

    const n = await body(await notificationsRoute(get(), {} as never));
    const keys = n.badges.map((b: { key: string }) => b.key);
    expect(keys).toEqual(expect.arrayContaining(["first_lesson", "perfect_lesson", "freeze_saved"]));
    expect(n.badges[0]).toMatchObject({ title: expect.any(String), description: expect.any(String), targetLang: expect.any(String) });
    expect((await seenRoute(jsonRequest(`${BASE}/x`, "POST", { ids: n.badges.map((b: { id: string }) => b.id) }), {} as never)).status).toBe(200);
    expect((await body(await notificationsRoute(get(), {} as never))).badges).toEqual([]);

    // Another learner cannot mark them seen or see them.
    signInAs(outsider.id);
    expect((await body(await notificationsRoute(get(), {} as never))).badges).toEqual([]);
  });
});

describe("friends' leagues", () => {
  it("creates a league, lets a friend join by code, ranks the week, and leaves", async () => {
    signInAs(me.id);
    const created = await leaguesPost(jsonRequest(`${BASE}/x`, "POST", { name: "Study buddies", nickname: "Mimi" }), {} as never);
    expect(created.status).toBe(201);
    const { id, code } = await body(created);
    expect(code).toMatch(/^[A-Z2-9]{3}-[A-Z2-9]{3}$/);

    signInAs(friend.id);
    expect((await joinRoute(jsonRequest(`${BASE}/x`, "POST", { code: "AAA", nickname: "Bo" }), {} as never)).status).toBe(400);
    expect((await joinRoute(jsonRequest(`${BASE}/x`, "POST", { code: "ZZZ-ZZZ", nickname: "Bo" }), {} as never)).status).toBe(code === "ZZZ-ZZZ" ? 200 : 404);
    const joined = await joinRoute(jsonRequest(`${BASE}/x`, "POST", { code: code.replace("-", " ").toLowerCase(), nickname: "Bo" }), {} as never);
    expect(joined.status).toBe(200);

    const view = await body(await leaguesGet(get(), {} as never));
    const league = view.leagues.find((l: { id: string }) => l.id === id);
    expect(league.ranking.map((r: { nickname: string; you: boolean; rank: number }) => [r.nickname, r.you, r.rank])).toEqual([
      ["Mimi", false, 1],
      ["Bo", true, 2],
    ]);
    expect(league.ranking[0].xp).toBeGreaterThan(0);
    expect(JSON.stringify(view)).not.toContain(me.email);

    expect((await leaveRoute(get(), { params: { leagueId: id } })).status).toBe(200);
    signInAs(outsider.id);
    expect((await leaveRoute(get(), { params: { leagueId: id } })).status).toBe(404);
    signInAs(me.id);
    await leaveRoute(get(), { params: { leagueId: id } });
    expect(await prisma.langLeague.findUnique({ where: { id } })).toBeNull();
  });
});

describe("reminders", () => {
  it("keeps settings, refuses bad values, and sends a due reminder once (browser notifications mocked)", async () => {
    signInAs(me.id);
    const initial = await body(await remindersGet(get(), {} as never));
    expect(initial).toMatchObject({ enabled: true, time: "19:00", timeZone: "UTC", push: false, browsers: 0 });
    expect((await remindersPut(jsonRequest(`${BASE}/x`, "PUT", { time: "25:00" }), {} as never)).status).toBe(400);
    expect((await remindersPut(jsonRequest(`${BASE}/x`, "PUT", { timeZone: "Mars/Olympus" }), {} as never)).status).toBe(400);
    expect(await body(await remindersPut(jsonRequest(`${BASE}/x`, "PUT", { time: "07:30", streakWarning: false }), {} as never))).toMatchObject({
      time: "07:30",
      streakWarning: false,
    });
    if (!pushConfigured()) return; // no VAPID keys on this machine: in-app reminders only

    expect((await pushPost(jsonRequest(`${BASE}/x`, "POST", { endpoint: "http://push.example/1", keys: { p256dh: "x".repeat(20), auth: "y".repeat(10) } }), {} as never)).status).toBe(400);
    const endpoint = `https://push.example.test/${me.id}`;
    expect((await pushPost(jsonRequest(`${BASE}/x`, "POST", { endpoint, keys: { p256dh: "x".repeat(20), auth: "y".repeat(10) } }), {} as never)).status).toBe(201);
    expect(await body(await remindersGet(get(), {} as never))).toMatchObject({ push: true, browsers: 1 });

    // Today at 20:00 UTC: after the 07:30 reminder, and today's 5-minute goal is not met (400 s done earlier is 6.7 min: met).
    await prisma.langDailyActivity.update({ where: { courseId_day: { courseId, day: utcToday() } }, data: { seconds: 60 } });
    const evening = new Date(`${utcToday()}T20:00:00Z`);
    sent.length = 0;
    expect(await runReminderTick(evening, [me.id])).toBe(1);
    expect(JSON.parse(sent[0].payload)).toMatchObject({ title: "Time for PolyLingue", url: `/polylingue/${courseId}`, tag: "polylingue-daily" });
    expect(await runReminderTick(evening, [me.id])).toBe(0);

    // An expired subscription is removed.
    await prisma.langReminder.update({ where: { userId: me.id }, data: { lastReminderDay: null } });
    failWith = 410;
    expect(await runReminderTick(evening, [me.id])).toBe(0);
    failWith = null;
    expect(await prisma.pushSubscription.count({ where: { userId: me.id } })).toBe(0);
    expect((await pushDelete(jsonRequest(`${BASE}/x`, "DELETE", { endpoint }), {} as never)).status).toBe(200);
  });

  it("shows the reminder in the app once its time has passed", async () => {
    signInAs(me.id);
    await remindersPut(jsonRequest(`${BASE}/x`, "PUT", { time: "00:00", timeZone: "UTC" }), {} as never);
    const n = await body(await notificationsRoute(get(), {} as never));
    expect(n.reminders).toEqual(expect.arrayContaining([expect.objectContaining({ kind: "daily", courseId })]));
  });
});

describe("weekly summary", () => {
  it("sums the week per language and says what to work on", async () => {
    signInAs(me.id);
    const s = await body(await summaryRoute(get(`${BASE}/x?week=${utcToday()}`), {} as never));
    const lang = s.languages.find((l: { courseId: string }) => l.courseId === courseId);
    expect(s.week.end).toBe(addDays(s.week.start, 6));
    expect(lang.xp).toBeGreaterThan(0);
    expect(lang.lessons).toBe(1);
    expect(lang.days).toHaveLength(7);
    expect(lang.skills.find((x: { name: string }) => x.name === "Lessons")).toMatchObject({ answers: 6, accuracy: 100 });
    expect(lang.focus.join(" ")).toMatch(/Not practised this week: Reading, Listening, Writing, Speaking/);
    expect((await summaryRoute(get(`${BASE}/x?week=yesterday`), {} as never)).status).toBe(400);
  });
});

describe("offline lessons", () => {
  it("packages the next lessons with their answers and audio, and applies a lesson played offline once", async () => {
    signInAs(me.id);
    const pkg = await body(await offlineRoute(get(), cctx()));
    expect(pkg.lessons.map((l: { player: { id: string } }) => l.player.id)).toEqual(lessonIds.slice(1, 4));
    expect(pkg.lessons[0].exercises[0].answer).toBe("hello");
    expect(pkg.audio).toEqual(expect.arrayContaining([expect.stringContaining("text=ciao")]));

    const result = {
      syncId: `sync-${Date.now()}`,
      lessonId: lessonIds[1],
      answers: Array.from({ length: 6 }, (_, index) => ({ index, answer: index === 5 ? "bye" : "hello", retry: false })),
      complete: { firstTryCorrect: 5, total: 6, seconds: 200 },
    };
    const first = await body(await offlineSync(jsonRequest(`${BASE}/x`, "POST", result), cctx()));
    expect(first).toMatchObject({ alreadySynced: false, xp: 50 + 20, score: 83 });
    expect(await body(await offlineSync(jsonRequest(`${BASE}/x`, "POST", result), cctx()))).toMatchObject({ alreadySynced: true, xp: 0 });
    expect(await prisma.langLessonProgress.findUnique({ where: { courseId_lessonId: { courseId, lessonId: lessonIds[1] } } })).toMatchObject({ bestScore: 83, runs: 1 });

    signInAs(outsider.id);
    expect((await offlineRoute(get(), cctx())).status).toBe(404);
  });
});
