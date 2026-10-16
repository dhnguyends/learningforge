import { describe, it, expect, beforeAll, afterAll } from "vitest";
import "./helpers";
import { prisma, createTestUser, disposeTestUser, signInAs, jsonRequest, type TestUser } from "./helpers";
import { NextRequest } from "next/server";
import { POST as startCourse } from "@/app/api/polylingue/courses/route";
import { GET as getCourse } from "@/app/api/polylingue/courses/[courseId]/route";
import { GET as getLesson } from "@/app/api/polylingue/courses/[courseId]/lessons/[lessonId]/route";
import { POST as completeRoute } from "@/app/api/polylingue/courses/[courseId]/lessons/[lessonId]/complete/route";
import { GET as weakGet, POST as weakPost } from "@/app/api/polylingue/courses/[courseId]/weak/route";
import { GET as progressRoute } from "@/app/api/polylingue/courses/[courseId]/progress/route";
import { GET as placementGet } from "@/app/api/polylingue/placement/route";
import { POST as placementAnswer } from "@/app/api/polylingue/placement/answer/route";
import { CEFR_LEVELS, TARGET_LANGUAGES, BASE_LANGUAGES, curriculumBaseLang, type Cefr } from "@/lib/polylingue/levels";

/**
 * Adaptive difficulty within the chosen level, weak-word practice and the
 * placement test, end to end with the offline mock model.
 */
const BASE = "http://localhost";
let me: TestUser;
let courseId: string;
let curriculumId: string;
let level: Cefr;
let placement: { target: string; base: string } | null = null;

