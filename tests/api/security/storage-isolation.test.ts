import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { NextRequest } from "next/server";
import "../helpers";
import { prisma, createTestUser, disposeTestUser, signInAs, jsonRequest, type TestUser } from "../helpers";
import { POST as addSource } from "@/app/api/study-sets/[studySetId]/sources/route";
import { DELETE as deleteSource } from "@/app/api/study-sets/[studySetId]/sources/[sourceId]/route";
import { PUT as devUpload } from "@/app/api/dev/uploads/[...key]/route";
import { GET as readFile } from "@/app/api/files/[...key]/route";
import { POST as completeUpload } from "@/app/api/uploads/complete/route";
import { ingestSource } from "@/lib/pipelines/ingest";
import {
  getStorage,
  assertSafeKey,
  sourcePrefix,
  studySetPrefix,
  studySetRecapKey,
} from "@/lib/storage";
import { signUploadTicket } from "@/lib/storage/tickets";

/**
 * Tenant isolation of the storage layer — regression suite for
 * REVIEW-REPORT.md S1 (cross-tenant upload overwrite), S2 (cross-tenant read
 * via /api/files traversal), S3 (client filename in storage keys) and S5
 * (derived audio stored outside the tenant prefix).
 *
 * Two users, A (victim) and B (attacker), each with their own workspace.
 */

// ffmpeg / yt-dlp are not part of what is under test: stand-ins write the
// derived audio exactly where the pipeline asks them to.
vi.mock("@/lib/media/ffmpeg", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/media/ffmpeg")>();
  const { getStorage: storage } = await import("@/lib/storage");
  const fakeAudio = Buffer.from("ID3 fake derived audio");
  return {
    ...actual,
    probeMedia: async () => ({ durationSec: 60 }),
    extractAudio: async (_input: Buffer, _filename: string, outputKey: string) => {
      await storage().put(outputKey, fakeAudio, { contentType: "audio/mpeg" });
      return { key: outputKey, durationSec: 60 };
    },
    fetchYouTubeAudio: async (_url: string, outputKey: string) => {
      await storage().put(outputKey, fakeAudio, { contentType: "audio/mpeg" });
      return { key: outputKey, durationSec: 60, title: "yt" };
    },
  };
});

const BASE = "http://localhost";
const SECRET = "TOP-SECRET-OF-USER-A backpropagation chain rule gradient";

let a: TestUser;
let b: TestUser;
let setA: { id: string; workspaceId: string };
let setB: { id: string; workspaceId: string };

interface Pending {
  sourceId: string;
  key: string;
  ticket: string;
}

/** Add a file source through the real API and return its upload ticket. */
async function addFileSource(
  user: TestUser,
  set: { id: string },
  filename: string,
  body: string,
  mimeType = "text/plain",
): Promise<Pending> {
  signInAs(user.id);
  const res = await addSource(
    jsonRequest(`${BASE}/api/study-sets/${set.id}/sources`, "POST", {
      kind: "file",
      filename,
      mimeType,
      sizeBytes: Buffer.byteLength(body),
    }),
    { params: { studySetId: set.id } },
  );
  expect(res.status).toBe(201);
  const json = (await res.json()) as { source: { id: string }; upload: { uploadUrl: string; key: string } };
  const url = new URL(json.upload.uploadUrl);
  return { sourceId: json.source.id, key: json.upload.key, ticket: url.searchParams.get("ticket") ?? "" };
}

function putRequest(key: string, body: string, opts: { ticket?: string; contentType?: string } = {}): NextRequest {
  const qs = opts.ticket === undefined ? "" : `?ticket=${encodeURIComponent(opts.ticket)}`;
  return new NextRequest(`${BASE}/api/dev/uploads/${key}${qs}`, {
    method: "PUT",
    body,
    headers: { "content-type": opts.contentType ?? "text/plain" },
  });
}

async function put(key: string, body: string, opts: { ticket?: string; contentType?: string } = {}) {
  return devUpload(putRequest(key, body, opts), { params: { key: key.split("/") } });
}

async function get(keyParts: string[], headers: Record<string, string> = {}) {
  return readFile(new NextRequest(`${BASE}/api/files/${keyParts.join("/")}`, { headers }), { params: { key: keyParts } });
}

