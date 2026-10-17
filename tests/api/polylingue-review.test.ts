import { describe, it, expect, beforeAll, afterAll } from "vitest";
import "./helpers";
import { prisma, createTestUser, disposeTestUser, signInAs, jsonRequest, type TestUser } from "./helpers";
import { NextRequest } from "next/server";
import { POST as reportRoute } from "@/app/api/polylingue/courses/[courseId]/lessons/[lessonId]/report/route";
import { GET as lessonRoute } from "@/app/api/polylingue/courses/[courseId]/lessons/[lessonId]/route";
import { GET as courseRoute } from "@/app/api/polylingue/courses/[courseId]/route";
import { POST as completeRoute } from "@/app/api/polylingue/courses/[courseId]/lessons/[lessonId]/complete/route";
import { POST as answerRoute } from "@/app/api/polylingue/courses/[courseId]/lessons/[lessonId]/answer/route";
import { GET as curriculaRoute } from "@/app/api/admin/polylingue/curricula/route";
import { GET as curriculumRoute } from "@/app/api/admin/polylingue/curricula/[curriculumId]/route";
import { POST as audioRoute } from "@/app/api/admin/polylingue/curricula/[curriculumId]/audio/route";
import { GET as reviewRoute, PUT as editRoute } from "@/app/api/admin/polylingue/lessons/[lessonId]/route";
import { POST as regenerateRoute } from "@/app/api/admin/polylingue/lessons/[lessonId]/regenerate/route";
import { POST as retireRoute } from "@/app/api/admin/polylingue/lessons/[lessonId]/retire/route";
import { POST as restoreRoute } from "@/app/api/admin/polylingue/lessons/[lessonId]/restore/route";
import { POST as dismissRoute } from "@/app/api/admin/polylingue/lessons/[lessonId]/dismiss/route";
import { GET as reportsRoute } from "@/app/api/admin/polylingue/reports/route";
import { GET as analyticsRoute } from "@/app/api/admin/polylingue/analytics/route";
import { GET as voicesGet, PUT as voicesPut } from "@/app/api/admin/polylingue/voices/route";
import { retention } from "@/lib/polylingue/analytics";
import { clipKey, polylingueSpeaker, pregenerateLessonAudio } from "@/lib/polylingue/voices";
import { getStorage } from "@/lib/storage";
import { CEFR_LEVELS, TARGET_LANGUAGES, BASE_LANGUAGES, type Cefr } from "@/lib/polylingue/levels";
import type { LessonContent } from "@/lib/polylingue/content";

/**
 * Phase 5: learners report problems (3 reports hide an exercise), admins
 * review, edit, regenerate, retire and restore lessons (versions kept),
 * analytics, and lesson audio generated ahead of time with a chosen local
 * voice (mock speaker offline). Hand-written course at an unused pair.
 */
const BASE = "http://localhost";
let admin: TestUser;
const learners: TestUser[] = [];
const courseIds: string[] = [];
let curriculumId: string;
let lessonIds: string[] = [];
let target: string;
let savedVoices: unknown = undefined;

const LESSON: LessonContent = {
  intro: "Greetings.",
  words: [
    { term: "ciao", translation: "hello", example: "", exampleTranslation: "", partOfSpeech: "" },
    { term: "grazie", translation: "thank you", example: "", exampleTranslation: "", partOfSpeech: "" },
    { term: "sì", translation: "yes", example: "", exampleTranslation: "", partOfSpeech: "" },
  ],
  exercises: Array.from({ length: 6 }, (_, i) => ({
    type: "choice" as const,
    prompt: `Q${i + 1}: what does "ciao" mean?`,
    text: "",
    answer: "hello",
    accepted: [],
    options: ["hello", "bye", "thanks"],
    pairs: [],
    explanation: "",
    audio: i === 0 ? "ciao" : "",
  })),
};
const body = (r: Response) => r.json();
const get = (url = `${BASE}/x`) => new NextRequest(url);
const lctx = (i: number, lessonId = lessonIds[0]) => ({ params: { courseId: courseIds[i], lessonId } });
const actx = (lessonId = lessonIds[0]) => ({ params: { lessonId } });

