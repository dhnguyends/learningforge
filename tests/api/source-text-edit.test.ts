import { describe, it, expect, beforeAll, afterAll } from "vitest";
import "./helpers";
import { prisma, createTestUser, disposeTestUser, signInAs, jsonRequest, type TestUser } from "./helpers";
import { NextRequest } from "next/server";
import { getStorage, sourceAssetKey } from "@/lib/storage";
import { POST as reprocess } from "@/app/api/study-sets/[studySetId]/sources/[sourceId]/reprocess/route";
import { GET as readerRoute } from "@/app/api/study-sets/[studySetId]/sources/[sourceId]/reader/route";
import { PUT as textRoute } from "@/app/api/study-sets/[studySetId]/sources/[sourceId]/text/route";
import { DELETE as deleteTranslationRoute, POST as translateRoute } from "@/app/api/study-sets/[studySetId]/sources/[sourceId]/translate/route";

/**
 * Hand corrections of a source's text: the original (re-indexed for search),
 * the searchable English translation (re-indexed), a reading translation (not
 * vectorized), and transcript segments (the passages covering them rebuilt).
 */
const BASE = "http://localhost";
let me: TestUser;
let other: TestUser;
let studySetId: string;
let frId: string;
let avId: string;

const FRENCH =
  "La loi d'Ohm relie la tension, le courant et la résistance dans un circuit électrique. " +
  "Dans un conducteur ohmique, la tension est égale au produit de la résistance par le courant qui le traverse.";

const ctx = (sourceId: string) => ({ params: { studySetId, sourceId } });
const put = (sourceId: string, body: unknown) => textRoute(jsonRequest(`${BASE}/x`, "PUT", body), ctx(sourceId));
const vectorOf = async (id: string) =>
  (await prisma.$queryRawUnsafe<{ v: string | null }[]>(`SELECT embedding::text AS v FROM "extracted_chunks" WHERE id = $1`, id))[0]?.v;

beforeAll(async () => {
  me = await createTestUser("Text editor");
  other = await createTestUser("Text editor outsider");
  const set = await prisma.studySet.create({ data: { workspaceId: me.workspaceId, createdById: me.id, title: "Électricité" } });
  studySetId = set.id;

  // A French document: imported, with its English (searchable) translation…
  const source = await prisma.source.create({ data: { studySetId, type: "NOTE", title: "ohm", status: "FAILED" } });
  frId = source.id;
  const key = sourceAssetKey(set.workspaceId, studySetId, frId, "text/plain");
  await getStorage().put(key, Buffer.from(FRENCH), { contentType: "text/plain" });
  await prisma.sourceAsset.create({ data: { sourceId: frId, kind: "ORIGINAL", storageKey: key, filename: "ohm.txt", mimeType: "text/plain" } });
  signInAs(me.id);
  const job = (await (await reprocess(jsonRequest(`${BASE}/x`, "POST"), ctx(frId))).json()).jobId as string;
  for (let i = 0; i < 100; i++) {
    if ((await prisma.generationJob.findUniqueOrThrow({ where: { id: job } })).status === "SUCCEEDED") break;
    await new Promise((r) => setTimeout(r, 100));
  }
  // …and a Spanish reading translation.
  const originals = await prisma.extractedChunk.findMany({ where: { sourceId: frId, translationOfId: null } });
  for (const o of originals) await prisma.extractedChunk.update({ where: { id: o.id }, data: { readingTranslations: { es: `[ES] ${o.content}` } } });

  // A recording: three segments, one passage covering the first two.
  const av = await prisma.source.create({ data: { studySetId, type: "AUDIO", title: "lecture", status: "READY", language: "en" } });
  avId = av.id;
  await prisma.transcript.create({
    data: {
      sourceId: avId,
      provider: "test",
      status: "READY",
      segments: {
        create: [
          { idx: 0, startMs: 0, endMs: 2000, text: "Today we talk about the curent law.", translations: { fr: "Aujourd'hui, la loi des courants." } },
          { idx: 1, startMs: 2000, endMs: 4000, text: "It is about nodes.", translations: { fr: "Elle concerne les nœuds." } },
          { idx: 2, startMs: 30000, endMs: 32000, text: "Next, voltage.", translations: { fr: "Ensuite, la tension." } },
        ],
      },
    },
  });
  await prisma.extractedChunk.createMany({
    data: [
      { sourceId: avId, ordinal: 0, kind: "TRANSCRIPT", content: "Today we talk about the curent law. It is about nodes.", startMs: 0, endMs: 4000, tokenCount: 12 },
      { sourceId: avId, ordinal: 1, kind: "TRANSCRIPT", content: "Next, voltage.", startMs: 30000, endMs: 32000, tokenCount: 3 },
    ],
  });
});

