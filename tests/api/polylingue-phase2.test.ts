import { describe, it, expect, beforeAll, afterAll } from "vitest";
import "./helpers";
import { prisma, createTestUser, disposeTestUser, signInAs, jsonRequest, type TestUser } from "./helpers";
import { NextRequest } from "next/server";
import { getStorage, sourceAssetKey } from "@/lib/storage";
import { POST as reprocess } from "@/app/api/study-sets/[studySetId]/sources/[sourceId]/reprocess/route";
import { POST as startCourse } from "@/app/api/polylingue/courses/route";
import { GET as getCourse } from "@/app/api/polylingue/courses/[courseId]/route";
import { GET as getLesson } from "@/app/api/polylingue/courses/[courseId]/lessons/[lessonId]/route";
import { POST as answerRoute } from "@/app/api/polylingue/courses/[courseId]/lessons/[lessonId]/answer/route";
import { POST as hintRoute } from "@/app/api/polylingue/courses/[courseId]/lessons/[lessonId]/hint/route";
import { GET as sourcesGet, POST as sourcesPost } from "@/app/api/polylingue/courses/[courseId]/source-lessons/route";
import { CEFR_LEVELS, curriculumBaseLang, type Cefr } from "@/lib/polylingue/levels";
import type { LessonContent } from "@/lib/polylingue/content";

/**
 * Phase 2 completion: grammar hints (cached, half XP) and lessons made from
 * the learner's own LearningForge sources, with the offline mock providers.
 */
const BASE = "http://localhost";
let me: TestUser;
let other: TestUser;
let courseId: string;
let curriculumId: string;
let sourceId: string;
let target: "en" | "fr";

const TEXT: Record<"en" | "fr", string> = {
  en:
    "The city market opens every morning at seven. Farmers bring fresh vegetables, fruit and bread from the villages around the city. " +
    "People come early because the best products are sold quickly. In the afternoon the market is quiet, and the farmers go back home. " +
    "On Sundays there is also music, and families stay for lunch at the small restaurants near the square.",
  fr:
    "Le marché de la ville ouvre tous les matins à sept heures. Les agriculteurs apportent des légumes frais, des fruits et du pain des villages voisins. " +
    "Les gens viennent tôt parce que les meilleurs produits sont vendus rapidement. L'après-midi, le marché est calme et les agriculteurs rentrent chez eux. " +
    "Le dimanche, il y a aussi de la musique et les familles restent déjeuner dans les petits restaurants près de la place.",
};

