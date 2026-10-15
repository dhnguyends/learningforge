import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { NextRequest } from "next/server";
import "../helpers";
import { prisma, createTestUser, disposeTestUser, signInAs, type TestUser } from "../helpers";
import { GET as listCourses } from "@/app/api/admin/study-sets/route";
import { PUT as changeOwner } from "@/app/api/admin/study-sets/[studySetId]/owner/route";
import { assertStudySetAccess } from "@/lib/access";
import { getStorage, sourceAssetKey, studySetPrefix, studySetRecapKey } from "@/lib/storage";

/**
 * Admin "Courses": list every study set with its owner, and give a study set
 * to another account. A set belongs to one account: it moves to the new
 * owner's workspace with its stored files (asset keys and keys inside JSON
 * rewritten), the previous owner's learning history follows it, and the
 * previous owner loses access.
 */
const BASE = "http://localhost/api/admin/study-sets";
const req = (method: "GET" | "PUT", body?: unknown) =>
  new NextRequest(BASE, { method, ...(body === undefined ? {} : { body: JSON.stringify(body), headers: { "content-type": "application/json" } }) });
const put = (studySetId: string, userId: string) => changeOwner(req("PUT", { userId }), { params: { studySetId } });

let admin: TestUser;
let alice: TestUser;
let bob: TestUser;

beforeAll(async () => {
  admin = await createTestUser("Courses admin");
  await prisma.user.update({ where: { id: admin.id }, data: { role: "ADMIN", nature: "HUMAN" } }); // only Human accounts can be Admin
  alice = await createTestUser("Alice");
  bob = await createTestUser("Bob");
});

afterAll(async () => {
  for (const u of [admin, alice, bob]) {
    await getStorage().deletePrefix(`workspaces/${u.workspaceId}`);
    await disposeTestUser(u.email);
  }
  await prisma.$disconnect();
});

/** Alice's course: a stored note, a guide with an audio recap, a reviewed card, progress. */
async function aliceCourse(title: string) {
  const set = await prisma.studySet.create({ data: { workspaceId: alice.workspaceId, createdById: alice.id, title } });
  const source = await prisma.source.create({ data: { studySetId: set.id, type: "NOTE", title: "note", status: "READY" } });
  const key = sourceAssetKey(alice.workspaceId, set.id, source.id, "text/plain");
  await getStorage().put(key, Buffer.from("Ohm's law"), { contentType: "text/plain" });
  await prisma.sourceAsset.create({ data: { sourceId: source.id, kind: "ORIGINAL", storageKey: key, filename: "n.txt", mimeType: "text/plain" } });
  const guide = await prisma.studyGuide.create({ data: { studySetId: set.id, title: "g", status: "READY" } });
  const recapKey = studySetRecapKey(alice.workspaceId, set.id, guide.id, 1);
  await getStorage().put(recapKey, Buffer.from("mp3"), { contentType: "audio/mpeg" });
  await prisma.studyGuide.update({ where: { id: guide.id }, data: { metadata: { recap: { audioKey: recapKey } } } });
  const deck = await prisma.flashcardDeck.create({ data: { studySetId: set.id, name: "d" } });
  const card = await prisma.flashcard.create({ data: { deckId: deck.id, type: "BASIC", front: "V?", back: "IR" } });
  await prisma.flashcardReview.create({
    data: { cardId: card.id, userId: alice.id, grade: 3, stateBefore: {}, stateAfter: {}, scheduledFor: new Date() },
  });
  await prisma.progressMetric.create({ data: { userId: alice.id, studySetId: set.id, topic: "ohm", mastery: 0.5 } });
  return { set, key, recapKey, guideId: guide.id, assetSourceId: source.id };
}

describe("admin courses", () => {
  it("is closed to non-admins", async () => {
    signInAs(alice.id);
    expect((await listCourses(req("GET"), {} as never)).status).toBe(403);
    const { set } = await aliceCourse("Private course");
    expect((await put(set.id, alice.id)).status).toBe(403);
  });

  it("lists every study set with its owner", async () => {
    const { set } = await aliceCourse("Listed course");
    signInAs(admin.id);
    const res = await listCourses(req("GET"), {} as never);
    expect(res.status).toBe(200);
    const row = (await res.json()).studySets.find((s: { id: string }) => s.id === set.id);
    expect(row).toMatchObject({ title: "Listed course", owner: { id: alice.id, email: alice.email, nature: "BOT" }, busy: false, _count: { sources: 1 } });
  });

  it("gives a course to another account with its files and history", async () => {
    const { set, key, recapKey, guideId, assetSourceId } = await aliceCourse("Moving course");
    signInAs(admin.id);
    const res = await put(set.id, bob.id);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ fromUserId: alice.id, toUserId: bob.id, filesMoved: 2 });

    const moved = await prisma.studySet.findUniqueOrThrow({ where: { id: set.id } });
    expect(moved).toMatchObject({ workspaceId: bob.workspaceId, createdById: bob.id });

    const swap = (k: string) => k.replace(studySetPrefix(alice.workspaceId, set.id), studySetPrefix(bob.workspaceId, set.id));
    const asset = await prisma.sourceAsset.findFirstOrThrow({ where: { sourceId: assetSourceId } });
    expect(asset.storageKey).toBe(swap(key));
    expect((await getStorage().read(asset.storageKey)).toString()).toBe("Ohm's law");
    await expect(getStorage().read(key)).rejects.toThrow(); // originals removed
    const guide = await prisma.studyGuide.findUniqueOrThrow({ where: { id: guideId } });
    expect(guide.metadata).toMatchObject({ recap: { audioKey: swap(recapKey) } });
    expect((await getStorage().read(swap(recapKey))).toString()).toBe("mp3");

    expect(await prisma.flashcardReview.count({ where: { card: { deck: { studySetId: set.id } }, userId: bob.id } })).toBe(1);
    expect(await prisma.progressMetric.count({ where: { studySetId: set.id, userId: bob.id } })).toBe(1);

    await expect(assertStudySetAccess(alice.id, set.id)).rejects.toMatchObject({ status: 403 });
    await expect(assertStudySetAccess(bob.id, set.id)).resolves.toMatchObject({ id: set.id });
    expect(await prisma.auditLog.count({ where: { action: "study_set.transfer", entityId: set.id, userId: admin.id } })).toBe(1);
  });

  it("refuses while an import or generation is running, and leaves everything in place", async () => {
    const { set, key } = await aliceCourse("Busy course");
    await prisma.generationJob.create({ data: { studySetId: set.id, type: "GENERATE_GUIDE", status: "RUNNING", payload: {} } });
    signInAs(admin.id);
    const res = await put(set.id, bob.id);
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("study_set_busy");
    expect((await prisma.studySet.findUniqueOrThrow({ where: { id: set.id } })).workspaceId).toBe(alice.workspaceId);
    expect((await getStorage().read(key)).toString()).toBe("Ohm's law");
  });

  it("rejects giving a course to its current owner or to an unknown account", async () => {
    const { set } = await aliceCourse("Same owner");
    signInAs(admin.id);
    expect((await put(set.id, alice.id)).status).toBe(400);
    expect((await put(set.id, "no-such-user")).status).toBe(404);
    expect((await put("no-such-set", bob.id)).status).toBe(404);
  });
});