async function storedText(key: string): Promise<string | null> {
  try {
    return (await getStorage().read(key)).toString("utf8");
  } catch {
    return null;
  }
}

const noopCtx = { updateStage: async () => undefined, log: () => undefined };

/** A's uploaded + verified secret document, shared by several tests. */
let secretA: Pending;

beforeAll(async () => {
  a = await createTestUser("Victim A");
  b = await createTestUser("Attacker B");
  setA = await prisma.studySet.create({
    data: { workspaceId: a.workspaceId, createdById: a.id, title: "A private set" },
    select: { id: true, workspaceId: true },
  });
  setB = await prisma.studySet.create({
    data: { workspaceId: b.workspaceId, createdById: b.id, title: "B set" },
    select: { id: true, workspaceId: true },
  });

  secretA = await addFileSource(a, setA, "secret.txt", SECRET);
  signInAs(a.id);
  const res = await put(secretA.key, SECRET, { ticket: secretA.ticket });
  expect(res.status).toBe(200);
});

afterAll(async () => {
  const storage = getStorage();
  await storage.deletePrefix(`workspaces/${a.workspaceId}`);
  await storage.deletePrefix(`workspaces/${b.workspaceId}`);
  await disposeTestUser(a.email);
  await disposeTestUser(b.email);
  await prisma.$disconnect();
});

describe("storage keys (S3)", () => {
  it.each([
    [""],
    ["../outside"],
    ["workspaces/a/../b/file"],
    ["workspaces/a/./file"],
    ["workspaces//a"],
    ["workspaces\\a\\file"],
    ["C:/windows/system32"],
    ["workspaces/a/file\u0000.txt"],
  ])("assertSafeKey rejects %j", (key) => {
    expect(() => assertSafeKey(key)).toThrow();
  });

  it("assertSafeKey accepts a tenant key", () => {
    expect(assertSafeKey("workspaces/w1/study-sets/s1/sources/x1/original.pdf")).toBeTruthy();
  });

  it("never builds a storage key from the client filename", async () => {
    const traversal = `../../../../../${a.workspaceId}/study-sets/${setA.id}/sources/${secretA.sourceId}/secret.txt`;
    const pending = await addFileSource(b, setB, traversal, "x".repeat(10));

    expect(pending.key).toBe(`${sourcePrefix(b.workspaceId, setB.id, pending.sourceId)}/original.txt`);
    const asset = await prisma.sourceAsset.findFirstOrThrow({ where: { sourceId: pending.sourceId, kind: "ORIGINAL" } });
    expect(asset.storageKey).toBe(pending.key);
    expect(asset.filename).toBe(traversal); // kept as display metadata only
  });

  it("completing a traversal-named upload cannot ingest another tenant's file", async () => {
    const traversal = `../../../../../${a.workspaceId}/study-sets/${setA.id}/sources/${secretA.sourceId}/original.txt`;
    const pending = await addFileSource(b, setB, traversal, "x".repeat(10));

    signInAs(b.id);
    const res = await completeUpload(jsonRequest(`${BASE}/api/uploads/complete`, "POST", { sourceId: pending.sourceId }), {} as never);
    expect(res.status).toBe(400); // nothing was uploaded at B's own key
    const jobs = await prisma.generationJob.count({ where: { sourceId: pending.sourceId } });
    expect(jobs).toBe(0);
  });

  it("refuses to complete a legacy row whose key escapes the source prefix", async () => {
    // Rows created before the fix stored the raw filename in the key.
    const source = await prisma.source.create({
      data: { studySetId: setB.id, type: "NOTE", title: "legacy", status: "PENDING_UPLOAD" },
    });
    await prisma.sourceAsset.create({
      data: {
        sourceId: source.id,
        kind: "ORIGINAL",
        storageKey: `${sourcePrefix(b.workspaceId, setB.id, source.id)}/../../../../../${a.workspaceId}/study-sets/${setA.id}/sources/${secretA.sourceId}/original.txt`,
        filename: "legacy.txt",
        mimeType: "text/plain",
      },
    });

    signInAs(b.id);
    const res = await completeUpload(jsonRequest(`${BASE}/api/uploads/complete`, "POST", { sourceId: source.id }), {} as never);
    expect(res.status).toBe(400);
    expect((await prisma.source.findUniqueOrThrow({ where: { id: source.id } })).status).toBe("FAILED");
    expect(await prisma.generationJob.count({ where: { sourceId: source.id } })).toBe(0);
    expect(await prisma.extractedChunk.count({ where: { sourceId: source.id } })).toBe(0);
  });
});

