import { describe, it, expect, beforeAll, afterAll } from "vitest";
import "../helpers";
import { prisma, createTestUser, disposeTestUser, signInAs, jsonRequest, type TestUser } from "../helpers";
import { DELETE as deleteUser } from "@/app/api/admin/users/[userId]/route";
import { DELETE as deleteCourse } from "@/app/api/admin/study-sets/[studySetId]/route";
import { getStorage, sourceAssetKey } from "@/lib/storage";

/**
 * Deleting an account removes everything it owns — every study set with all
 * its sources and stored files, including a set it created in someone else's
 * workspace — and administrators can delete any single course.
 */
let admin: TestUser;
let other: TestUser;

beforeAll(async () => {
  admin = await createTestUser("Deletion admin");
  await prisma.user.update({ where: { id: admin.id }, data: { role: "ADMIN", nature: "HUMAN" } });
  other = await createTestUser("Other owner");
});

afterAll(async () => {
  await getStorage().deletePrefix(`workspaces/${other.workspaceId}`);
  await disposeTestUser(admin.email);
  await disposeTestUser(other.email);
  await prisma.$disconnect();
});

/** A study set in `workspaceId` with `sources` stored text notes. */
async function course(workspaceId: string, createdById: string, title: string, sources: number) {
  const set = await prisma.studySet.create({ data: { workspaceId, createdById, title } });
  const keys: string[] = [];
  for (let i = 0; i < sources; i++) {
    const source = await prisma.source.create({ data: { studySetId: set.id, type: "NOTE", title: `note ${i}`, status: "READY" } });
    const key = sourceAssetKey(workspaceId, set.id, source.id, "text/plain");
    await getStorage().put(key, Buffer.from(`note ${i}`), { contentType: "text/plain" });
    await prisma.sourceAsset.create({ data: { sourceId: source.id, kind: "ORIGINAL", storageKey: key, filename: "n.txt", mimeType: "text/plain" } });
    keys.push(key);
  }
  return { set, keys };
}

const gone = async (key: string) => getStorage().read(key).then(() => false, () => true);

describe("deleting an account", () => {
  it("removes every study set it owns, with all sources and stored files", async () => {
    const victim = await createTestUser("Leaving user");
    const a = await course(victim.workspaceId, victim.id, "Own course A", 2);
    const b = await course(victim.workspaceId, victim.id, "Own course B (empty)", 0);
    // A set the account created in someone else's workspace goes too.
    const c = await course(other.workspaceId, victim.id, "Created elsewhere", 1);

    signInAs(admin.id);
    const res = await deleteUser(jsonRequest(`http://localhost/api/admin/users/${victim.id}`, "DELETE"), { params: { userId: victim.id } });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ deleted: true, studySets: 3, sources: 3 });

    expect(await prisma.user.findUnique({ where: { id: victim.id } })).toBeNull();
    expect(await prisma.studySet.count({ where: { id: { in: [a.set.id, b.set.id, c.set.id] } } })).toBe(0);
    expect(await prisma.source.count({ where: { studySetId: { in: [a.set.id, b.set.id, c.set.id] } } })).toBe(0);
    for (const key of [...a.keys, ...c.keys]) expect(await gone(key)).toBe(true);
    expect(await getStorage().list(`workspaces/${victim.workspaceId}`)).toEqual([]);
  });
});

describe("deleting a course as an administrator", () => {
  it("is closed to non-admins", async () => {
    const { set } = await course(other.workspaceId, other.id, "Not yours", 0);
    signInAs(other.id);
    const res = await deleteCourse(jsonRequest("http://localhost/x", "DELETE"), { params: { studySetId: set.id } });
    expect(res.status).toBe(403);
    expect(await prisma.studySet.count({ where: { id: set.id } })).toBe(1);
  });

  it("deletes a course of any owner with its sources and files, even with a job running", async () => {
    const { set, keys } = await course(other.workspaceId, other.id, "To delete", 2);
    await prisma.generationJob.create({ data: { studySetId: set.id, type: "GENERATE_GUIDE", status: "RUNNING", payload: {} } });
    signInAs(admin.id);
    const res = await deleteCourse(jsonRequest("http://localhost/x", "DELETE"), { params: { studySetId: set.id } });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ deleted: true, studySets: 1, sources: 2 });
    expect(await prisma.studySet.count({ where: { id: set.id } })).toBe(0);
    for (const key of keys) expect(await gone(key)).toBe(true);
    expect(await prisma.auditLog.count({ where: { action: "admin.study_set_delete", entityId: set.id, userId: admin.id } })).toBe(1);
    // The owner's other material is untouched.
    expect(await prisma.user.count({ where: { id: other.id } })).toBe(1);
  });

  it("answers 404 for an unknown course", async () => {
    signInAs(admin.id);
    const res = await deleteCourse(jsonRequest("http://localhost/x", "DELETE"), { params: { studySetId: "no-such-set" } });
    expect(res.status).toBe(404);
  });
});
