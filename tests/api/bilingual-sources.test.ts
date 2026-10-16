import { describe, it, expect, beforeAll, afterAll } from "vitest";
import "./helpers";
import { prisma, createTestUser, disposeTestUser, signInAs, jsonRequest, type TestUser } from "./helpers";
import { NextRequest } from "next/server";
import { getStorage, sourceAssetKey, sourcePrefix } from "@/lib/storage";
import { searchChunks, retrieveForWholeSet } from "@/lib/retrieval";
import { POST as reprocess } from "@/app/api/study-sets/[studySetId]/sources/[sourceId]/reprocess/route";
import { GET as readerRoute } from "@/app/api/study-sets/[studySetId]/sources/[sourceId]/reader/route";
import { GET as speechRoute } from "@/app/api/study-sets/[studySetId]/sources/[sourceId]/speech/route";
import { POST as translateRoute } from "@/app/api/study-sets/[studySetId]/sources/[sourceId]/translate/route";

/**
 * Bilingual sources (offline: mock translator marks text "[EN] …", mock
 * speaker returns silent WAV). A French source gets English sibling passages
 * that search folds back into the originals, whole-course retrieval ignores,
 * and the reader / read-aloud serve in either language.
 */
const BASE = "http://localhost";
let me: TestUser;
let other: TestUser;
let studySetId: string;
let workspaceId: string;

const FRENCH =
  "La loi d'Ohm relie la tension, le courant et la résistance dans un circuit électrique. " +
  "Dans un conducteur ohmique, la tension est égale au produit de la résistance par le courant qui le traverse. " +
  "Nous verrons aussi comment les condensateurs stockent de l'énergie et pourquoi la puissance dissipée dépend du carré du courant.";
const ENGLISH =
  "Kirchhoff's laws describe how current and voltage behave in a circuit. The current law says that the sum of currents " +
  "entering a node is equal to the sum of currents leaving it, and the voltage law is about loops in the network.";

const ctx = (sourceId: string) => ({ params: { studySetId, sourceId } });

