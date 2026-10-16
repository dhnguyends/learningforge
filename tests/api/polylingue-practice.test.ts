import { describe, it, expect, beforeAll, afterAll } from "vitest";
import "./helpers";
import { prisma, createTestUser, disposeTestUser, signInAs, jsonRequest, type TestUser } from "./helpers";
import { NextRequest } from "next/server";
import { POST as startCourse } from "@/app/api/polylingue/courses/route";
import { GET as getCourse } from "@/app/api/polylingue/courses/[courseId]/route";
import { GET as listPractices, POST as createPractice } from "@/app/api/polylingue/courses/[courseId]/practices/route";
import { GET as getPractice } from "@/app/api/polylingue/courses/[courseId]/practices/[practiceId]/route";
import { POST as answerRoute } from "@/app/api/polylingue/courses/[courseId]/practices/[practiceId]/answer/route";
import { GET as audioRoute } from "@/app/api/polylingue/courses/[courseId]/practices/[practiceId]/audio/route";
import { POST as writingRoute } from "@/app/api/polylingue/courses/[courseId]/practices/[practiceId]/writing/route";
import { POST as speakingRoute } from "@/app/api/polylingue/courses/[courseId]/practices/[practiceId]/speaking/route";
import { POST as completeRoute } from "@/app/api/polylingue/courses/[courseId]/practices/[practiceId]/complete/route";
import { POST as wordsRoute } from "@/app/api/polylingue/courses/[courseId]/words/route";
import { CEFR_LEVELS, TARGET_LANGUAGES, BASE_LANGUAGES, curriculumBaseLang, type Cefr } from "@/lib/polylingue/levels";
import type { ListeningContent, ReadingContent } from "@/lib/polylingue/practice";

/**
 * Multi-skill practice end to end with the offline mock model and
 * transcriber: a practice per skill and unit, answers checked on the server,
 * listening text only as audio until the end, writing and speaking corrected.
 */
const BASE = "http://localhost";
let me: TestUser;
let other: TestUser;
let courseId: string;
let curriculumId: string;
let comboInput: Record<string, unknown>;

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
const pctx = (practiceId: string) => ({ params: { courseId, practiceId } });

async function readyPractice(skill: string) {
  const list = await waitFor(async () => {
    const l = await body(await listPractices(new NextRequest(`${BASE}/x?skill=${skill}`), cctx()));
    return l.ready && l.practices.length > 0 && l;
  });
  const id = list.practices[0].id as string;
  const practice = await waitFor(async () => {
    const p = await body(await getPractice(new NextRequest(`${BASE}/x`), pctx(id)));
    return p.status === "READY" && p;
  });
  return { id, practice, count: list.practices.length };
}

beforeAll(async () => {
  me = await createTestUser("PolyLingue practice");
  other = await createTestUser("PolyLingue practice outsider");
  // Only a language/level nobody has started: generated mock content never reaches real learners.
  const existing = await prisma.langCurriculum.findMany({ select: { targetLang: true, baseLang: true, level: true } });
  const used = new Set(existing.map((c) => `${c.targetLang}/${c.baseLang}/${c.level}`));
  let combo: { t: string; b: string; l: Cefr } | null = null;
  outer: for (const t of TARGET_LANGUAGES) {
    for (const b of BASE_LANGUAGES) {
      if (t.code === b.code) continue;
      for (const l of CEFR_LEVELS) {
        if (!used.has(`${t.code}/${curriculumBaseLang(t.code, b.code, l)}/${l}`)) {
          combo = { t: t.code, b: b.code, l };
          break outer;
        }
      }
    }
  }
  if (!combo) throw new Error("no unused language/level pair for the test");
  signInAs(me.id);
  comboInput = { level: combo.l, targetLang: combo.t, baseLang: combo.b, dailyGoalMinutes: 10, timeZone: "UTC" };
  const res = await startCourse(jsonRequest(`${BASE}/x`, "POST", comboInput), {} as never);
  courseId = (await body(res)).course.id;
  curriculumId = (await prisma.languageCourse.findUniqueOrThrow({ where: { id: courseId } })).curriculumId;
});

