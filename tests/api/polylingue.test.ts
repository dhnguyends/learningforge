import { describe, it, expect, beforeAll, afterAll } from "vitest";
import "./helpers";
import { prisma, createTestUser, disposeTestUser, signInAs, jsonRequest, type TestUser } from "./helpers";
import { NextRequest } from "next/server";
import { GET as listCourses, POST as startCourse } from "@/app/api/polylingue/courses/route";
import { GET as getCourse, PATCH as patchCourse } from "@/app/api/polylingue/courses/[courseId]/route";
import { GET as getLesson } from "@/app/api/polylingue/courses/[courseId]/lessons/[lessonId]/route";
import { POST as answerRoute } from "@/app/api/polylingue/courses/[courseId]/lessons/[lessonId]/answer/route";
import { POST as completeRoute } from "@/app/api/polylingue/courses/[courseId]/lessons/[lessonId]/complete/route";
import { GET as reviewList, POST as reviewGrade } from "@/app/api/polylingue/courses/[courseId]/review/route";
import { GET as progressRoute } from "@/app/api/polylingue/courses/[courseId]/progress/route";
import { GET as speechRoute } from "@/app/api/polylingue/speech/route";
import { CEFR_LEVELS, TARGET_LANGUAGES, BASE_LANGUAGES, curriculumBaseLang, isImmersion, type Cefr } from "@/lib/polylingue/levels";
import type { LessonContent } from "@/lib/polylingue/content";

/**
 * PolyLingue end to end with the offline mock model: level first, a shared
 * curriculum per language and level, lessons with instant correction and XP,
 * words into spaced review, streak and progress; learners only see their own.
 */
const BASE = "http://localhost";
let me: TestUser;
let other: TestUser;
let combo: { targetLang: string; baseLang: string; level: Cefr; otherLevel: Cefr };
const createdCurricula = new Set<string>();