beforeAll(async () => {
  admin = await createTestUser("Content admin");
  await prisma.user.update({ where: { id: admin.id }, data: { role: "ADMIN", nature: "HUMAN" } }); // only Human accounts can be Admin
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
  if (!combo) throw new Error("no unused pair");
  target = combo.t;
  const curriculum = await prisma.langCurriculum.create({
    data: { targetLang: combo.t, baseLang: combo.b, level: combo.l, status: "READY", outline: { units: [{ title: "Hello", theme: "g", grammar: "Greetings", lessons: [] }] } },
  });
  curriculumId = curriculum.id;
  for (let i = 0; i < 3; i++) {
    const l = await prisma.langLesson.create({ data: { curriculumId, ordinal: i, unitIndex: 0, unitTitle: "Hello", title: `Lesson ${i + 1}`, focus: "f", status: "READY", content: LESSON as never } });
    lessonIds.push(l.id);
  }
  for (let i = 0; i < 3; i++) {
    const u = await createTestUser(`Learner ${i + 1}`);
    learners.push(u);
    courseIds.push((await prisma.languageCourse.create({ data: { userId: u.id, targetLang: combo.t, baseLang: combo.b, level: combo.l, curriculumId } })).id);
  }
  savedVoices = (await prisma.appSetting.findUnique({ where: { key: "polylingue_voices" } }))?.value;
});

afterAll(async () => {
  // Never leave a test value in the live setting.
  const row = await prisma.appSetting.findUnique({ where: { key: "polylingue_voices" } });
  if (row?.updatedById === admin.id) {
    if (savedVoices === undefined) await prisma.appSetting.delete({ where: { key: "polylingue_voices" } });
    else await prisma.appSetting.update({ where: { key: "polylingue_voices" }, data: { value: savedVoices as object, updatedById: null } });
  }
  await prisma.artifactEdit.deleteMany({ where: { entityType: "lang_lesson", entityId: { in: lessonIds } } });
  for (const u of [admin, ...learners]) await disposeTestUser(u.email);
  await prisma.langCurriculum.deleteMany({ where: { id: curriculumId } });
  await prisma.$disconnect();
});

describe("reporting a problem", () => {
  it("hides an exercise once 3 different learners report it", async () => {
    for (let i = 0; i < 3; i++) {
      signInAs(learners[i].id);
      const r = await body(await reportRoute(jsonRequest(`${BASE}/x`, "POST", { index: 1, reason: "wrong_answer", comment: `learner ${i}` }), lctx(i)));
      expect(r).toMatchObject({ reports: i + 1, hidden: i === 2 });
      if (i === 0) {
        // The same learner again does not count twice.
        expect(await body(await reportRoute(jsonRequest(`${BASE}/x`, "POST", { index: 1, reason: "typo" }), lctx(0)))).toMatchObject({ reports: 1 });
      }
    }
    signInAs(learners[0].id);
    expect((await reportRoute(jsonRequest(`${BASE}/x`, "POST", { index: 9, reason: "typo" }), lctx(0))).status).toBe(404);
    expect((await reportRoute(jsonRequest(`${BASE}/x`, "POST", { index: 1, reason: "rude" }), lctx(0))).status).toBe(400);
    const lesson = await body(await lessonRoute(get(), lctx(0)));
    expect(lesson.content.exercises.map((e: { hidden: boolean }) => e.hidden)).toEqual([false, true, false, false, false, false]);
  });

  it("lists open reports for admins only", async () => {
    signInAs(learners[0].id);
    expect((await reportsRoute(get(), {} as never)).status).toBe(403);
    signInAs(admin.id);
    const { reports } = await body(await reportsRoute(get(), {} as never));
    const mine = reports.find((r: { lessonId: string }) => r.lessonId === lessonIds[0]);
    expect(mine).toMatchObject({ index: 1, count: 3, hidden: true, reasons: { wrong_answer: 2, typo: 1 }, prompt: 'Q2: what does "ciao" mean?' });
    const { curricula } = await body(await curriculaRoute(get(), {} as never));
    expect(curricula.find((c: { id: string }) => c.id === curriculumId)).toMatchObject({ learners: 3, lessons: 3, ready: 3, hiddenExercises: 1, openReports: 3 });
  });
});