async function waitFor<T>(fn: () => Promise<T | null | undefined | false>): Promise<T> {
  for (let i = 0; i < 150; i++) {
    const v = await fn();
    if (v) return v as T;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("timed out");
}
const body = (r: Response) => r.json();
const cctx = () => ({ params: { courseId } });

beforeAll(async () => {
  me = await createTestUser("PolyLingue phase 2");
  other = await createTestUser("PolyLingue phase 2 outsider");
  // A course in English or French (languages the source detector knows), at a pair nobody uses.
  const used = new Set((await prisma.langCurriculum.findMany({ select: { targetLang: true, baseLang: true, level: true } })).map((c) => `${c.targetLang}/${c.baseLang}/${c.level}`));
  let combo: { t: "en" | "fr"; b: string; l: Cefr } | null = null;
  outer: for (const t of ["en", "fr"] as const) {
    const b = t === "en" ? "fr" : "en";
    for (const l of CEFR_LEVELS.slice(0, 3)) {
      if (!used.has(`${t}/${curriculumBaseLang(t, b, l)}/${l}`)) {
        combo = { t, b, l };
        break outer;
      }
    }
  }
  if (!combo) throw new Error("no unused language/level pair for the test");
  target = combo.t;

  // The learner's own material: a note in that language, imported like any source.
  const set = await prisma.studySet.create({ data: { workspaceId: me.workspaceId, createdById: me.id, title: "My notes" } });
  const source = await prisma.source.create({ data: { studySetId: set.id, type: "NOTE", title: "The market", status: "FAILED" } });
  sourceId = source.id;
  const key = sourceAssetKey(set.workspaceId, set.id, source.id, "text/plain");
  await getStorage().put(key, Buffer.from(TEXT[target]), { contentType: "text/plain" });
  await prisma.sourceAsset.create({ data: { sourceId, kind: "ORIGINAL", storageKey: key, filename: "market.txt", mimeType: "text/plain" } });
  signInAs(me.id);
  const job = (await body(await reprocess(jsonRequest(`${BASE}/x`, "POST"), { params: { studySetId: set.id, sourceId } }))).jobId as string;
  await waitFor(async () => (await prisma.generationJob.findUniqueOrThrow({ where: { id: job } })).status === "SUCCEEDED");

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
  await disposeTestUser(other.email);
  await prisma.langCurriculum.deleteMany({ where: { id: curriculumId } });
  await prisma.$disconnect();
});

describe("PolyLingue phase 2: hints", () => {
  it("gives a hint without the answer, keeps it for everyone, and halves the XP", async () => {
    signInAs(me.id);
    const lessonId = (await body(await getCourse(new NextRequest(`${BASE}/x`), cctx()))).nextLesson.id;
    await waitFor(async () => (await body(await getLesson(new NextRequest(`${BASE}/x`), { params: { courseId, lessonId } }))).status === "READY");
    const lctx = { params: { courseId, lessonId } };
    const first = await body(await hintRoute(jsonRequest(`${BASE}/x`, "POST", { index: 0 }), lctx));
    expect(first.hint).toEqual(expect.any(String));
    const stored = (await prisma.langLesson.findUniqueOrThrow({ where: { id: lessonId } })).content as unknown as LessonContent & { hints: Record<string, string> };
    expect(stored.hints["0"]).toBe(first.hint);
    expect((await body(await hintRoute(jsonRequest(`${BASE}/x`, "POST", { index: 0 }), lctx))).hint).toBe(first.hint);

    const r = await body(await answerRoute(jsonRequest(`${BASE}/x`, "POST", { index: 0, answer: stored.exercises[0].answer, hinted: true }), lctx));
    expect(r).toMatchObject({ verdict: "correct", xp: 5 });
    expect((await hintRoute(jsonRequest(`${BASE}/x`, "POST", { index: 40 }), lctx)).status).toBe(404);
  });
});

describe("PolyLingue phase 2: learn from your own material", () => {
  it("lists the learner's sources in the language learned", async () => {
    signInAs(me.id);
    const { sources } = await body(await sourcesGet(new NextRequest(`${BASE}/x`), cctx()));
    expect(sources).toEqual([expect.objectContaining({ id: sourceId, title: "The market", via: "original" })]);
    const parts = await body(await sourcesGet(new NextRequest(`${BASE}/x?source=${sourceId}`), cctx()));
    expect(parts.parts).toBeGreaterThanOrEqual(1);
    expect(parts.preview[0]).toContain(target === "en" ? "market" : "marché");
  });

  it("makes a personal lesson from a part of the source, outside the course order", async () => {
    signInAs(me.id);
    const res = await sourcesPost(jsonRequest(`${BASE}/x`, "POST", { sourceId, part: 0 }), cctx());
    expect(res.status).toBe(201);
    const { id } = await body(res);
    const row = await prisma.langLesson.findUniqueOrThrow({ where: { id } });
    expect(row).toMatchObject({ courseId, sourceId, ordinal: null, unitTitle: "The market" });
    expect(row.sourceExcerpt).toContain(target === "en" ? "farmers" : "agriculteurs");
    const lesson = await waitFor(async () => {
      const l = await body(await getLesson(new NextRequest(`${BASE}/x`), { params: { courseId, lessonId: id } }));
      return l.status === "READY" && l;
    });
    expect(lesson.content.exercises.length).toBeGreaterThan(0);

    const detail = await body(await getCourse(new NextRequest(`${BASE}/x`), cctx()));
    expect(detail.sourceLessons.map((l: { id: string }) => l.id)).toEqual([id]);
    expect(detail.nextLesson.id).not.toBe(id);
    expect(detail.units.flatMap((u: { lessons: { id: string }[] }) => u.lessons).map((l: { id: string }) => l.id)).not.toContain(id);

    expect((await sourcesPost(jsonRequest(`${BASE}/x`, "POST", { sourceId, part: 99 }), cctx())).status).toBe(400);
    expect((await sourcesPost(jsonRequest(`${BASE}/x`, "POST", { sourceId: "nope", part: 0 }), cctx())).status).toBe(404);
  });

  it("never offers or opens another learner's material", async () => {
    signInAs(other.id);
    const theirs = (await body(await startCourse(
      jsonRequest(`${BASE}/x`, "POST", { level: (await prisma.languageCourse.findUniqueOrThrow({ where: { id: courseId } })).level, targetLang: target, baseLang: target === "en" ? "fr" : "en", dailyGoalMinutes: 10, timeZone: "UTC" }),
      {} as never,
    ))).course.id as string;
    const { sources } = await body(await sourcesGet(new NextRequest(`${BASE}/x`), { params: { courseId: theirs } }));
    expect(sources.map((s: { id: string }) => s.id)).not.toContain(sourceId);
    expect((await sourcesPost(jsonRequest(`${BASE}/x`, "POST", { sourceId, part: 0 }), { params: { courseId: theirs } })).status).toBe(404);
    const mine = await prisma.langLesson.findFirstOrThrow({ where: { courseId } });
    expect((await getLesson(new NextRequest(`${BASE}/x`), { params: { courseId: theirs, lessonId: mine.id } })).status).toBe(404);
    await prisma.languageCourse.delete({ where: { id: theirs } });
  });
});