async function waitForJob(jobId: string) {
  for (let i = 0; i < 100; i++) {
    const job = await prisma.generationJob.findUniqueOrThrow({ where: { id: jobId } });
    if (job.status === "SUCCEEDED" || job.status === "FAILED") return job;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("import job did not finish");
}

async function importNote(title: string, text: string): Promise<string> {
  const source = await prisma.source.create({ data: { studySetId, type: "NOTE", title, status: "FAILED" } });
  const key = sourceAssetKey(workspaceId, studySetId, source.id, "text/plain");
  await getStorage().put(key, Buffer.from(text), { contentType: "text/plain" });
  await prisma.sourceAsset.create({ data: { sourceId: source.id, kind: "ORIGINAL", storageKey: key, filename: `${title}.txt`, mimeType: "text/plain" } });
  signInAs(me.id);
  const res = await reprocess(jsonRequest(`${BASE}/x`, "POST"), ctx(source.id));
  expect(res.status).toBe(202);
  expect((await waitForJob((await res.json()).jobId)).status).toBe("SUCCEEDED");
  return source.id;
}

let frId: string;
let enId: string;

beforeAll(async () => {
  me = await createTestUser("Bilingual");
  other = await createTestUser("Bilingual outsider");
  const set = await prisma.studySet.create({ data: { workspaceId: me.workspaceId, createdById: me.id, title: "Électricité" } });
  studySetId = set.id;
  workspaceId = set.workspaceId;
  frId = await importNote("ohm-fr", FRENCH);
  enId = await importNote("kirchhoff-en", ENGLISH);
});

afterAll(async () => {
  await disposeTestUser(me.email);
  await disposeTestUser(other.email);
  await prisma.$disconnect();
});

describe("bilingual sources", () => {
  it("detects French at import and stores English sibling passages", async () => {
    const source = await prisma.source.findUniqueOrThrow({ where: { id: frId } });
    expect(source.language).toBe("fr");
    expect((source.metadata as { translation?: { status: string; to: string } }).translation).toMatchObject({ status: "done", to: "en" });

    const originals = await prisma.extractedChunk.findMany({ where: { sourceId: frId, translationOfId: null } });
    const translations = await prisma.extractedChunk.findMany({ where: { sourceId: frId, translationOfId: { not: null } } });
    expect(originals.length).toBeGreaterThan(0);
    expect(originals.every((c) => c.language === "fr")).toBe(true);
    expect(translations).toHaveLength(originals.length);
    for (const t of translations) {
      const o = originals.find((x) => x.id === t.translationOfId)!;
      expect(t).toMatchObject({ language: "en", content: `[EN] ${o.content}`, page: o.page, kind: o.kind });
    }
  });

  it("leaves English sources alone", async () => {
    expect((await prisma.source.findUniqueOrThrow({ where: { id: enId } })).language).toBe("en");
    expect(await prisma.extractedChunk.count({ where: { sourceId: enId, translationOfId: { not: null } } })).toBe(0);
  });

  it("search returns originals only, each passage once", async () => {
    const hits = await searchChunks(studySetId, "[EN] La loi d'Ohm relie la tension", { k: 10, minScore: -1 });
    const translatedIds = new Set(
      (await prisma.extractedChunk.findMany({ where: { sourceId: frId, translationOfId: { not: null } }, select: { id: true } })).map((c) => c.id),
    );
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.some((h) => translatedIds.has(h.id))).toBe(false);
    expect(new Set(hits.map((h) => h.id)).size).toBe(hits.length);
    expect(hits.find((h) => h.sourceId === frId)?.content).toContain("La loi d'Ohm");
  });

  it("whole-course retrieval excludes translations", async () => {
    const all = await retrieveForWholeSet(studySetId, "Électricité", { k: 2, tokenBudget: 100_000 });
    const originals = await prisma.extractedChunk.count({ where: { source: { studySetId }, translationOfId: null } });
    expect(all).toHaveLength(originals);
    expect(all.some((c) => c.content.startsWith("[EN] "))).toBe(false);
  });

  it("serves the reader in both languages", async () => {
    signInAs(me.id);
    const res = await readerRoute(new NextRequest(`${BASE}/reader`), ctx(frId));
    expect(res.status).toBe(200);
    const reader = await res.json();
    expect(reader).toMatchObject({ kind: "passages", original: "fr", languages: ["fr", "en"] });
    expect(reader.items[0].text.fr).toContain("La loi d'Ohm");
    expect(reader.items[0].text.en).toBe(`[EN] ${reader.items[0].text.fr}`);

    const en = await (await readerRoute(new NextRequest(`${BASE}/reader`), ctx(enId))).json();
    expect(en).toMatchObject({ original: "en", languages: ["en"] });
  });

  it("reads aloud on demand and caches the clip with the source", async () => {
    signInAs(me.id);
    const res = await speechRoute(new NextRequest(`${BASE}/speech?lang=en&index=0`), ctx(frId));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("audio/wav");
    expect(Buffer.from(await res.arrayBuffer()).toString("ascii", 0, 4)).toBe("RIFF");
    const cached = await getStorage().list(`${sourcePrefix(workspaceId, studySetId, frId)}/tts`);
    expect(cached.some((k) => /\/tts\/mock\/en\/passages-0-[0-9a-f]{16}\.wav$/.test(k))).toBe(true);

    expect((await speechRoute(new NextRequest(`${BASE}/speech?lang=%3Cscript%3E&index=0`), ctx(frId))).status).toBe(400);
    expect((await speechRoute(new NextRequest(`${BASE}/speech?lang=de&index=0`), ctx(frId))).status).toBe(404); // no German text yet
    expect((await speechRoute(new NextRequest(`${BASE}/speech?lang=fr&index=0`), ctx(enId))).status).toBe(404);
    expect((await speechRoute(new NextRequest(`${BASE}/speech?lang=en&index=999`), ctx(frId))).status).toBe(404);
  });

  it("keeps the reader, read-aloud and translation to the study set's members", async () => {
    signInAs(other.id);
    expect((await readerRoute(new NextRequest(`${BASE}/reader`), ctx(frId))).status).not.toBe(200);
    expect((await speechRoute(new NextRequest(`${BASE}/speech?lang=en&index=0`), ctx(frId))).status).not.toBe(200);
    expect((await translateRoute(jsonRequest(`${BASE}/x`, "POST"), ctx(frId))).status).not.toBe(202);
    signInAs(null);
    expect((await readerRoute(new NextRequest(`${BASE}/reader`), ctx(frId))).status).toBe(401);
  });

  it("translates an existing source on request, and only French ones", async () => {
    signInAs(me.id);
    expect((await translateRoute(jsonRequest(`${BASE}/x`, "POST"), ctx(enId))).status).toBe(400);

    // An older import: no language recorded, no translations yet.
    await prisma.extractedChunk.deleteMany({ where: { sourceId: frId, translationOfId: { not: null } } });
    await prisma.source.update({ where: { id: frId }, data: { language: null, metadata: {} } });
    const res = await translateRoute(jsonRequest(`${BASE}/x`, "POST"), ctx(frId));
    expect(res.status).toBe(202);
    for (let i = 0; i < 50; i++) {
      const s = await prisma.source.findUniqueOrThrow({ where: { id: frId } });
      if ((s.metadata as { translation?: { status: string } }).translation?.status === "done") break;
      await new Promise((r) => setTimeout(r, 100));
    }
    const s = await prisma.source.findUniqueOrThrow({ where: { id: frId } });
    expect(s.language).toBe("fr");
    expect(await prisma.extractedChunk.count({ where: { sourceId: frId, translationOfId: { not: null } } })).toBeGreaterThan(0);
  });
});