describe("content review", () => {
  it("edits exercises in place, keeping the version before and resolving their reports", async () => {
    signInAs(admin.id);
    const review = await body(await reviewRoute(get(), actx()));
    expect(review.reports).toHaveLength(3);
    const content = structuredClone(review.content) as LessonContent;
    content.exercises[1] = { ...content.exercises[1], answer: "hi", options: ["hi", "bye", "thanks"] };

    const bad1 = structuredClone(content);
    bad1.exercises[1].answer = "not an option";
    expect((await editRoute(jsonRequest(`${BASE}/x`, "PUT", { content: bad1 }), actx())).status).toBe(400);
    const bad2 = structuredClone(content);
    bad2.exercises.pop();
    expect((await editRoute(jsonRequest(`${BASE}/x`, "PUT", { content: bad2 }), actx())).status).toBe(400);
    const bad3 = structuredClone(content);
    bad3.exercises[2] = { ...bad3.exercises[2], type: "translate" };
    expect((await editRoute(jsonRequest(`${BASE}/x`, "PUT", { content: bad3 }), actx())).status).toBe(400);

    const saved = await editRoute(jsonRequest(`${BASE}/x`, "PUT", { content, note: "Fix Q2" }), actx());
    expect(await body(saved)).toEqual({ changed: [1] });
    const after = await body(await reviewRoute(get(), actx()));
    expect(after.content.exercises[1].answer).toBe("hi");
    expect(after.hiddenExercises).toEqual([]);
    expect(after.reports.every((r: { resolution: string }) => r.resolution === "fixed")).toBe(true);
    expect(after.versions).toEqual([expect.objectContaining({ version: 1, note: "Fix Q2" })]);
    expect(after.editedAt).toBeTruthy();
  });

  it("restores an earlier version, keeping the current one too", async () => {
    signInAs(admin.id);
    expect((await restoreRoute(jsonRequest(`${BASE}/x`, "POST", { version: 1 }), actx())).status).toBe(200);
    const after = await body(await reviewRoute(get(), actx()));
    expect(after.content.exercises[1].answer).toBe("hello");
    expect(after.versions.map((v: { version: number }) => v.version)).toEqual([2, 1]);
    expect((await restoreRoute(jsonRequest(`${BASE}/x`, "POST", { version: 9 }), actx())).status).toBe(404);
  });

  it("dismisses reports without changing the exercise", async () => {
    signInAs(learners[0].id);
    await reportRoute(jsonRequest(`${BASE}/x`, "POST", { index: 3, reason: "unclear" }), lctx(0));
    signInAs(admin.id);
    expect((await dismissRoute(jsonRequest(`${BASE}/x`, "POST", { index: 3 }), actx())).status).toBe(200);
    const r = await prisma.langReport.findFirstOrThrow({ where: { lessonId: lessonIds[0], exerciseIndex: 3 } });
    expect(r.resolution).toBe("dismissed");
  });

  it("retires a lesson so it is no longer offered, and brings it back", async () => {
    signInAs(admin.id);
    await retireRoute(jsonRequest(`${BASE}/x`, "POST", { retired: true }), actx(lessonIds[1]));
    signInAs(learners[1].id);
    const course = await body(await courseRoute(get(), { params: { courseId: courseIds[1] } }));
    expect(course.units[0].lessons.map((l: { id: string }) => l.id)).toEqual([lessonIds[0], lessonIds[2]]);
    expect((await lessonRoute(get(), lctx(1, lessonIds[1]))).status).toBe(404);
    signInAs(admin.id);
    await retireRoute(jsonRequest(`${BASE}/x`, "POST", { retired: false }), actx(lessonIds[1]));
    signInAs(learners[1].id);
    expect((await lessonRoute(get(), lctx(1, lessonIds[1]))).status).toBe(200);
  });

  it("regenerates a lesson with the AI model (mock), keeping the version before", async () => {
    signInAs(learners[2].id);
    await reportRoute(jsonRequest(`${BASE}/x`, "POST", { index: 0, reason: "audio" }), lctx(2, lessonIds[2]));
    signInAs(admin.id);
    expect((await regenerateRoute(jsonRequest(`${BASE}/x`, "POST"), actx(lessonIds[2]))).status).toBe(202);
    let status = "";
    for (let i = 0; i < 100 && status !== "READY"; i++) {
      status = (await prisma.langLesson.findUniqueOrThrow({ where: { id: lessonIds[2] } })).status;
      if (status !== "READY") await new Promise((r) => setTimeout(r, 100));
    }
    expect(status).toBe("READY");
    const review = await body(await reviewRoute(get(), actx(lessonIds[2])));
    expect(review.versions).toEqual([expect.objectContaining({ version: 1, note: "Before regenerating" })]);
    expect(review.reports[0].resolution).toBe("regenerated");
    const list = await body(await curriculumRoute(get(), { params: { curriculumId } }));
    expect(list.lessons.find((l: { id: string }) => l.id === lessonIds[2])).toMatchObject({ versions: 1, openReports: 0 });
  });

  it("keeps all of it for admins only", async () => {
    signInAs(learners[0].id);
    expect((await editRoute(jsonRequest(`${BASE}/x`, "PUT", { content: LESSON }), actx())).status).toBe(403);
    expect((await retireRoute(jsonRequest(`${BASE}/x`, "POST", { retired: true }), actx())).status).toBe(403);
    expect((await analyticsRoute(get(), {} as never)).status).toBe(403);
    expect((await voicesGet(get(), {} as never)).status).toBe(403);
  });
});

