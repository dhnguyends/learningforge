import { describe, it, expect, beforeAll, afterAll } from "vitest";
import "./helpers";
import { prisma, createTestUser, disposeTestUser, signInAs, jsonRequest, type TestUser } from "./helpers";
import { GET as getTaxonomy } from "@/app/api/taxonomy/route";
import { GET as listStudySets } from "@/app/api/study-sets/route";
import { GET as getStudySet, PATCH as patchStudySet } from "@/app/api/study-sets/[studySetId]/route";
import { GET as adminList } from "@/app/api/admin/study-sets/route";
import { PATCH as adminPatch } from "@/app/api/admin/study-sets/[studySetId]/route";
import { ensureTaxonomy } from "@/lib/taxonomy/store";

/**
 * Course taxonomy: a course is filed under one topic (level 4) and its
 * discipline, subject and course / module follow from the tree. Only
 * administrators file courses (owners see the topic read-only). Explore
 * shows a user only their own courses.
 */
let me: TestUser;
let other: TestUser;
let admin: TestUser;
let backprop: { id: string };
let deepLearning: { id: string };

const url = (path: string) => `http://localhost${path}`;
const patch = (studySetId: string, body: unknown) =>
  patchStudySet(jsonRequest(url(`/api/study-sets/${studySetId}`), "PATCH", body), { params: { studySetId } });
const adminSet = (studySetId: string, body: unknown) =>
  adminPatch(jsonRequest(url(`/api/admin/study-sets/${studySetId}`), "PATCH", body), { params: { studySetId } });
const tree = (scope?: string) => getTaxonomy(jsonRequest(url(`/api/taxonomy${scope ? `?scope=${scope}` : ""}`), "GET"), {} as never);

beforeAll(async () => {
  await ensureTaxonomy();
  me = await createTestUser("Taxonomy main");
  other = await createTestUser("Taxonomy other");
  admin = await createTestUser("Taxonomy admin");
  await prisma.user.update({ where: { id: admin.id }, data: { role: "ADMIN", nature: "HUMAN" } }); // only Human accounts can be Admin
  deepLearning = await prisma.taxonomyNode.findFirstOrThrow({ where: { level: 3, name: "Deep Learning" } });
  backprop = await prisma.taxonomyNode.findFirstOrThrow({ where: { level: 4, name: "Backpropagation", parentId: deepLearning.id } });
});

afterAll(async () => {
  for (const u of [me, other, admin]) await disposeTestUser(u.email);
  await prisma.$disconnect();
});

const newSet = (owner: TestUser, title: string) => prisma.studySet.create({ data: { workspaceId: owner.workspaceId, createdById: owner.id, title } });