describe("PUT /api/dev/uploads (S1)", () => {
  it("rejects anonymous uploads", async () => {
    signInAs(null);
    expect((await put(secretA.key, "x", { ticket: secretA.ticket })).status).toBe(401);
  });

  it("rejects a PUT without a ticket — even to the caller's own pending key", async () => {
    const pending = await addFileSource(b, setB, "notes.txt", "hello world");
    signInAs(b.id);
    expect((await put(pending.key, "hello world")).status).toBe(403);
  });

  it("rejects a tampered ticket", async () => {
    const pending = await addFileSource(b, setB, "notes.txt", "hello world");
    signInAs(b.id);
    const [payload, sig] = pending.ticket.split(".");
    const forged = `${payload}.${sig.slice(0, -2)}${sig.endsWith("AA") ? "BB" : "AA"}`;
    expect((await put(pending.key, "hello world", { ticket: forged })).status).toBe(403);
  });

  it("rejects a ticket issued for a different key (cannot redirect a ticket at another tenant)", async () => {
    const mine = await addFileSource(b, setB, "notes.txt", "OVERWRITTEN BY B");
    signInAs(b.id);
    const res = await put(secretA.key, "OVERWRITTEN BY B", { ticket: mine.ticket });
    expect(res.status).toBe(403);
    expect(await storedText(secretA.key)).toBe(SECRET);
  });

  it("rejects a ticket issued to another user", async () => {
    const victimPending = await addFileSource(a, setA, "notes.txt", "hello world");
    signInAs(b.id);
    expect((await put(victimPending.key, "hijacked!!!", { ticket: victimPending.ticket })).status).toBe(403);
    expect(await storedText(victimPending.key)).toBeNull();
  });

  it("rejects an expired ticket", async () => {
    const pending = await addFileSource(b, setB, "notes.txt", "hello world");
    const expired = signUploadTicket({ k: pending.key, ct: "text/plain", max: 11, u: b.id, exp: Date.now() - 1000 });
    signInAs(b.id);
    expect((await put(pending.key, "hello world", { ticket: expired })).status).toBe(403);
  });

  it("rejects traversal segments in the key", async () => {
    signInAs(b.id);
    const keyParts = ["workspaces", b.workspaceId, "..", a.workspaceId, "study-sets", setA.id, "sources", secretA.sourceId, "original.txt"];
    const res = await devUpload(putRequest(keyParts.join("/"), "x", { ticket: secretA.ticket }), { params: { key: keyParts } });
    expect(res.status).toBe(400);
    expect(await storedText(secretA.key)).toBe(SECRET);
  });

  it("rejects a Content-Type other than the one the ticket was issued for", async () => {
    const pending = await addFileSource(b, setB, "notes.txt", "hello world");
    signInAs(b.id);
    expect((await put(pending.key, "hello world", { ticket: pending.ticket, contentType: "text/html" })).status).toBe(415);
  });

  it("cuts off bodies larger than the declared size", async () => {
    const pending = await addFileSource(b, setB, "notes.txt", "tiny");
    signInAs(b.id);
    const res = await put(pending.key, "much more than four bytes", { ticket: pending.ticket });
    expect(res.status).toBe(413);
    expect(await storedText(pending.key)).toBeNull();
  });

  it("accepts a valid ticket once, then refuses overwrites after completion", async () => {
    const pending = await addFileSource(b, setB, "notes.txt", "first upload");
    signInAs(b.id);
    expect((await put(pending.key, "first upload", { ticket: pending.ticket })).status).toBe(200);
    expect(await storedText(pending.key)).toBe("first upload");

    const done = await completeUpload(jsonRequest(`${BASE}/api/uploads/complete`, "POST", { sourceId: pending.sourceId }), {} as never);
    expect(done.status).toBe(200);
    const again = await put(pending.key, "second upload", { ticket: pending.ticket });
    expect(again.status).toBe(409);
    expect(await storedText(pending.key)).toBe("first upload");
  });
});