async function waitFor<T>(fn: () => Promise<T | null | undefined | false>): Promise<T> {
  for (let i = 0; i < 100; i++) {
    const v = await fn();
    if (v) return v as T;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("timed out");
}

const body = (r: Response) => r.json();
const cctx = (courseId: string) => ({ params: { courseId } });
const lctx = (courseId: string, lessonId: string) => ({ params: { courseId, lessonId } });

beforeAll(async () => {
  me = await createTestUser("PolyLingue learner");
  other = await createTestUser("PolyLingue outsider");
  // Shared curricula are real content for real learners: only use (and later
  // delete) language/level pairs that nobody has started yet.
  const existing = await prisma.langCurriculum.findMany({ select: { targetLang: true, baseLang: true, level: true } });
  const used = new Set(existing.map((c) => `${c.targetLang}/${c.baseLang}/${c.level}`));
  for (const t of [...TARGET_LANGUAGES].reverse()) {
    for (const b of BASE_LANGUAGES) {
      if (t.code === b.code) continue;
      const free = [...CEFR_LEVELS].reverse().filter((l) => !used.has(`${t.code}/${curriculumBaseLang(t.code, b.code, l)}/${l}`));
      if (free.length >= 2) {
        combo = { targetLang: t.code, baseLang: b.code, level: free[0], otherLevel: free[1] };
        return;
      }
    }
  }
  throw new Error("no unused language/level pair for the test");
});

afterAll(async () => {
  await disposeTestUser(me.email);
  await disposeTestUser(other.email);
  await prisma.langCurriculum.deleteMany({ where: { id: { in: [...createdCurricula] } } });
  await prisma.$disconnect();
});

describe("PolyLingue", () => {
  let courseId: string;
  let lessonId: string;

  it("starts a language at the chosen level and writes its shared course", async () => {
    signInAs(me.id);
    const res = await startCourse(
      jsonRequest(`${BASE}/x`, "POST", { level: combo.level, targetLang: combo.targetLang, baseLang: combo.baseLang, dailyGoalMinutes: 10, timeZone: "Europe/Paris" }),
      {} as never,
    );
    expect(res.status).toBe(201);
    const { course } = await body(res);
    courseId = course.id;
    expect(course).toMatchObject({ level: combo.level, targetLang: combo.targetLang, dailyGoalMinutes: 10, streak: 0, xp: 0 });
    const c = await prisma.languageCourse.findUniqueOrThrow({ where: { id: courseId }, include: { curriculum: true } });
    createdCurricula.add(c.curriculumId);
    // B2 and up are immersion courses, shared per language whatever the learner's own language.
    expect(c.curriculum.baseLang).toBe(isImmersion(combo.level) ? combo.targetLang : combo.baseLang);
    expect(c.baseLang).toBe(combo.baseLang);

    const detail = await waitFor(async () => {
      const d = await body(await getCourse(new NextRequest(`${BASE}/x`), cctx(courseId)));
      return d.curriculum.status === "READY" && d.units.length > 0 && d;
    });
    expect(detail.units.length).toBeGreaterThanOrEqual(3);
    expect(detail.nextLesson).toBeTruthy();
    lessonId = detail.nextLesson.id;
  });

  it("refuses bad onboarding input", async () => {
    signInAs(me.id);
    const bad = async (over: Record<string, unknown>) =>
      (
        await startCourse(
          jsonRequest(`${BASE}/x`, "POST", { level: "A1", targetLang: "es", baseLang: "en", dailyGoalMinutes: 10, timeZone: "UTC", ...over }),
          {} as never,
        )
      ).status;
    expect(await bad({ level: "D1" })).toBe(400);
    expect(await bad({ targetLang: "xx" })).toBe(400);
    expect(await bad({ dailyGoalMinutes: 7 })).toBe(400);
    expect(await bad({ timeZone: "Mars/Olympus" })).toBe(400);
    expect(await bad({ targetLang: "en", baseLang: "en" })).toBe(400);
  });

  it("serves a lesson without its answers, corrects answers instantly and gives XP", async () => {
    signInAs(me.id);
    const lesson = await waitFor(async () => {
      const l = await body(await getLesson(new NextRequest(`${BASE}/x`), lctx(courseId, lessonId)));
      return l.status === "READY" && l;
    });
    expect(lesson.content.exercises.length).toBeGreaterThanOrEqual(6);
    const stored = (await prisma.langLesson.findUniqueOrThrow({ where: { id: lessonId } })).content as unknown as LessonContent;
    // Answers stay on the server.
    const cloze = lesson.content.exercises.findIndex((e: { type: string }) => e.type === "cloze");
    expect(lesson.content.exercises[cloze].text).not.toContain(stored.exercises[cloze].answer);

    const answer = (index: number, given: string, retry = false) =>
      answerRoute(jsonRequest(`${BASE}/x`, "POST", { index, answer: given, retry }), lctx(courseId, lessonId)).then(body);

    const choice = stored.exercises.findIndex((e) => e.type === "choice");
    expect(await answer(choice, stored.exercises[choice].answer)).toMatchObject({ verdict: "correct", xp: 10 });
    const translate = stored.exercises.findIndex((e) => e.type === "translate");
    expect(await answer(translate, "something else entirely")).toMatchObject({ verdict: "wrong", xp: 0, expected: stored.exercises[translate].answer });
    expect(await answer(translate, stored.exercises[translate].answer, true)).toMatchObject({ verdict: "correct", xp: 3 });
    const match = stored.exercises.findIndex((e) => e.type === "match");
    expect(await answer(match, "1")).toMatchObject({ verdict: "almost", xp: 6 });

    const done = await body(
      await completeRoute(jsonRequest(`${BASE}/x`, "POST", { firstTryCorrect: 2, total: 3, seconds: 240 }), lctx(courseId, lessonId)),
    );
    expect(done).toMatchObject({ score: 67, bonusXp: 20 });
    expect(done.newWords).toBe(stored.words.length);

    const course = await body(await getCourse(new NextRequest(`${BASE}/x`), cctx(courseId)));
    expect(course.xp).toBe(10 + 3 + 6 + 20);
    expect(course.streak).toBe(1);
    expect(course.today).toMatchObject({ minutes: 4, lessons: 1 });
    expect(course.words).toBe(stored.words.length);
    expect(course.nextLesson.id).not.toBe(lessonId);
  });

  it("reviews the lesson's words with spaced repetition", async () => {
    signInAs(me.id);
    const { cards } = await body(await reviewList(new NextRequest(`${BASE}/x`), cctx(courseId)));
    expect(cards.length).toBeGreaterThan(0);
    const graded = await body(await reviewGrade(jsonRequest(`${BASE}/x`, "POST", { cardId: cards[0].id, grade: 3, seconds: 5 }), cctx(courseId)));
    expect(new Date(graded.dueAt).getTime()).toBeGreaterThan(Date.now());
    expect(graded.xp).toBe(2);
    const after = await body(await reviewList(new NextRequest(`${BASE}/x`), cctx(courseId)));
    expect(after.cards.map((c: { id: string }) => c.id)).not.toContain(cards[0].id);
  });

  it("shows progress", async () => {
    signInAs(me.id);
    const p = await body(await progressRoute(new NextRequest(`${BASE}/x`), cctx(courseId)));
    expect(p).toMatchObject({ lessonsDone: 1, streak: 1, activeDays: 1 });
    expect(p.days).toHaveLength(35);
    expect(p.accuracy).toBeGreaterThan(0);
  });

  it("changes level by switching to that level's course, keeping words and XP", async () => {
    signInAs(me.id);
    const res = await patchCourse(jsonRequest(`${BASE}/x`, "PATCH", { level: combo.otherLevel }), cctx(courseId));
    expect(res.status).toBe(200);
    const c = await prisma.languageCourse.findUniqueOrThrow({ where: { id: courseId } });
    createdCurricula.add(c.curriculumId);
    expect(c.level).toBe(combo.otherLevel);
    expect(c.xp).toBe(41);
    expect(await prisma.langCard.count({ where: { courseId } })).toBeGreaterThan(0);
    await waitFor(async () => (await prisma.langCurriculum.findUnique({ where: { id: c.curriculumId } }))?.status === "READY");
  });

  it("reads lesson text aloud", async () => {
    signInAs(me.id);
    const res = await speechRoute(new NextRequest(`${BASE}/api/polylingue/speech?lang=${combo.targetLang}&text=hola`), {} as never);
    expect(res.status).toBe(200);
    expect((await speechRoute(new NextRequest(`${BASE}/api/polylingue/speech?lang=xx&text=hola`), {} as never)).status).toBe(400);
  });

  it("keeps each learner's courses private", async () => {
    signInAs(other.id);
    expect((await body(await listCourses(new NextRequest(`${BASE}/x`), {} as never))).courses).toEqual([]);
    expect((await getCourse(new NextRequest(`${BASE}/x`), cctx(courseId))).status).toBe(404);
    expect((await getLesson(new NextRequest(`${BASE}/x`), lctx(courseId, lessonId))).status).toBe(404);
    expect((await answerRoute(jsonRequest(`${BASE}/x`, "POST", { index: 0, answer: "x" }), lctx(courseId, lessonId))).status).toBe(404);
    signInAs(null);
    expect((await listCourses(new NextRequest(`${BASE}/x`), {} as never)).status).toBe(401);
  });

  it("deletes a learner's PolyLingue data with the account", async () => {
    const before = await prisma.languageCourse.count({ where: { userId: me.id } });
    expect(before).toBe(1);
    await prisma.user.delete({ where: { id: me.id } });
    expect(await prisma.languageCourse.count({ where: { id: courseId } })).toBe(0);
    expect(await prisma.langCard.count({ where: { courseId } })).toBe(0);
  });
});
