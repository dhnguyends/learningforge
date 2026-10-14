import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import "./helpers";
import { prisma, createTestUser, disposeTestUser, type TestUser } from "./helpers";
import { indexChunks, retrieveForWholeSet } from "@/lib/retrieval";
import { resolveChunkRef, resolveChunkRefs } from "@/lib/pipelines/validation";
import type { ExerciseDraft } from "@/lib/pipelines/schemas";

/**
 * Regression: Gemma 4 (via Ollama) marked every exercise grounded=true but
 * left chunkIds empty (or cited "CHUNK 2" labels). The pipeline dropped every
 * grounded exercise without a verifiable citation, so generation always failed
 * with "Generation produced no valid exercises."
 */

// The generator returns whatever the current test queues up.
const queued: { exercises: ExerciseDraft[] }[] = [];
vi.mock("@/lib/ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ai")>();
  return {
    ...actual,
    getGenerator: () => ({
      provider: "test",
      model: "test",
      generate: async () => ({ data: queued.shift()!, provider: "test", model: "test", usage: { inputTokens: 0, outputTokens: 0 } }),
    }),
  };
});

const { generateExercisesJob } = await import("@/lib/pipelines/exercises");

const noopCtx = { updateStage: async () => undefined, log: () => undefined };
let me: TestUser;
let studySetId: string;
let chunkIds: string[];

const draft = (title: string, grounded: boolean, ids: string[]): ExerciseDraft => ({
  type: "quantitative",
  title,
  prompt: "Compute the equivalent resistance of the network described in the source.",
  prerequisites: [],
  assumptions: [],
  requiredKnowledge: [],
  estimatedMinutes: 15,
  difficulty: "hard",
  grounded,
  hints: ["Direction", "Key relation", "Scaffold"],
  solution: "R_total = R1 + R2 = 10 + 20 = 30 ohms.",
  chunkIds: ids,
  warnings: [],
});

beforeAll(async () => {
  me = await createTestUser("Exercises");
  const set = await prisma.studySet.create({ data: { workspaceId: me.workspaceId, createdById: me.id, title: "Basic electronics" } });
  studySetId = set.id;
  const source = await prisma.source.create({ data: { studySetId, type: "PDF", title: "notes.pdf", status: "READY" } });
  const indexed = await indexChunks(source.id, [
    { ordinal: 0, kind: "DOCUMENT", content: "Basic electronics: resistors in series add, R total equals R1 plus R2.", page: 1, tokenCount: 20 },
    { ordinal: 1, kind: "DOCUMENT", content: "Basic electronics: capacitors block DC and pass AC signals.", page: 2, tokenCount: 20 },
  ]);
  chunkIds = indexed.map((c) => c.id);
});

afterAll(async () => {
  await disposeTestUser(me.email);
  await prisma.$disconnect();
});

async function run(config: Record<string, unknown> = {}) {
  const set = await prisma.exerciseSet.create({ data: { studySetId, title: "ex", config: { count: 3, ...config } } });
  await generateExercisesJob({ payload: { studySetId, exerciseSetId: set.id }, ...noopCtx });
  return prisma.exerciseSet.findUniqueOrThrow({
    where: { id: set.id },
    include: { exercises: { include: { anchors: true }, orderBy: { ordinal: "asc" } } },
  });
}

describe("exercise generation with imperfect citations", () => {
  it("keeps grounded exercises that cite nothing, relabelled as practice with a warning", async () => {
    queued.push({ exercises: [draft("No citation A", true, []), draft("No citation B", true, [])] });
    const set = await run();
    expect(set.status).toBe("READY");
    expect(set.exercises).toHaveLength(2);
    for (const e of set.exercises) {
      expect(e.grounded).toBe(false);
      expect(e.anchors).toHaveLength(0);
      expect(e.warnings.join(" ")).toMatch(/cited no source passage/);
    }
  });

  it("resolves 'CHUNK n' labels to the real chunk and keeps the exercise grounded", async () => {
    // "[CHUNK n]" numbers follow the order the model saw (retrieval order).
    const seen = (await retrieveForWholeSet(studySetId, "Basic electronics", { k: 16 })).map((c) => c.id);
    queued.push({ exercises: [draft("Positional", true, ["CHUNK 2"]), draft("Exact", true, [chunkIds[0]])] });
    const set = await run();
    expect(set.exercises.map((e) => e.grounded)).toEqual([true, true]);
    expect(set.exercises[0].anchors.map((a) => a.chunkId)).toEqual([seen[1]]);
    expect(set.exercises[1].anchors.map((a) => a.chunkId)).toEqual([chunkIds[0]]);
  });

  it("with groundedOnly, fails with an explanation instead of the old generic error", async () => {
    queued.push({ exercises: [draft("No citation", true, [])] });
    await expect(run({ groundedOnly: true })).rejects.toThrow(/could be tied to a source passage/);
  });
});

describe("resolveChunkRef", () => {
  const ids = ["cmv8bahit0000730qvqtg6sk2", "cmv8bahjl0001730q079dmkrm", "cmv8bahjl0002730qwnxc74lu"];
  it.each([
    ["cmv8bahjl0001730q079dmkrm", ids[1]],
    ["id=cmv8bahjl0002730qwnxc74lu", ids[2]],
    ["[CHUNK 1]", ids[0]],
    ["CHUNK 3", ids[2]],
    ["chunk_2", ids[1]],
    ["2", ids[1]],
  ])("resolves %j", (ref, expected) => {
    expect(resolveChunkRef(ref, ids)).toBe(expected);
  });

  it.each([["CHUNK 4"], ["0"], ["cmvUNKNOWN"], ["chunk_x"], [""]])("rejects %j", (ref) => {
    expect(resolveChunkRef(ref, ids)).toBeNull();
  });

  it("de-duplicates while keeping order", () => {
    expect(resolveChunkRefs(["CHUNK 2", ids[1], "1", "bogus"], ids)).toEqual([ids[1], ids[0]]);
  });
});
