import { describe, it, expect, beforeAll, afterAll } from "vitest";
import "./helpers";
import { prisma, createTestUser, disposeTestUser, signInAs, jsonRequest, type TestUser } from "./helpers";
import { POST as insertRoute } from "@/app/api/admin/taxonomy/nodes/route";
import { GET as exportRoute } from "@/app/api/admin/taxonomy/export/route";
import { ensureTaxonomy } from "@/lib/taxonomy/store";
import { renumber } from "@/lib/taxonomy/edit";
import { parseTaxonomy } from "@/lib/taxonomy/parse";

/**
 * Admin → Courses Tree: an administrator selects a node and inserts its
 * first child or its next neighbour. A topic (the leaf) has no children,
 * a discipline has no parent, nothing is created above a node, every
 * name is unique in the whole tree (trimmed, case and accents ignored),
 * numbers follow the order, and every insert is audited. The tests work in
 * temporary disciplines appended to the shared development tree and remove
 * them at the end.
 */
let admin: TestUser;
let user: TestUser;
let discipline: Node;

interface Node {
  id: string;
  parentId: string | null;
  level: number;
  code: string;
  name: string;
}

const RUN = crypto.randomUUID().slice(0, 8);
const unique = (name: string) => `${name} ${RUN}`;
const url = (path: string) => `http://localhost${path}`;

async function insert(nodeId: string | null, mode: "child" | "neighbour", name: string) {
  const res = await insertRoute(jsonRequest(url("/api/admin/taxonomy/nodes"), "POST", { nodeId, insert: mode, name }), {} as never);
  return { status: res.status, body: await res.json() };
}
const childrenOf = (parentId: string) =>
  prisma.taxonomyNode.findMany({ where: { parentId }, orderBy: { position: "asc" }, select: { name: true, code: true } });

/** Removes this run's disciplines and everything below them (deepest first). */
async function cleanUp() {
  const roots = await prisma.taxonomyNode.findMany({ where: { parentId: null, name: { endsWith: RUN } }, select: { id: true } });
  let ids = roots.map((r) => r.id);
  const all: string[] = [];
  while (ids.length) {
    all.push(...ids);
    ids = (await prisma.taxonomyNode.findMany({ where: { parentId: { in: ids } }, select: { id: true } })).map((n) => n.id);
  }
  for (const id of all.reverse()) await prisma.taxonomyNode.delete({ where: { id } });
  await prisma.$transaction((tx) => renumber(tx));
}

beforeAll(async () => {
  await ensureTaxonomy();
  admin = await createTestUser("Tree admin");
  await prisma.user.update({ where: { id: admin.id }, data: { role: "ADMIN", nature: "HUMAN" } }); // only Human accounts can be Admin
  user = await createTestUser("Tree user");
  signInAs(admin.id);
  const last = await prisma.taxonomyNode.findFirstOrThrow({ where: { parentId: null }, orderBy: { position: "desc" } });
  discipline = (await insert(last.id, "neighbour", unique("Zz discipline"))).body.node;
});

afterAll(async () => {
  await cleanUp();
  await disposeTestUser(user.email);
  await disposeTestUser(admin.email);
  await prisma.$disconnect();
});