async function waitFor<T>(fn: () => Promise<T | null | undefined | false>): Promise<T> {
  for (let i = 0; i < 100; i++) {
    const v = await fn();
    if (v) return v as T;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("timed out");
}
const body = (r: Response) => r.json();
const cctx = () => ({ params: { courseId } });

async function lessonFor(lessonId: string) {
  return waitFor(async () => {
    const l = await body(await getLesson(new NextRequest(`${BASE}/x`), { params: { courseId, lessonId } }));
    return l.status === "READY" && l;
  });
}
async function setRecent(verdict: "correct" | "wrong", n: number) {
  await prisma.langExerciseAttempt.deleteMany({ where: { courseId } });
  await prisma.langExerciseAttempt.createMany({
    data: Array.from({ length: n }, (_, i) => ({ courseId, lessonId: "x", exerciseIndex: i, type: "choice", answer: "a", verdict, xp: 0 })),
  });
}

beforeAll(async () => {
  me = await createTestUser("PolyLingue adaptive");
  const curricula = await prisma.langCurriculum.findMany({ select: { targetLang: true, baseLang: true, level: true } });
  const used = new Set(curricula.map((c) => `${c.targetLang}/${c.baseLang}/${c.level}`));
  const banks = new Set((await prisma.langPlacementBank.findMany({ select: { targetLang: true, baseLang: true } })).map((b) => `${b.targetLang}/${b.baseLang}`));
  let combo: { t: string; b: string; l: Cefr } | null = null;
  // A1–B1 (not immersion) so lessons have typed translations with word banks.
  outer: for (const t of TARGET_LANGUAGES) {
    for (const b of BASE_LANGUAGES) {
      if (t.code === b.code) continue;
      if (!placement && !banks.has(`${t.code}/${b.code}`)) placement = { target: t.code, base: b.code };
      for (const l of CEFR_LEVELS.slice(0, 3)) {
        if (!combo && !used.has(`${t.code}/${curriculumBaseLang(t.code, b.code, l)}/${l}`)) combo = { t: t.code, b: b.code, l };
        if (combo && placement) break outer;
      }
    }
  }
  if (!combo) throw new Error("no unused language/level pair for the test");
  level = combo.l;
  signInAs(me.id);
  const res = await startCourse(
    jsonRequest(`${BASE}/x`, "POST", { level: combo.l, targetLang: combo.t, baseLang: combo.b, dailyGoalMinutes: 10, timeZone: "UTC" }),
    {} as never,
  );
  courseId = (await body(res)).course.id;
  curriculumId = (await prisma.languageCourse.findUniqueOrThrow({ where: { id: courseId } })).curriculumId;
  await waitFor(async () => (await prisma.langCurriculum.findUnique({ where: { id: curriculumId } }))?.status === "READY");
});

afterAll(async () => {
  await disposeTestUser(me.email);
  await prisma.langCurriculum.deleteMany({ where: { id: curriculumId } });
  if (placement) await prisma.langPlacementBank.deleteMany({ where: { targetLang: placement.target, baseLang: placement.base } });
  await prisma.$disconnect();
});

describe("PolyLingue adaptive difficulty", () => {
  it("serves the same lesson content in the learner's mode, never changing the level", async () => {
    signInAs(me.id);
    const detail = await body(await getCourse(new NextRequest(`${BASE}/x`), cctx()));
    const lessonId = detail.nextLesson.id;

    const normal = await lessonFor(lessonId);
    expect(normal.mode).toBe("normal");
    const choice = normal.content.exercises.findIndex((e: { type: string }) => e.type === "choice");
    expect(normal.content.exercises[choice]).toMatchObject({ input: "options" });

    await setRecent("correct", 20);
    const challenge = await lessonFor(lessonId);
    expect(challenge.mode).toBe("challenge");
    expect(challenge.content.exercises[choice]).toMatchObject({ input: "typed", options: [] });
    expect(challenge.content.exercises[choice].prompt).toBe(normal.content.exercises[choice].prompt);

    await setRecent("wrong", 20);
    const support = await lessonFor(lessonId);
    expect(support.mode).toBe("support");
    const translate = support.content.exercises.findIndex((e: { type: string }) => e.type === "translate");
    expect(support.content.exercises[translate].input).toBe("wordbank");
    expect(support.content.exercises[translate].wordBank.length).toBeGreaterThan(0);

    const course = await prisma.languageCourse.findUniqueOrThrow({ where: { id: courseId } });
    expect(course.level).toBe(level);
    const progress = await body(await progressRoute(new NextRequest(`${BASE}/x`), cctx()));
    expect(progress.mode).toMatchObject({ mode: "support", accuracy: 0, answers: 20 });
    expect(progress.skills.find((s: { name: string }) => s.name === "Lessons")).toMatchObject({ accuracy: 0, answers: 20 });
  });

  it("recommends redoing a lesson scored under 60 %", async () => {
    signInAs(me.id);
    const detail = await body(await getCourse(new NextRequest(`${BASE}/x`), cctx()));
    const lessonId = detail.nextLesson.id;
    await completeRoute(jsonRequest(`${BASE}/x`, "POST", { firstTryCorrect: 2, total: 10, seconds: 60 }), { params: { courseId, lessonId } });
    const after = await body(await getCourse(new NextRequest(`${BASE}/x`), cctx()));
    expect(after.recommendation).toMatchObject({ kind: "redo", lessonId, score: 20 });
  });

  it("practises weak words and reschedules them", async () => {
    signInAs(me.id);
    const session = await body(await weakGet(new NextRequest(`${BASE}/x`), cctx()));
    expect(session.enough).toBe(true);
    const first = session.exercises[0];
    const card = await prisma.langCard.findUniqueOrThrow({ where: { id: first.cardId } });
    const r = await body(await weakPost(jsonRequest(`${BASE}/x`, "POST", { cardId: first.cardId, kind: first.kind, answer: "definitely wrong" }), cctx()));
    expect(r).toMatchObject({ verdict: "wrong", term: card.term });
    const after = await prisma.langCard.findUniqueOrThrow({ where: { id: first.cardId } });
    expect(after.reps).toBe(card.reps + 1);
    expect((await weakPost(jsonRequest(`${BASE}/x`, "POST", { cardId: "nope", kind: "type", answer: "x" }), cctx())).status).toBe(404);
  });

  it("placement test: questions without answers, answers checked on the server", async () => {
    if (!placement) return; // every pair already has a real bank: nothing to create safely
    signInAs(me.id);
    const ready = await waitFor(async () => {
      const b = await body(await placementGet(new NextRequest(`${BASE}/x?target=${placement!.target}&base=${placement!.base}`), {} as never));
      return b.items && b;
    });
    expect(ready.items.length).toBe(24);
    expect(ready.items[0]).not.toHaveProperty("answer");
    expect(new Set(ready.items.map((i: { level: string }) => i.level)).size).toBe(6);
    const right = await body(await placementAnswer(jsonRequest(`${BASE}/x`, "POST", { ...placement, id: 0, answer: "right" }), {} as never));
    expect(right).toMatchObject({ correct: true });
    const wrong = await body(await placementAnswer(jsonRequest(`${BASE}/x`, "POST", { ...placement, id: 0, answer: "wrong 1" }), {} as never));
    expect(wrong).toMatchObject({ correct: false, expected: "right" });
    expect((await placementGet(new NextRequest(`${BASE}/x?target=xx&base=en`), {} as never)).status).toBe(400);
  });
});