describe("GET /api/files (S2)", () => {
  const keyParts = () => secretA.key.split("/");

  it("serves the owner's file", async () => {
    signInAs(a.id);
    const res = await get(keyParts());
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(SECRET);
  });

  it("rejects anonymous reads", async () => {
    signInAs(null);
    expect((await get(keyParts())).status).toBe(401);
  });

  it("forbids another tenant from reading the key directly", async () => {
    signInAs(b.id);
    expect((await get(keyParts())).status).toBe(403);
  });

  it("forbids traversal out of the caller's own workspace (decoded `..%2F` segment)", async () => {
    signInAs(b.id);
    const rest = secretA.key.split("/").slice(1); // drop "workspaces"
    // `workspaces/<wsB>/..%2F<wsA>/…` — Next decodes %2F inside the segment.
    const res = await get(["workspaces", b.workspaceId, `../${rest[0]}`, ...rest.slice(1)]);
    expect(res.status).toBe(400);
    expect(await res.text()).not.toContain("TOP-SECRET");
  });

  it("forbids traversal with plain `..` segments", async () => {
    signInAs(b.id);
    const res = await get(["workspaces", b.workspaceId, "study-sets", setB.id, "..", "..", "..", ...secretA.key.split("/")]);
    expect(res.status).toBe(400);
  });

  it("forbids a key whose workspace segment does not own the study set", async () => {
    signInAs(a.id);
    const parts = secretA.key.split("/");
    parts[1] = b.workspaceId;
    expect((await get(parts)).status).toBe(403);
  });
});

describe("derived audio lives under the tenant prefix (S5)", () => {
  async function createRecordingSource(type: "VIDEO" | "YOUTUBE") {
    const source = await prisma.source.create({
      data: {
        studySetId: setA.id,
        type,
        title: `${type} lecture`,
        status: "PROCESSING",
        ...(type === "YOUTUBE" ? { externalUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" } : {}),
      },
    });
    if (type === "VIDEO") {
      const key = `${sourcePrefix(a.workspaceId, setA.id, source.id)}/original.mp4`;
      await getStorage().put(key, Buffer.from("fake mp4 bytes"), { contentType: "video/mp4" });
      await prisma.sourceAsset.create({
        data: { sourceId: source.id, kind: "ORIGINAL", storageKey: key, filename: "lecture.mp4", mimeType: "video/mp4" },
      });
    }
    return source;
  }

  it.each(["VIDEO", "YOUTUBE"] as const)("%s ingest stores audio under the source prefix, playable and purged on delete", async (type) => {
    const source = await createRecordingSource(type);
    await ingestSource({ payload: { sourceId: source.id }, ...noopCtx });

    const audio = await prisma.sourceAsset.findFirstOrThrow({ where: { sourceId: source.id, kind: "AUDIO" } });
    expect(audio.storageKey).toBe(`${sourcePrefix(a.workspaceId, setA.id, source.id)}/audio.mp3`);
    expect(await storedText(audio.storageKey)).not.toBeNull();

    // Playback is authorized for the owner (it used to 403 for YouTube) …
    signInAs(a.id);
    expect((await get(audio.storageKey.split("/"))).status).toBe(200);
    // … and not for anyone else.
    signInAs(b.id);
    expect((await get(audio.storageKey.split("/"))).status).toBe(403);

    // Permanent deletion purges the derived recording too.
    signInAs(a.id);
    const del = await deleteSource(jsonRequest(`${BASE}/api/study-sets/${setA.id}/sources/${source.id}`, "DELETE"), {
      params: { studySetId: setA.id, sourceId: source.id },
    });
    expect(del.status).toBe(200);
    expect(await storedText(audio.storageKey)).toBeNull();
  });

  it("audio recap keys live under the study-set prefix", () => {
    const key = studySetRecapKey(a.workspaceId, setA.id, "guide123", 1700000000000);
    expect(key.startsWith(`${studySetPrefix(a.workspaceId, setA.id)}/`)).toBe(true);
    expect(() => assertSafeKey(key)).not.toThrow();
  });
});
