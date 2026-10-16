import { describe, it, expect, beforeAll, afterAll } from "vitest";
import "./helpers";
import { prisma, createTestUser, disposeTestUser, signInAs, jsonRequest, type TestUser } from "./helpers";
import { getStorage, sourceAssetKey } from "@/lib/storage";
import { POST as reprocess } from "@/app/api/study-sets/[studySetId]/sources/[sourceId]/reprocess/route";

/**
 * "Import again" on a source: re-runs the whole import from what is already
 * stored (here a text note, ingested inline with mock providers), replaces the
 * indexed passages instead of duplicating them, and refuses when there is
 * nothing to import from or an import is already running.
 */
const BASE = "http://localhost";
let me: TestUser;
let other: TestUser;
let studySetId: string;

const ctx = (sourceId: string) => ({ params: { studySetId, sourceId } });
const post = (sourceId: string) => reprocess(jsonRequest(`${BASE}/x`, "POST"), ctx(sourceId));

/** The inline queue runs the import in the background; wait for its job to finish. */
async function waitForJob(jobId: string) {
  for (let i = 0; i < 100; i++) {
    const job = await prisma.generationJob.findUniqueOrThrow({ where: { id: jobId } });
    if (job.status === "SUCCEEDED" || job.status === "FAILED") return job;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("import job did not finish");
}

async function noteSource(title: string, text: string | null) {
  const source = await prisma.source.create({ data: { studySetId, type: "NOTE", title, status: "FAILED", error: "earlier failure" } });
  const set = await prisma.studySet.findUniqueOrThrow({ where: { id: studySetId } });
  const key = sourceAssetKey(set.workspaceId, studySetId, source.id, "text/plain");
  if (text !== null) await getStorage().put(key, Buffer.from(text), { contentType: "text/plain" });
  await prisma.sourceAsset.create({ data: { sourceId: source.id, kind: "ORIGINAL", storageKey: key, filename: `${title}.txt`, mimeType: "text/plain" } });
  return source.id;
}

beforeAll(async () => {
  me = await createTestUser("Reprocess");
  other = await createTestUser("Reprocess outsider");
  studySetId = (await prisma.studySet.create({ data: { workspaceId: me.workspaceId, createdById: me.id, title: "Circuits" } })).id;
});

afterAll(async () => {
  await disposeTestUser(me.email);
  await disposeTestUser(other.email);
  await prisma.$disconnect();
});

describe("re-submitting a source", () => {
  it("imports a failed source again and replaces its passages", async () => {
    const id = await noteSource("ohm", "Ohm's law: V = I R. Voltage equals current times resistance.");
    signInAs(me.id);

    const first = await post(id);
    expect(first.status).toBe(202);
    expect((await waitForJob((await first.json()).jobId)).status).toBe("SUCCEEDED");
    const after = await prisma.source.findUniqueOrThrow({ where: { id } });
    expect(after).toMatchObject({ status: "READY", error: null });
    const chunks = await prisma.extractedChunk.count({ where: { sourceId: id } });
    expect(chunks).toBeGreaterThan(0);

    const second = await post(id);
    expect(second.status).toBe(202);
    await waitForJob((await second.json()).jobId);
    expect(await prisma.extractedChunk.count({ where: { sourceId: id } })).toBe(chunks); // replaced, not duplicated
    expect(await prisma.auditLog.count({ where: { entityId: id, action: "source.reprocess" } })).toBe(2);
  });

  it("refuses while an import of the source is already running", async () => {
    const id = await noteSource("busy", "Capacitors store energy.");
    await prisma.generationJob.create({ data: { studySetId, sourceId: id, type: "INGEST_SOURCE", status: "RUNNING", payload: {} } });
    signInAs(me.id);
    const res = await post(id);
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("already_processing");
  });

  it("explains when the original file is gone", async () => {
    const id = await noteSource("missing", null);
    signInAs(me.id);
    const res = await post(id);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/no longer stored — delete this source and add the file again/);
  });

  it("fails clearly, instead of READY with nothing in it, when a file has no readable text", async () => {
    const id = await noteSource("blank", "   \n\n   ");
    signInAs(me.id);
    const res = await post(id);
    expect(res.status).toBe(202);
    expect((await waitForJob((await res.json()).jobId)).status).toBe("FAILED");
    const after = await prisma.source.findUniqueOrThrow({ where: { id } });
    expect(after.status).toBe("FAILED");
    expect(after.error).toMatch(/No readable text was found in this file/);
  });

  it("is limited to people with write access to the study set", async () => {
    const id = await noteSource("private", "Secret notes.");
    signInAs(other.id);
    expect([403, 404]).toContain((await post(id)).status);
    signInAs(null);
    expect((await post(id)).status).toBe(401);
  });
});