afterAll(async () => {
  await disposeTestUser(me.email);
  await disposeTestUser(other.email);
  await prisma.langCurriculum.deleteMany({ where: { id: curriculumId } });
  await prisma.$disconnect();
});

describe("PolyLingue multi-skill practice", () => {
  it("rejects an unknown skill", async () => {
    signInAs(me.id);
    expect((await listPractices(new NextRequest(`${BASE}/x?skill=dancing`), cctx())).status).toBe(400);
  });

  it("reading: one practice per unit, questions checked on the server, words added to review", async () => {
    signInAs(me.id);
    const { id, practice, count } = await readyPractice("reading");
    const units = (await body(await getCourse(new NextRequest(`${BASE}/x`), cctx()))).units.length;
    expect(count).toBe(units);
    expect(practice.content.questions[0]).not.toHaveProperty("answer");
    const stored = (await prisma.langPractice.findUniqueOrThrow({ where: { id } })).content as unknown as ReadingContent;
    const right = await body(await answerRoute(jsonRequest(`${BASE}/x`, "POST", { part: "question", index: 0, answer: stored.questions[0].answer }), pctx(id)));
    expect(right).toMatchObject({ verdict: "correct", xp: 10 });
    const wrong = await body(await answerRoute(jsonRequest(`${BASE}/x`, "POST", { part: "question", index: 1, answer: "nope" }), pctx(id)));
    expect(wrong).toMatchObject({ verdict: "wrong", expected: stored.questions[1].answer });

    const g = stored.glossary[0];
    expect(await body(await wordsRoute(jsonRequest(`${BASE}/x`, "POST", { term: g.term, translation: g.meaning }), cctx()))).toEqual({ added: true });
    expect(await body(await wordsRoute(jsonRequest(`${BASE}/x`, "POST", { term: g.term, translation: g.meaning }), cctx()))).toEqual({ added: false });

    const done = await body(await completeRoute(jsonRequest(`${BASE}/x`, "POST", { score: 50, seconds: 120 }), pctx(id)));
    expect(done).toMatchObject({ score: 50, bonusXp: 20, reveal: null });
    const list = await body(await listPractices(new NextRequest(`${BASE}/x?skill=reading`), cctx()));
    expect(list.practices[0]).toMatchObject({ completed: true, bestScore: 50 });
  });

  it("listening: text only as audio until the end, dictation forgiving accents", async () => {
    signInAs(me.id);
    const { id, practice } = await readyPractice("listening");
    expect(practice.content).toMatchObject({ dictationCount: 3, passageCount: 3 });
    const audio = await audioRoute(new NextRequest(`${BASE}/x?part=dictation&index=0`), pctx(id));
    expect(audio.status).toBe(200);
    expect((await audioRoute(new NextRequest(`${BASE}/x?part=other&index=0`), pctx(id))).status).toBe(400);
    expect((await audioRoute(new NextRequest(`${BASE}/x?part=passage&index=99`), pctx(id))).status).toBe(404);

    const stored = (await prisma.langPractice.findUniqueOrThrow({ where: { id } })).content as unknown as ListeningContent;
    const r = await body(await answerRoute(jsonRequest(`${BASE}/x`, "POST", { part: "dictation", index: 0, answer: stored.dictation[0].toUpperCase() }), pctx(id)));
    expect(r.verdict).toBe("correct");
    const done = await body(await completeRoute(jsonRequest(`${BASE}/x`, "POST", { score: 100, seconds: 60 }), pctx(id)));
    expect(done.reveal.passage).toEqual(stored.passage);
  });

  it("writing: corrected with a score and a model answer", async () => {
    signInAs(me.id);
    const { id, practice } = await readyPractice("writing");
    expect(practice.content.tasks[0]).not.toHaveProperty("model");
    const r = await body(await writingRoute(jsonRequest(`${BASE}/x`, "POST", { index: 0, text: "My town is small and very quiet." }), pctx(id)));
    expect(r).toMatchObject({ score: expect.any(Number), feedback: expect.any(String), model: expect.any(String) });
    expect(r.xp).toBe(Math.round(r.score / 5));
    expect((await writingRoute(jsonRequest(`${BASE}/x`, "POST", { index: 0, text: "  " }), pctx(id))).status).toBe(400);
  });

  it("speaking: the recording is transcribed and compared, and bad uploads are refused", async () => {
    signInAs(me.id);
    const { id } = await readyPractice("speaking");
    const form = (over: Record<string, string | Blob>) => {
      const f = new FormData();
      f.set("kind", "sentence");
      f.set("index", "0");
      f.set("audio", new Blob([new Uint8Array(2048)], { type: "audio/webm" }), "speech.webm");
      for (const [k, v] of Object.entries(over)) f.set(k, v);
      return new NextRequest(`${BASE}/x`, { method: "POST", body: f });
    };
    const r = await body(await speakingRoute(form({}), pctx(id)));
    expect(r).toMatchObject({ kind: "sentence", score: expect.any(Number), heard: expect.any(String) });
    expect(Array.isArray(r.missed)).toBe(true);
    const q = await body(await speakingRoute(form({ kind: "question" }), pctx(id)));
    expect(q).toMatchObject({ kind: "question", model: expect.any(String) });
    expect((await speakingRoute(form({ kind: "song" }), pctx(id))).status).toBe(400);
    expect((await speakingRoute(form({ audio: new Blob([new Uint8Array(10)], { type: "text/html" }) }), pctx(id))).status).toBe(400);
  });

  it("generates a personal reading in the chosen style, private to its learner", async () => {
    signInAs(me.id);
    const res = await createPractice(jsonRequest(`${BASE}/x`, "POST", { skill: "reading", format: "novel", topic: "scifi" }), cctx());
    expect(res.status).toBe(201);
    const { id } = await body(res);
    const row = await prisma.langPractice.findUniqueOrThrow({ where: { id } });
    expect(row).toMatchObject({ courseId, format: "novel", topic: "Science fiction", unitIndex: null, skill: "READING" });
    const ready = await waitFor(async () => {
      const p = await body(await getPractice(new NextRequest(`${BASE}/x`), pctx(id)));
      return p.status === "READY" && p;
    });
    expect(ready.content.questions.length).toBeGreaterThan(0);
    const list = await body(await listPractices(new NextRequest(`${BASE}/x?skill=reading`), cctx()));
    expect(list.personal.map((p: { id: string }) => p.id)).toEqual([id]);
    expect(list.practices.map((p: { id: string }) => p.id)).not.toContain(id);

    const custom = await createPractice(jsonRequest(`${BASE}/x`, "POST", { skill: "reading", format: "thesis", topic: "custom", customTopic: "the history of chocolate" }), cctx());
    expect((await prisma.langPractice.findUniqueOrThrow({ where: { id: (await body(custom)).id } })).topic).toBe("the history of chocolate");
    expect((await createPractice(jsonRequest(`${BASE}/x`, "POST", { skill: "reading", format: "thesis", topic: "custom", customTopic: " " }), cctx())).status).toBe(400);
    expect((await createPractice(jsonRequest(`${BASE}/x`, "POST", { skill: "reading", format: "poster", topic: "news" }), cctx())).status).toBe(400);

    // Another learner on the same course neither sees nor opens it.
    signInAs(other.id);
    const theirs = (await body(await startCourse(jsonRequest(`${BASE}/x`, "POST", comboInput), {} as never))).course.id as string;
    const theirList = await body(await listPractices(new NextRequest(`${BASE}/x?skill=reading`), { params: { courseId: theirs } }));
    expect(theirList.personal).toEqual([]);
    expect((await getPractice(new NextRequest(`${BASE}/x`), { params: { courseId: theirs, practiceId: id } })).status).toBe(404);
    await prisma.languageCourse.delete({ where: { id: theirs } });
  });

  it("keeps practice private to the learner", async () => {
    const practice = await prisma.langPractice.findFirstOrThrow({ where: { curriculumId } });
    signInAs(other.id);
    expect((await listPractices(new NextRequest(`${BASE}/x?skill=reading`), cctx())).status).toBe(404);
    expect((await getPractice(new NextRequest(`${BASE}/x`), pctx(practice.id))).status).toBe(404);
    expect((await wordsRoute(jsonRequest(`${BASE}/x`, "POST", { term: "a", translation: "b" }), cctx())).status).toBe(404);
  });
});
