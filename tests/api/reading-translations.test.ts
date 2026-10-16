import { describe, it, expect, beforeAll, afterAll } from "vitest";
import "./helpers";
import { prisma, createTestUser, disposeTestUser, signInAs, jsonRequest, type TestUser } from "./helpers";
import { NextRequest } from "next/server";
import { getStorage, sourceAssetKey } from "@/lib/storage";
import { searchChunks } from "@/lib/retrieval";
import { POST as reprocess } from "@/app/api/study-sets/[studySetId]/sources/[sourceId]/reprocess/route";
import { GET as readerRoute } from "@/app/api/study-sets/[studySetId]/sources/[sourceId]/reader/route";
import { GET as speechRoute } from "@/app/api/study-sets/[studySetId]/sources/[sourceId]/speech/route";
import { POST as translateRoute } from "@/app/api/study-sets/[studySetId]/sources/[sourceId]/translate/route";
import { GET as languagesRoute } from "@/app/api/translation/languages/route";

/**
 * Reading translations (offline: the mock translator marks text "[ES] …"):
 * any source can be translated into a language the translator offers, to read
 * and listen to. Nothing is embedded, so search and generation are unchanged.
 */
const BASE = "http://localhost";
let me: TestUser;
let other: TestUser;
let studySetId: string;
let sourceId: string;

const ENGLISH =
  "Candlestick charts show the open, high, low and close of each period. A long lower wick means buyers pushed the price back up, " +
  "and a long upper wick means sellers did. Traders read these patterns to judge who is in control of the market.";

const ctx = () => ({ params: { studySetId, sourceId } });
const translate = (body?: unknown) => translateRoute(jsonRequest(`${BASE}/x`, "POST", body), ctx());

async function waitFor(check: () => Promise<boolean>) {
  for (let i = 0; i < 100; i++) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("timed out");
}

beforeAll(async () => {
  me = await createTestUser("Reading translations");
  other = await createTestUser("Reading translations outsider");
  const set = await prisma.studySet.create({ data: { workspaceId: me.workspaceId, createdById: me.id, title: "Candlesticks" } });
  studySetId = set.id;
  const source = await prisma.source.create({ data: { studySetId, type: "NOTE", title: "candles", status: "FAILED" } });
  sourceId = source.id;
  const key = sourceAssetKey(set.workspaceId, studySetId, source.id, "text/plain");
  await getStorage().put(key, Buffer.from(ENGLISH), { contentType: "text/plain" });
  await prisma.sourceAsset.create({ data: { sourceId, kind: "ORIGINAL", storageKey: key, filename: "candles.txt", mimeType: "text/plain" } });
  signInAs(me.id);
  const res = await reprocess(jsonRequest(`${BASE}/x`, "POST"), ctx());
  const { jobId } = await res.json();
  await waitFor(async () => (await prisma.generationJob.findUniqueOrThrow({ where: { id: jobId } })).status === "SUCCEEDED");
});

afterAll(async () => {
  await disposeTestUser(me.email);
  await disposeTestUser(other.email);
  await prisma.$disconnect();
});

describe("reading translations", () => {
  it("lists the languages the translator offers", async () => {
    signInAs(me.id);
    const body = await (await languagesRoute(new NextRequest(`${BASE}/api/translation/languages`), {} as never)).json();
    expect(body.translator).toBe("mock");
    expect(body.languages.map((l: { code: string }) => l.code)).toEqual(expect.arrayContaining(["es", "de", "ja", "zh-Hans"]));
    expect(body.languages.find((l: { code: string }) => l.code === "es").name).toBe("Spanish");
  });

  it("translates a source into another language for reading only", async () => {
    signInAs(me.id);
    const embeddedBefore = await prisma.extractedChunk.count({ where: { sourceId } });
    const res = await translate({ to: "es" });
    expect(res.status).toBe(202);
    expect(await res.json()).toMatchObject({ started: true, to: "es" });
    await waitFor(async () => {
      const s = await prisma.source.findUniqueOrThrow({ where: { id: sourceId }, select: { metadata: true } });
      return (s.metadata as { readingTranslations?: Record<string, { status: string }> }).readingTranslations?.es?.status === "done";
    });

    const reader = await (await readerRoute(new NextRequest(`${BASE}/reader`), ctx())).json();
    expect(reader.languages).toEqual(["en", "es"]);
    expect(reader.items[0].text.es).toBe(`[ES] ${reader.items[0].text.en}`);
    expect(reader.voices).toMatchObject({ en: expect.any(String), es: expect.any(String) });
    // The progress bar's numbers: complete, with the start time for the estimate.
    expect(reader.readingTranslations.es).toMatchObject({ status: "done", done: 1, total: 1, startedAt: expect.any(String) });

    // Not vectorized: no new passages, and search never returns the Spanish text.
    expect(await prisma.extractedChunk.count({ where: { sourceId } })).toBe(embeddedBefore);
    const hits = await searchChunks(studySetId, "[ES] Candlestick charts", { k: 10, minScore: -1 });
    expect(hits.some((h) => h.content.startsWith("[ES]"))).toBe(false);
  });

  it("reads the translation aloud", async () => {
    signInAs(me.id);
    const res = await speechRoute(new NextRequest(`${BASE}/speech?lang=es&index=0`), ctx());
    expect(res.status).toBe(200);
    expect(Buffer.from(await res.arrayBuffer()).toString("ascii", 0, 4)).toBe("RIFF");
  });

  it("refuses the original language, unknown languages, and a second translation while one runs", async () => {
    signInAs(me.id);
    expect((await translate({ to: "en" })).status).toBe(400);
    expect((await translate({ to: "xx" })).status).toBe(400);

    const source = await prisma.source.findUniqueOrThrow({ where: { id: sourceId }, select: { metadata: true } });
    const metadata = source.metadata as Record<string, unknown>;
    await prisma.source.update({
      where: { id: sourceId },
      data: { metadata: { ...metadata, readingTranslations: { de: { status: "running", from: "en", to: "de", at: new Date().toISOString() } } } },
    });
    const busy = await translate({ to: "it" });
    expect(busy.status).toBe(409);
    await prisma.source.update({ where: { id: sourceId }, data: { metadata: metadata as object } });
  });

  it("keeps translation to the study set's writers", async () => {
    signInAs(other.id);
    expect((await translate({ to: "de" })).status).not.toBe(202);
    signInAs(null);
    expect((await languagesRoute(new NextRequest(`${BASE}/api/translation/languages`), {} as never)).status).toBe(401);
  });
});