describe("analytics", () => {
  it("computes day-N retention among learners old enough", () => {
    const c = (start: string, today: string, days: string[]) => ({ start, today, days: new Set(days) });
    const courses = [c("2026-10-01", "2026-10-17", ["2026-10-01", "2026-10-02", "2026-10-08"]), c("2026-10-01", "2026-10-17", ["2026-10-01"]), c("2026-10-15", "2026-10-17", ["2026-10-16"])];
    expect(retention(courses, 1)).toEqual({ eligible: 3, retained: 2, rate: 67 });
    expect(retention(courses, 7)).toEqual({ eligible: 2, retained: 1, rate: 50 });
    expect(retention(courses, 30)).toEqual({ eligible: 0, retained: 0, rate: null });
  });

  it("reports completion, time per lesson and the hardest exercises", async () => {
    signInAs(learners[0].id);
    for (let i = 0; i < 6; i++) await answerRoute(jsonRequest(`${BASE}/x`, "POST", { index: i, answer: i === 4 ? "bye" : "hello", retry: false }), lctx(0));
    await completeRoute(jsonRequest(`${BASE}/x`, "POST", { firstTryCorrect: 5, total: 6, seconds: 300 }), lctx(0));
    expect((await prisma.langLessonProgress.findFirstOrThrow({ where: { courseId: courseIds[0], lessonId: lessonIds[0] } })).seconds).toBe(300);
    signInAs(admin.id);
    const a = await body(await analyticsRoute(get(), {} as never));
    expect(a.learners.total).toBeGreaterThanOrEqual(3);
    expect(a.retention).toHaveProperty("day7");
    expect(a.lessons.completed).toBeGreaterThanOrEqual(1);
    expect(a.lessons.averageMinutes).toEqual(expect.any(Number));
    expect(a.dailyActive).toHaveLength(30);
    expect(a.curricula.find((c: { id: string }) => c.id === curriculumId)).toMatchObject({ learners: 3, lessonsCompleted: 1, averageScore: 83 });
  });
});

describe("voices and audio ahead of time", () => {
  it("offers local voices per language and saves a choice", async () => {
    signInAs(admin.id);
    const v = await body(await voicesGet(get(), {} as never));
    const lang = v.languages.find((l: { code: string }) => l.code === target);
    expect(lang.options.length).toBeGreaterThan(0);
    const choice = lang.options[0].key;
    expect((await voicesPut(jsonRequest(`${BASE}/x`, "PUT", { voices: { [target]: "azure:fr-FR-DeniseNeural" } }), {} as never)).status).toBe(400);
    const saved = await body(await voicesPut(jsonRequest(`${BASE}/x`, "PUT", { voices: { [target]: choice } }), {} as never));
    expect(saved.languages.find((l: { code: string }) => l.code === target).chosen).toBe(choice);
  });

  it("generates a lesson's audio once (mock voice) and marks it", async () => {
    const first = await pregenerateLessonAudio(lessonIds[1]);
    expect(first.skipped).toBeNull();
    expect((await prisma.langLesson.findUniqueOrThrow({ where: { id: lessonIds[1] } })).audioAt).toBeTruthy();
    // The clip a learner will ask for is in storage.
    const speaker = (await polylingueSpeaker(target))!;
    await expect(getStorage().read(clipKey(speaker, target, "ciao"))).resolves.toBeTruthy();
    expect((await pregenerateLessonAudio(lessonIds[1])).generated).toBe(0);
    signInAs(admin.id);
    expect(await body(await audioRoute(jsonRequest(`${BASE}/x`, "POST"), { params: { curriculumId } }))).toEqual({ queued: 3 });
  });
});