describe("filing a course under a topic (administrators only)", () => {
  it("fills discipline, subject and course / module from the topic", async () => {
    const set = await newSet(me, "Taxonomy backprop set");
    signInAs(admin.id);
    expect((await adminSet(set.id, { topicId: backprop.id })).status).toBe(200);

    signInAs(me.id); // the owner sees the four levels
    const detail = await (await getStudySet(jsonRequest(url(`/api/study-sets/${set.id}`), "GET"), { params: { studySetId: set.id } })).json();
    expect(detail.studySet.classification).toEqual({
      topicId: backprop.id,
      discipline: { code: "3", name: "Computer Science and AI" },
      subject: { code: "3.4", name: "Artificial Intelligence" },
      module: { code: "3.4.2", name: "Deep Learning" },
      topic: { code: "3.4.2.2", name: "Backpropagation" },
    });

    const list = await (await listStudySets(jsonRequest(url("/api/study-sets"), "GET"), {} as never)).json();
    expect(list.find((s: { id: string }) => s.id === set.id).classification.topic.name).toBe("Backpropagation");
  });

  it("refuses a topic from the course owner, on either route", async () => {
    const set = await newSet(me, "Taxonomy owner set");
    signInAs(me.id);
    const own = await patch(set.id, { topicId: backprop.id });
    expect(own.status).toBe(403);
    expect((await own.json()).error).toMatch(/administrator/);
    expect((await adminSet(set.id, { topicId: backprop.id })).status).toBe(403);
    // Other fields still save; the topic is untouched.
    expect((await patch(set.id, { title: "Taxonomy owner set renamed" })).status).toBe(200);
    expect((await prisma.studySet.findUniqueOrThrow({ where: { id: set.id } })).topicId).toBeNull();
  });

  it("removes the topic with null", async () => {
    const set = await newSet(other, "Taxonomy clear set");
    signInAs(admin.id);
    await adminSet(set.id, { topicId: backprop.id });
    expect((await prisma.studySet.findUniqueOrThrow({ where: { id: set.id } })).topicId).toBe(backprop.id);
    const res = await adminSet(set.id, { topicId: null });
    expect(await res.json()).toEqual({ classification: null });
    expect((await prisma.studySet.findUniqueOrThrow({ where: { id: set.id } })).topicId).toBeNull();
  });

  it("accepts only a topic (level 4) that exists", async () => {
    const set = await newSet(me, "Taxonomy invalid set");
    signInAs(admin.id);
    const notATopic = await adminSet(set.id, { topicId: deepLearning.id });
    expect(notATopic.status).toBe(400);
    expect((await notATopic.json()).error).toMatch(/not a topic/);
    expect((await adminSet(set.id, { topicId: "no-such-node" })).status).toBe(400);
    expect((await prisma.studySet.findUniqueOrThrow({ where: { id: set.id } })).topicId).toBeNull();
  });

  it("files any account's course, shown in the admin list and audited", async () => {
    const theirs = await newSet(other, "Taxonomy admin-filed set");
    signInAs(admin.id);
    const res = await adminSet(theirs.id, { topicId: backprop.id });
    expect(res.status).toBe(200);
    expect((await res.json()).classification.module.name).toBe("Deep Learning");
    const rows = (await (await adminList(jsonRequest(url("/api/admin/study-sets"), "GET"), {} as never)).json()).studySets;
    expect(rows.find((r: { id: string }) => r.id === theirs.id).classification.topic.code).toBe("3.4.2.2");
    expect(await prisma.auditLog.count({ where: { entityId: theirs.id, action: "admin.study_set_classify" } })).toBe(1);
  });
});

describe("GET /api/taxonomy", () => {
  it("requires a session", async () => {
    signInAs(null);
    expect((await tree()).status).toBe(401);
  });

  it("returns the whole tree and only the caller's courses", async () => {
    const mine = await newSet(me, "Taxonomy explore mine");
    const theirs = await newSet(other, "Taxonomy explore theirs");
    await prisma.studySet.updateMany({ where: { id: { in: [mine.id, theirs.id] } }, data: { topicId: backprop.id } });
    signInAs(me.id);
    const body = await (await tree()).json();
    expect(body.scope).toBe("mine");
    expect(body.nodes.length).toBeGreaterThanOrEqual(609);
    const ids = body.courses.map((c: { id: string }) => c.id);
    expect(ids).toContain(mine.id);
    expect(ids).not.toContain(theirs.id);
    expect(body.courses.find((c: { id: string }) => c.id === mine.id)).toEqual({ id: mine.id, title: "Taxonomy explore mine", topicId: backprop.id, relatedTopicIds: [] });
  });

  it("gives every course with its owner to administrators only", async () => {
    signInAs(me.id);
    expect((await tree("all")).status).toBe(403);
    signInAs(admin.id);
    const body = await (await tree("all")).json();
    const theirs = body.courses.find((c: { title: string }) => c.title === "Taxonomy explore theirs");
    expect(theirs.owner.email).toBe(other.email);
  });

  it("unfiles courses when their topic is deleted", async () => {
    // A temporary topic under Deep Learning, removed again by this test.
    const temp = await prisma.taxonomyNode.create({ data: { parentId: deepLearning.id, level: 4, code: "3.4.2.99", name: "Taxonomy test topic", position: 99 } });
    const set = await newSet(me, "Taxonomy orphan set");
    signInAs(admin.id);
    await adminSet(set.id, { topicId: temp.id });
    await prisma.taxonomyNode.delete({ where: { id: temp.id } });
    expect((await prisma.studySet.findUniqueOrThrow({ where: { id: set.id } })).topicId).toBeNull();
  });
});
