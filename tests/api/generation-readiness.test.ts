import { describe, it, expect, beforeAll, afterAll } from "vitest";
import "./helpers";
import { prisma, createTestUser, disposeTestUser, signInAs, jsonRequest, type TestUser } from "./helpers";
import { indexChunks } from "@/lib/retrieval";
import { getIndexingReadiness } from "@/lib/retrieval/readiness";
import { POST as generateGuide } from "@/app/api/study-sets/[studySetId]/guide/route";
import { POST as generateDeck } from "@/app/api/study-sets/[studySetId]/flashcards/route";
import { POST as generateQuiz } from "@/app/api/study-sets/[studySetId]/quiz/route";
import { POST as generateExercises } from "@/app/api/study-sets/[studySetId]/exercises/route";
import { GET as readinessRoute } from "@/app/api/study-sets/[studySetId]/readiness/route";

/**
 * Generation (study guide, flashcards, quiz, exercises) waits until EVERY
 * source of the set is imported — READY, vectorized and indexed for semantic
 * search — and a refused request leaves no artifact row behind.
 */

let me: TestUser;
let studySetId: string;
let first: string;
let second: string;
const BASE = "http://localhost";
const ctx = () => ({ params: { studySetId } });

const draft = (content: string, ordinal: number) => ({ ordinal, kind: "DOCUMENT" as const, content, page: ordinal + 1, tokenCount: 40 });

beforeAll(async () => {
  me = await createTestUser("Readiness");
  const set = await prisma.studySet.create({
    data: { workspaceId: me.workspaceId, createdById: me.id, title: "Circuits", outputTypes: ["GUIDE", "FLASHCARDS", "QUIZ", "EXERCISES"] },
  });
  studySetId = set.id;
  first = (await prisma.source.create({ data: { studySetId, type: "PDF", title: "a.pdf", status: "READY" } })).id;
  await indexChunks(first, [draft("Ohm's law relates voltage, current and resistance: V = I R.", 0)]);
  second = (await prisma.source.create({ data: { studySetId, type: "PDF", title: "b.pdf", status: "PROCESSING" } })).id;
});

afterAll(async () => {
  await disposeTestUser(me.email);
  await prisma.$disconnect();
});

const artifactCount = async () =>
  (await prisma.studyGuide.count({ where: { studySetId } })) +
  (await prisma.flashcardDeck.count({ where: { studySetId } })) +
  (await prisma.quiz.count({ where: { studySetId } })) +
  (await prisma.exerciseSet.count({ where: { studySetId } }));

describe("generation waits for every source to be imported", () => {
  it("refuses all four generators while a source is still processing, creating nothing", async () => {
    signInAs(me.id);
    const calls = [
      generateGuide(jsonRequest(`${BASE}/x`, "POST", {}), ctx()),
      generateDeck(jsonRequest(`${BASE}/x`, "POST", {}), ctx()),
      generateQuiz(jsonRequest(`${BASE}/x`, "POST", {}), ctx()),
      generateExercises(jsonRequest(`${BASE}/x`, "POST", {}), ctx()),
    ];
    for (const res of await Promise.all(calls)) {
      expect(res.status).toBe(409);
      const body = await res.json();
      expect(body.code).toBe("sources_not_ready");
      expect(body.error).toMatch(/1 of 2 ready/);
    }
    expect(await artifactCount()).toBe(0);
  });

  it("reports progress through the readiness endpoint", async () => {
    signInAs(me.id);
    const res = await readinessRoute(jsonRequest(`${BASE}/x`, "GET"), ctx());
    expect(await res.json()).toMatchObject({ ready: false, sources: { total: 2, ready: 1, processing: 1, failed: 0 } });
  });

  it("stays blocked when a source failed", async () => {
    await prisma.source.update({ where: { id: second }, data: { status: "FAILED", error: "parse error" } });
    const r = await getIndexingReadiness(studySetId);
    expect(r.ready).toBe(false);
    expect(r.reason).toMatch(/failed to import/);
  });

  it("stays blocked while a READY source has passages without a current vector", async () => {
    await prisma.source.update({ where: { id: second }, data: { status: "READY", error: null } });
    await indexChunks(second, [draft("Capacitors store energy in an electric field.", 0)]);
    await prisma.extractedChunk.updateMany({ where: { sourceId: second }, data: { embeddingModel: "some-other-model" } });
    const r = await getIndexingReadiness(studySetId);
    expect(r).toMatchObject({ ready: false, pendingChunks: 1 });
    expect(r.reason).toMatch(/reembed/);
  });

  it("allows generation once every source is vectorized and indexed", async () => {
    await indexChunks(second, [draft("Capacitors store energy in an electric field.", 0)]);
    expect(await getIndexingReadiness(studySetId)).toMatchObject({ ready: true, reason: null, pendingChunks: 0 });
    signInAs(me.id);
    const res = await generateQuiz(jsonRequest(`${BASE}/x`, "POST", { count: 3 }), ctx());
    expect(res.status).toBe(202);
  });
});
