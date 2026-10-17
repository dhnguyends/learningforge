import { describe, it, expect, beforeAll, afterAll } from "vitest";
import "./helpers";
import { prisma, createTestUser, disposeTestUser, signInAs, type TestUser } from "./helpers";
import { NextRequest } from "next/server";
import { POST as speakingRoute } from "@/app/api/polylingue/courses/[courseId]/practices/[practiceId]/speaking/route";
import { GET as listRoute, DELETE as deleteRoute } from "@/app/api/polylingue/courses/[courseId]/practices/[practiceId]/recordings/route";
import { GET as audioRoute, DELETE as deleteOneRoute } from "@/app/api/polylingue/recordings/[recordingId]/route";
import { DELETE as deleteCourseRoute } from "@/app/api/polylingue/courses/[courseId]/route";
import { getStorage } from "@/lib/storage";
import { recordingsPrefix } from "@/lib/polylingue/recordings";
import { TARGET_LANGUAGES, BASE_LANGUAGES } from "@/lib/polylingue/levels";

/**
 * Speaking practice keeps the learner's spoken answers: per item the latest
 * and the best (highest score), converted to WAV, playable by the learner
 * only, deleted on request, with the course, or with the account. Mock
 * transcriber offline; a hand-written practice at a pair nobody uses.
 */
const BASE = "http://localhost";
let me: TestUser;
let other: TestUser;
let curriculumId: string;
let courseId: string;
let practiceId: string;