afterAll(async () => {
  await disposeTestUser(me.email);
  await disposeTestUser(other.email);
  await prisma.$disconnect();
});

describe("editing a document's text", () => {
  it("corrects the original, keeps the text before, and re-indexes it for search", async () => {
    signInAs(me.id);
    const passage = await prisma.extractedChunk.findFirstOrThrow({ where: { sourceId: frId, translationOfId: null }, orderBy: { ordinal: "asc" } });
    const before = await vectorOf(passage.id);
    const text = `${passage.content}\nLa puissance vaut P = U × I.`;
    const res = await put(frId, { lang: "fr", edits: [{ id: passage.id, text: `  ${text}  \r\n` }] });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ saved: 1, reindexed: 1 });
    const row = await prisma.extractedChunk.findUniqueOrThrow({ where: { id: passage.id } });
    expect(row.content).toBe(text);
    expect(await vectorOf(passage.id)).not.toBe(before);
    const history = await prisma.artifactEdit.findFirstOrThrow({ where: { entityType: "source_text", entityId: passage.id } });
    expect(history).toMatchObject({ version: 1, editedById: me.id, snapshot: { lang: "fr", text: passage.content } });

    const reader = await (await readerRoute(new NextRequest(`${BASE}/x`), ctx(frId))).json();
    const item = reader.items.find((i: { id: string }) => i.id === passage.id);
    expect(item.text.fr).toBe(text);
    expect(item.edited).toEqual(["fr"]);
    // Saving the same text again changes nothing.
    expect(await (await put(frId, { lang: "fr", edits: [{ id: passage.id, text }] })).json()).toEqual({ saved: 0, reindexed: 0 });
  });

  it("corrects the searchable English translation (re-indexed) and a reading translation (not)", async () => {
    signInAs(me.id);
    const passage = await prisma.extractedChunk.findFirstOrThrow({ where: { sourceId: frId, translationOfId: null }, orderBy: { ordinal: "asc" } });
    const sibling = await prisma.extractedChunk.findFirstOrThrow({ where: { translationOfId: passage.id, language: "en" } });
    const fixed = "Ohm's law links voltage, current and resistance.";
    expect(await (await put(frId, { lang: "en", edits: [{ id: passage.id, text: fixed }] })).json()).toEqual({ saved: 1, reindexed: 1 });
    expect((await prisma.extractedChunk.findUniqueOrThrow({ where: { id: sibling.id } })).content).toBe(fixed);

    expect(await (await put(frId, { lang: "es", edits: [{ id: passage.id, text: "La ley de Ohm." }] })).json()).toEqual({ saved: 1, reindexed: 0 });
    const row = await prisma.extractedChunk.findUniqueOrThrow({ where: { id: passage.id } });
    expect(row.readingTranslations).toEqual({ es: "La ley de Ohm." });
    expect(await prisma.extractedChunk.count({ where: { sourceId: frId, language: "es" } })).toBe(0);
  });

  it("refuses an empty original, text of another source, an unknown language, and outsiders", async () => {
    signInAs(me.id);
    const passage = await prisma.extractedChunk.findFirstOrThrow({ where: { sourceId: frId, translationOfId: null } });
    const segment = await prisma.transcriptSegment.findFirstOrThrow({ where: { transcript: { sourceId: avId } } });
    expect((await put(frId, { lang: "fr", edits: [{ id: passage.id, text: "   " }] })).status).toBe(400);
    expect((await put(frId, { lang: "fr", edits: [{ id: segment.id, text: "x" }] })).status).toBe(400);
    expect((await put(frId, { lang: "de", edits: [{ id: passage.id, text: "x" }] })).status).toBe(400);
    expect((await put(frId, { lang: "fr", edits: [] })).status).toBe(400);
    signInAs(other.id);
    expect([403, 404]).toContain((await put(frId, { lang: "fr", edits: [{ id: passage.id, text: "hacked" }] })).status);
    expect((await prisma.extractedChunk.findUniqueOrThrow({ where: { id: passage.id } })).content).not.toBe("hacked");
  });
});