describe("Admin → Courses Tree: insert child / insert neighbour", () => {
  it("is for administrators only", async () => {
    signInAs(user.id);
    expect((await insert(discipline.id, "child", unique("Nope"))).status).toBe(403);
    expect((await exportRoute(jsonRequest(url("/api/admin/taxonomy/export"), "GET"), {} as never)).status).toBe(403);
  });

  it("inserts a discipline as the next neighbour of a discipline (no parent)", async () => {
    signInAs(admin.id);
    const roots = await prisma.taxonomyNode.count({ where: { parentId: null } });
    expect(discipline).toMatchObject({ level: 1, parentId: null, code: String(roots) });
    expect(await prisma.auditLog.count({ where: { entityId: discipline.id, action: "admin.taxonomy_insert" } })).toBe(1);
  });

  it("inserts a child as the FIRST child, one level down, and shifts the others", async () => {
    const b = (await insert(discipline.id, "child", unique("Subject B"))).body.node;
    expect(b).toMatchObject({ level: 2, parentId: discipline.id, code: `${discipline.code}.1` });
    const a = (await insert(discipline.id, "child", unique("Subject A"))).body.node;
    expect(a.code).toBe(`${discipline.code}.1`);
    expect(await childrenOf(discipline.id)).toEqual([
      { name: unique("Subject A"), code: `${discipline.code}.1` },
      { name: unique("Subject B"), code: `${discipline.code}.2` },
    ]);
  });

  it("inserts a neighbour right AFTER the selected node, same parent and level", async () => {
    const a = await prisma.taxonomyNode.findFirstOrThrow({ where: { name: unique("Subject A") } });
    const between = (await insert(a.id, "neighbour", unique("Subject A2"))).body.node;
    expect(between).toMatchObject({ level: 2, parentId: discipline.id, code: `${discipline.code}.2` });
    expect((await childrenOf(discipline.id)).map((n) => n.name)).toEqual([unique("Subject A"), unique("Subject A2"), unique("Subject B")]);
  });

  it("fills every level down to the topic, and refuses a child under a topic", async () => {
    const subject = await prisma.taxonomyNode.findFirstOrThrow({ where: { name: unique("Subject B") } });
    const module = (await insert(subject.id, "child", unique("Module"))).body.node;
    const topic = (await insert(module.id, "child", unique("Topic"))).body.node;
    expect(topic).toMatchObject({ level: 4, code: `${discipline.code}.3.1.1` });
    const refused = await insert(topic.id, "child", unique("Too deep"));
    expect(refused.status).toBe(400);
    expect(refused.body.error).toMatch(/lowest level: a topic has no children/);
    // A neighbour of a topic is a topic.
    expect((await insert(topic.id, "neighbour", unique("Topic 2"))).body.node).toMatchObject({ level: 4, code: `${discipline.code}.3.1.2` });
  });

  it("refuses a name already used anywhere in the tree, ignoring spaces, case and accents", async () => {
    const subject = await prisma.taxonomyNode.findFirstOrThrow({ where: { name: unique("Subject A") } });
    // Same parent, other case and spacing.
    const sibling = await insert(subject.id, "neighbour", `  subject a   ${RUN.toUpperCase()} `);
    expect(sibling.status).toBe(409);
    expect(sibling.body.error).toContain(`already exists in the tree (Zz discipline ${RUN} › Subject A ${RUN})`);
    // Another branch, another level, without the accent: "Schrödinger equation" is a topic of Quantum Physics.
    const elsewhere = await insert(subject.id, "child", "schrodinger EQUATION");
    expect(elsewhere.status).toBe(409);
    expect(elsewhere.body.error).toContain("Science › Physics › Quantum Physics › Schrödinger equation");
    expect(await prisma.taxonomyNode.count({ where: { parentId: subject.id } })).toBe(0);
  });

  it("needs a selected node unless the tree is empty", async () => {
    const res = await insert(null, "neighbour", unique("Floating"));
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Select a node first/);
  });

  it("exports the tree in the taxonomy file format", async () => {
    const res = await exportRoute(jsonRequest(url("/api/admin/taxonomy/export"), "GET"), {} as never);
    expect(res.headers.get("content-disposition")).toMatch(/COURSE-TAXONOMY\.txt/);
    const text = await res.text();
    expect(text).toContain(`${discipline.code}. ${discipline.name}\n   ${discipline.code}.1 ${unique("Subject A")}\n   ${discipline.code}.2 ${unique("Subject A2")}\n`);
    expect(() => parseTaxonomy(text)).not.toThrow();
  });
});
