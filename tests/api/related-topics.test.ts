import { describe, it, expect, beforeAll, afterAll } from "vitest";
import "./helpers";
import { prisma, createTestUser, disposeTestUser, signInAs, jsonRequest, type TestUser } from "./helpers";
import { PUT as putRelated } from "@/app/api/study-sets/[studySetId]/related-topics/route";
import { GET as listStudySets } from "@/app/api/study-sets/route";
import { GET as getTaxonomy } from "@/app/api/taxonomy/route";
import { PATCH as adminClassify } from "@/app/api/admin/study-sets/[studySetId]/route";
import { ensureTaxonomy } from "@/lib/taxonomy/store";

/**
 * Related ("connexe") topics: besides its main topic, a course can be linked
 * to up to 3 other topics, by its owner or an administrator — never a 4th,
 * the same one twice, its main topic, or something that is not a topic.
 * Deleting a topic removes its links; a related topic that becomes the main
 * one stops being related.
 */
let owner: TestUser;
let other: TestUser;
let admin: TestUser;
const topic: Record<string, string> = {};
let deepLearning: string;

const url = (path: string) => `http://localhost${path}`;
const put = async (studySetId: string, topicIds: string[]) => {
  const res = await putRelated(jsonRequest(url(`/api/study-sets/${studySetId}/related-topics`), "PUT", { topicIds }), { params: { studySetId } });
  return { status: res.status, body: await res.json() };
};
const newSet = (u: TestUser, title: string, topicId?: string) =>
  prisma.studySet.create({ data: { workspaceId: u.workspaceId, createdById: u.id, title, topicId } });
const relatedOf = async (studySetId: string) =>
  (await prisma.studySetRelatedTopic.findMany({ where: { studySetId }, orderBy: { position: "asc" } })).map((r) => r.topicId);

beforeAll(async () => {
  await ensureTaxonomy();
  owner = await createTestUser("Related owner");
  other = await createTestUser("Related other");
  admin = await createTestUser("Related admin");
  await prisma.user.update({ where: { id: admin.id }, data: { role: "ADMIN", nature: "HUMAN" } }); // only Human accounts can be Admin
  for (const name of ["Backpropagation", "Gradient descent", "Neural networks", "Transformers", "Kinematics"]) {
    topic[name] = (await prisma.taxonomyNode.findFirstOrThrow({ where: { level: 4, name } })).id;
  }
  deepLearning = (await prisma.taxonomyNode.findFirstOrThrow({ where: { level: 3, name: "Deep Learning" } })).id;
});

afterAll(async () => {
  for (const u of [owner, other, admin]) await disposeTestUser(u.email);
  await prisma.$disconnect();
});

describe("related topics", () => {
  it("lets the owner link up to 3 topics, shown in order with their path", async () => {
    const set = await newSet(owner, "Related: main backprop", topic.Backpropagation);
    signInAs(owner.id);
    const res = await put(set.id, [topic["Gradient descent"], topic["Neural networks"], topic.Transformers]);
    expect(res.status).toBe(200);
    expect(res.body.related.map((r: { topic: { name: string } }) => r.topic.name)).toEqual(["Gradient descent", "Neural networks", "Transformers"]);
    expect(res.body.related[0]).toMatchObject({ discipline: { name: "Mathematics" }, module: { name: "Optimization" } });

    const list = await (await listStudySets(jsonRequest(url("/api/study-sets"), "GET"), {} as never)).json();
    expect(list.find((s: { id: string }) => s.id === set.id).related).toHaveLength(3);
    const tree = await (await getTaxonomy(jsonRequest(url("/api/taxonomy"), "GET"), {} as never)).json();
    expect(tree.courses.find((c: { id: string }) => c.id === set.id).relatedTopicIds).toEqual([
      topic["Gradient descent"],
      topic["Neural networks"],
      topic.Transformers,
    ]);
    expect(await prisma.auditLog.count({ where: { entityId: set.id, action: "study_set.related_topics" } })).toBe(1);
  });

  it("refuses a 4th topic, a duplicate, the main topic and anything that is not a topic", async () => {
    const set = await newSet(owner, "Related: refusals", topic.Backpropagation);
    signInAs(owner.id);
    const four = await put(set.id, [topic["Gradient descent"], topic["Neural networks"], topic.Transformers, topic.Kinematics]);
    expect(four.status).toBe(400);
    expect(four.body.error).toMatch(/at most 3/);
    expect((await put(set.id, [topic.Kinematics, topic.Kinematics])).body.error).toMatch(/twice/);
    expect((await put(set.id, [topic.Backpropagation])).body.error).toMatch(/main topic/);
    expect((await put(set.id, [deepLearning])).body.error).toMatch(/not a topic/);
    expect((await put(set.id, ["no-such-node"])).status).toBe(400);
    expect(await relatedOf(set.id)).toEqual([]);
  });

  it("removes one by sending the list without it", async () => {
    const set = await newSet(owner, "Related: remove");
    signInAs(owner.id);
    await put(set.id, [topic.Kinematics, topic.Transformers]);
    expect((await put(set.id, [topic.Transformers])).status).toBe(200);
    expect(await relatedOf(set.id)).toEqual([topic.Transformers]);
  });

  it("is for the owner and administrators, not other users", async () => {
    const set = await newSet(owner, "Related: permissions");
    signInAs(null);
    expect((await put(set.id, [topic.Kinematics])).status).toBe(401);
    signInAs(other.id);
    expect((await put(set.id, [topic.Kinematics])).status).toBe(403);
    signInAs(admin.id);
    expect((await put(set.id, [topic.Kinematics])).status).toBe(200);
    expect(await relatedOf(set.id)).toEqual([topic.Kinematics]);
  });

  it("drops a related topic that becomes the main topic, and links to a deleted topic", async () => {
    const set = await newSet(owner, "Related: main and deletion");
    signInAs(owner.id);
    await put(set.id, [topic.Kinematics, topic.Transformers]);
    signInAs(admin.id);
    const res = await adminClassify(jsonRequest(url(`/api/admin/study-sets/${set.id}`), "PATCH", { topicId: topic.Kinematics }), {
      params: { studySetId: set.id },
    });
    expect(res.status).toBe(200);
    expect(await relatedOf(set.id)).toEqual([topic.Transformers]);

    // A temporary topic, linked then deleted.
    const temp = await prisma.taxonomyNode.create({
      data: { parentId: deepLearning, level: 4, code: "3.4.2.99", name: `Related test topic ${crypto.randomUUID().slice(0, 8)}`, position: 99 },
    });
    signInAs(owner.id);
    await put(set.id, [topic.Transformers, temp.id]);
    await prisma.taxonomyNode.delete({ where: { id: temp.id } });
    expect(await relatedOf(set.id)).toEqual([topic.Transformers]);
  });
});