describe("editing a transcript", () => {
  it("corrects segments and rebuilds only the passage that covers them", async () => {
    signInAs(me.id);
    const [first] = await prisma.transcriptSegment.findMany({ where: { transcript: { sourceId: avId } }, orderBy: { idx: "asc" } });
    const res = await put(avId, { lang: "en", edits: [{ id: first.id, text: "Today we talk about the current law." }] });
    expect(await res.json()).toEqual({ saved: 1, reindexed: 1 });
    expect(await prisma.transcriptSegment.findUniqueOrThrow({ where: { id: first.id } })).toMatchObject({ text: "Today we talk about the current law.", edited: true });
    const chunks = await prisma.extractedChunk.findMany({ where: { sourceId: avId }, orderBy: { ordinal: "asc" } });
    expect(chunks.map((c) => c.content)).toEqual(["Today we talk about the current law. It is about nodes.", "Next, voltage."]);
  });

  it("corrects a translation of the transcript without touching the original", async () => {
    signInAs(me.id);
    const [, second] = await prisma.transcriptSegment.findMany({ where: { transcript: { sourceId: avId } }, orderBy: { idx: "asc" } });
    expect(await (await put(avId, { lang: "fr", edits: [{ id: second.id, text: "Il s'agit des nœuds." }] })).json()).toEqual({ saved: 1, reindexed: 0 });
    expect(await prisma.transcriptSegment.findUniqueOrThrow({ where: { id: second.id } })).toMatchObject({
      text: "It is about nodes.",
      edited: false,
      translations: { fr: "Il s'agit des nœuds." },
    });
  });
});

describe("deleting a translation, then translating again", () => {
  const del = (sourceId: string, to?: string) =>
    deleteTranslationRoute(new NextRequest(`${BASE}/x${to ? `?to=${to}` : ""}`, { method: "DELETE" }), ctx(sourceId));

  it("deletes a reading translation and its corrections, keeping the original and the other translations", async () => {
    signInAs(me.id);
    const res = await del(frId, "ES");
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ deleted: "es", search: false });
    const passages = await prisma.extractedChunk.findMany({ where: { sourceId: frId, translationOfId: null } });
    expect(passages.every((p) => !("es" in (p.readingTranslations as Record<string, string>)))).toBe(true);
    expect(await prisma.artifactEdit.count({ where: { entityType: "source_text", snapshot: { path: ["lang"], equals: "es" } , entityId: { in: passages.map((p) => p.id) } } })).toBe(0);
    expect(await prisma.artifactEdit.count({ where: { entityType: "source_text", snapshot: { path: ["lang"], equals: "fr" }, entityId: { in: passages.map((p) => p.id) } } })).toBe(1);
    const reader = await (await readerRoute(new NextRequest(`${BASE}/x`), ctx(frId))).json();
    expect(reader.languages).toEqual(["fr", "en"]);
    expect((await del(frId, "es")).status).toBe(404);
  });

  it("translates into the same language again", async () => {
    signInAs(me.id);
    expect((await translateRoute(jsonRequest(`${BASE}/x`, "POST", { to: "es" }), ctx(frId))).status).toBe(202);
    for (let i = 0; i < 100; i++) {
      const s = await prisma.source.findUniqueOrThrow({ where: { id: frId } });
      if ((s.metadata as { readingTranslations?: Record<string, { status: string }> }).readingTranslations?.es?.status === "done") break;
      await new Promise((r) => setTimeout(r, 100));
    }
    const reader = await (await readerRoute(new NextRequest(`${BASE}/x`), ctx(frId))).json();
    expect(reader.languages).toEqual(["fr", "en", "es"]);
  });

  it("deletes the English search translation of a French source", async () => {
    signInAs(me.id);
    expect(await (await del(frId, "en")).json()).toMatchObject({ deleted: "en", search: true });
    expect(await prisma.extractedChunk.count({ where: { sourceId: frId, translationOfId: { not: null } } })).toBe(0);
    const source = await prisma.source.findUniqueOrThrow({ where: { id: frId } });
    expect((source.metadata as { translation?: unknown }).translation).toBeUndefined();
  });

  it("deletes a transcript translation without touching the transcript", async () => {
    signInAs(me.id);
    expect(await (await del(avId, "fr")).json()).toMatchObject({ deleted: "fr", segments: 3, search: false });
    const segments = await prisma.transcriptSegment.findMany({ where: { transcript: { sourceId: avId } }, orderBy: { idx: "asc" } });
    expect(segments.map((s) => s.translations)).toEqual([{}, {}, {}]);
    expect(segments[0].text).toBe("Today we talk about the current law.");
  });

  it("never deletes the original, needs a language, and refuses outsiders", async () => {
    signInAs(me.id);
    expect((await del(frId, "fr")).status).toBe(400);
    expect((await del(frId)).status).toBe(400);
    expect((await del(frId, "de")).status).toBe(404);
    signInAs(other.id);
    expect([403, 404]).toContain((await del(frId, "es")).status);
    const passages = await prisma.extractedChunk.findMany({ where: { sourceId: frId, translationOfId: null } });
    expect(passages.every((p) => typeof (p.readingTranslations as Record<string, string>).es === "string")).toBe(true);
  });
});
