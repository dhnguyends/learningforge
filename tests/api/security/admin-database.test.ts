import { describe, it, expect, beforeAll, afterAll } from "vitest";
import "../helpers";
import { prisma, createTestUser, disposeTestUser, signInAs, jsonRequest, type TestUser } from "../helpers";
import { GET as getStats } from "@/app/api/admin/database/route";
import { POST as rebuildIndex } from "@/app/api/admin/database/vector-index/route";
import { indexChunks } from "@/lib/retrieval";
import { vectorIndexStatus, VECTOR_INDEX_NAME } from "@/lib/vector-index";

/**
 * Admin Database tab: read-only figures about the vector database
 * (segmentation, embeddings, sizes) and the semantic-search index, which
 * administrators can create or rebuild. Closed to everyone else.
 */
let admin: TestUser;
let user: TestUser;
let studySetId: string;

const draft = (ordinal: number, tokenCount: number) => ({
  ordinal,
  kind: "DOCUMENT" as const,
  content: `Passage ${ordinal} about Ohm's law, voltage, current and resistance in simple circuits.`,
  page: ordinal + 1,
  tokenCount,
});

beforeAll(async () => {
  admin = await createTestUser("Database admin");
  await prisma.user.update({ where: { id: admin.id }, data: { role: "ADMIN", nature: "HUMAN" } });
  user = await createTestUser("Database user");
  const set = await prisma.studySet.create({ data: { workspaceId: user.workspaceId, createdById: user.id, title: "Stats course" } });
  studySetId = set.id;
  const a = await prisma.source.create({ data: { studySetId, type: "PDF", title: "a.pdf", status: "READY" } });
  const b = await prisma.source.create({ data: { studySetId, type: "NOTE", title: "b.txt", status: "READY" } });
  await indexChunks(a.id, [draft(0, 300), draft(1, 320)]);
  await indexChunks(b.id, [draft(0, 100)]);
});

afterAll(async () => {
  await disposeTestUser(admin.email);
  await disposeTestUser(user.email);
  await prisma.$disconnect();
});

const stats = () => getStats(jsonRequest("http://localhost/api/admin/database?refresh=1", "GET"), {} as never);

describe("admin database monitoring", () => {
  it("is closed to non-admins", async () => {
    signInAs(user.id);
    expect((await stats()).status).toBe(403);
    expect((await rebuildIndex(jsonRequest("http://localhost/x", "POST"), {} as never)).status).toBe(403);
    signInAs(null);
    expect((await stats()).status).toBe(401);
  });

  it("reports segmentation and embeddings that match the stored passages", async () => {
    signInAs(admin.id);
    const res = await stats();
    expect(res.status).toBe(200);
    const body = await res.json();

    const course = body.segmentation.byCourse.find((c: { id: string }) => c.id === studySetId);
    expect(course).toMatchObject({ title: "Stats course", sources: 2, passages: 3, tokens: 720 });
    expect(course.vectorBytes).toBeGreaterThan(0);

    expect(body.database.sizeBytes).toBeGreaterThan(0);
    expect(body.database.pgvectorVersion).toBeTruthy();
    expect(body.counts.passages).toBeGreaterThanOrEqual(3);
    expect(body.segmentation).toMatchObject({ targetTokens: 320, maxTokens: 480 });
    expect(body.embeddings).toMatchObject({ metric: "cosine", storedDimensions: 1536 });
    expect(body.embeddings.bytesPerVector).toBeGreaterThan(1536 * 4 - 1); // float32 per dimension
    expect(body.tables.some((t: { name: string }) => t.name === "extracted_chunks")).toBe(true);
    expect(body.index).toHaveProperty("present");
  });

  it("creates or rebuilds the HNSW search index", async () => {
    signInAs(admin.id);
    const res = await rebuildIndex(jsonRequest("http://localhost/x", "POST"), {} as never);
    expect(res.status).toBe(200);
    expect((await res.json()).index).toMatchObject({ present: true, valid: true, method: "hnsw" });

    const status = await vectorIndexStatus();
    expect(status).toMatchObject({ present: true, valid: true, method: "hnsw" });
    expect(status.definition).toContain(VECTOR_INDEX_NAME);
    expect(status.definition).toContain("vector_cosine_ops");
    expect(await prisma.auditLog.count({ where: { action: "admin.vector_index_rebuild", userId: admin.id } })).toBe(1);
  });
});