/** A short silent WAV, as a browser recording would be (ffmpeg converts it again to 24 kHz mono). */
function silentWav(ms = 400, rate = 16_000): Uint8Array {
  const n = Math.round((rate * ms) / 1000);
  const buf = new ArrayBuffer(44 + n * 2);
  const v = new DataView(buf);
  const text = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  text(0, "RIFF");
  v.setUint32(4, 36 + n * 2, true);
  text(8, "WAVE");
  text(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  text(36, "data");
  v.setUint32(40, n * 2, true);
  return new Uint8Array(buf);
}

const speak = (kind: string, index: number) => {
  const f = new FormData();
  f.set("kind", kind);
  f.set("index", String(index));
  f.set("audio", new Blob([silentWav()], { type: "audio/wav" }), "speech.wav");
  return speakingRoute(new NextRequest(`${BASE}/x`, { method: "POST", body: f }), { params: { courseId, practiceId } });
};
const pctx = () => ({ params: { courseId, practiceId } });
const list = async () => (await (await listRoute(new NextRequest(`${BASE}/x`), pctx())).json()).items;

beforeAll(async () => {
  me = await createTestUser("Speaker");
  other = await createTestUser("Speaker outsider");
  const used = new Set((await prisma.langCurriculum.findMany({ select: { targetLang: true, baseLang: true, level: true } })).map((c) => `${c.targetLang}/${c.baseLang}/${c.level}`));
  const pair = TARGET_LANGUAGES.flatMap((t) => BASE_LANGUAGES.filter((b) => b.code !== t.code).map((b) => [t.code, b.code])).find(([t, b]) => !used.has(`${t}/${b}/A1`));
  if (!pair) throw new Error("no unused pair");
  const c = await prisma.langCurriculum.create({ data: { targetLang: pair[0], baseLang: pair[1], level: "A1", status: "READY" } });
  curriculumId = c.id;
  const p = await prisma.langPractice.create({
    data: {
      curriculumId,
      skill: "SPEAKING",
      unitIndex: 0,
      title: "Hello",
      status: "READY",
      content: {
        sentences: [
          { text: "Good morning everyone", meaning: "-" },
          { text: "See you tomorrow", meaning: "-" },
          { text: "Thank you very much", meaning: "-" },
        ],
        questions: [{ prompt: "Say hello", model: "Hello!" }],
      },
    },
  });
  practiceId = p.id;
  courseId = (await prisma.languageCourse.create({ data: { userId: me.id, targetLang: pair[0], baseLang: pair[1], level: "A1", curriculumId } })).id;
});

afterAll(async () => {
  await getStorage().deletePrefix(recordingsPrefix(me.id)).catch(() => undefined);
  await disposeTestUser(me.email);
  await disposeTestUser(other.email);
  await prisma.langCurriculum.deleteMany({ where: { id: curriculumId } });
  await prisma.$disconnect();
});

describe("kept spoken answers", () => {
  it("keeps the first answer as both the latest and the best, in WAV", async () => {
    signInAs(me.id);
    expect((await speak("sentence", 0)).status).toBe(200);
    const items = await list();
    expect(items["sentence-0"].latest).toMatchObject({ sameFileAsOther: true, score: expect.any(Number) });
    expect(items["sentence-0"].best.id).not.toBe(items["sentence-0"].latest.id);
    const audio = await audioRoute(new NextRequest(`${BASE}/x`), { params: { recordingId: items["sentence-0"].latest.id } });
    expect(audio.headers.get("content-type")).toBe("audio/wav");
    const bytes = new Uint8Array(await audio.arrayBuffer());
    expect(String.fromCharCode(...bytes.slice(0, 4))).toBe("RIFF");
    const saved = await audioRoute(new NextRequest(`${BASE}/x?download=1`), { params: { recordingId: items["sentence-0"].best.id } });
    expect(saved.headers.get("content-disposition")).toBe('attachment; filename="sentence-0-best.wav"');
  });

  it("replaces only the latest after a worse attempt, and both after a better one", async () => {
    signInAs(me.id);
    // Pretend the first attempt was excellent: the next (same mock score) is worse.
    await prisma.langRecording.update({ where: { courseId_practiceId_item_slot: { courseId, practiceId, item: "sentence-0", slot: "best" } }, data: { score: 100 } });
    await speak("sentence", 0);
    let items = await list();
    expect(items["sentence-0"].latest.sameFileAsOther).toBe(false);
    expect(items["sentence-0"].best.score).toBe(100);
    const files = await prisma.langRecording.findMany({ where: { courseId, item: "sentence-0" } });
    expect(new Set(files.map((f) => f.storageKey)).size).toBe(2);

    await prisma.langRecording.update({ where: { courseId_practiceId_item_slot: { courseId, practiceId, item: "sentence-0", slot: "best" } }, data: { score: 0 } });
    await speak("sentence", 0);
    items = await list();
    expect(items["sentence-0"].latest.sameFileAsOther).toBe(true); // the better attempt is both again
    // The two files it replaced were deleted from storage.
    const left = await prisma.langRecording.findMany({ where: { courseId, item: "sentence-0" } });
    expect(new Set(left.map((f) => f.storageKey)).size).toBe(1);
    for (const old of files.map((f) => f.storageKey)) {
      if (!left.some((l) => l.storageKey === old)) await expect(getStorage().read(old)).rejects.toBeTruthy();
    }
  });

  it("keeps answers to questions too", async () => {
    signInAs(me.id);
    await speak("question", 0);
    expect((await list())["question-0"].latest).toBeTruthy();
  });

  it("lets only the learner list or hear them", async () => {
    signInAs(other.id);
    expect((await listRoute(new NextRequest(`${BASE}/x`), pctx())).status).toBe(404);
    const id = (await prisma.langRecording.findFirstOrThrow({ where: { courseId } })).id;
    expect((await audioRoute(new NextRequest(`${BASE}/x`), { params: { recordingId: id } })).status).toBe(404);
  });

  it("deletes one recording, keeping a file the other slot still uses", async () => {
    signInAs(me.id);
    // Separate latest and best for sentence-0.
    await prisma.langRecording.update({ where: { courseId_practiceId_item_slot: { courseId, practiceId, item: "sentence-0", slot: "best" } }, data: { score: 100 } });
    await speak("sentence", 0);
    const before = await list();
    const latest = before["sentence-0"].latest;
    const best = before["sentence-0"].best;
    expect(latest.sameFileAsOther).toBe(false);
    const latestKey = (await prisma.langRecording.findUniqueOrThrow({ where: { id: latest.id } })).storageKey;
    const bestKey = (await prisma.langRecording.findUniqueOrThrow({ where: { id: best.id } })).storageKey;

    signInAs(other.id);
    expect((await deleteOneRoute(new NextRequest(`${BASE}/x`, { method: "DELETE" }), { params: { recordingId: latest.id } })).status).toBe(404);
    signInAs(me.id);
    expect(await (await deleteOneRoute(new NextRequest(`${BASE}/x`, { method: "DELETE" }), { params: { recordingId: latest.id } })).json()).toEqual({ fileDeleted: true });
    await expect(getStorage().read(latestKey)).rejects.toBeTruthy();
    const after = await list();
    expect(after["sentence-0"].latest).toBeUndefined();
    expect(after["sentence-0"].best.id).toBe(best.id);
    await expect(getStorage().read(bestKey)).resolves.toBeTruthy();

    // A take kept as both latest and best: deleting one row keeps the file for the other.
    const q = (await list())["question-0"];
    expect(q.latest.sameFileAsOther).toBe(true);
    const qKey = (await prisma.langRecording.findUniqueOrThrow({ where: { id: q.latest.id } })).storageKey;
    expect(await (await deleteOneRoute(new NextRequest(`${BASE}/x`, { method: "DELETE" }), { params: { recordingId: q.latest.id } })).json()).toEqual({ fileDeleted: false });
    await expect(getStorage().read(qKey)).resolves.toBeTruthy();
    expect(await (await deleteOneRoute(new NextRequest(`${BASE}/x`, { method: "DELETE" }), { params: { recordingId: q.best.id } })).json()).toEqual({ fileDeleted: true });
    await expect(getStorage().read(qKey)).rejects.toBeTruthy();
    expect((await list())["question-0"]).toBeUndefined();
    expect((await deleteOneRoute(new NextRequest(`${BASE}/x`, { method: "DELETE" }), { params: { recordingId: q.best.id } })).status).toBe(404);
  });

  it("deletes them on request (rows and files)", async () => {
    signInAs(me.id);
    const keys = (await prisma.langRecording.findMany({ where: { courseId, practiceId } })).map((r) => r.storageKey);
    expect(await (await deleteRoute(new NextRequest(`${BASE}/x`), pctx())).json()).toMatchObject({ deleted: keys.length });
    expect(await list()).toEqual({});
    for (const k of keys) await expect(getStorage().read(k)).rejects.toBeTruthy();
  });

  it("deletes the files with the course", async () => {
    signInAs(me.id);
    await speak("sentence", 1);
    const key = (await prisma.langRecording.findFirstOrThrow({ where: { courseId } })).storageKey;
    expect(key.startsWith(recordingsPrefix(me.id, courseId))).toBe(true);
    expect((await deleteCourseRoute(new NextRequest(`${BASE}/x`, { method: "DELETE" }), { params: { courseId } })).status).toBe(200);
    expect(await prisma.langRecording.count({ where: { courseId } })).toBe(0);
    await expect(getStorage().read(key)).rejects.toBeTruthy();
  });
});
