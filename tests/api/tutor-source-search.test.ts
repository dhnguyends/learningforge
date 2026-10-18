import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import "./helpers";
import { prisma, createTestUser, disposeTestUser, signInAs, jsonRequest, type TestUser } from "./helpers";

/**
 * The tutor's "Search my sources" switch. Off: no semantic search runs, the
 * prompt carries no passages and asks for general knowledge, and the answer
 * is stored as general knowledge with no citations. On (the default): the
 * search runs as before. The search and the AI model are faked, so the test
 * sees exactly what would be sent.
 */
const calls = vi.hoisted(() => ({ search: [] as string[], prompts: [] as { system: string; user: string }[] }));

vi.mock("@/lib/retrieval", async (orig) => ({
  ...(await orig<typeof import("@/lib/retrieval")>()),
  searchChunks: vi.fn(async (_studySetId: string, query: string) => {
    calls.search.push(query);
    return [];
  }),
}));

vi.mock("@/lib/ai", async (orig) => ({
  ...(await orig<typeof import("@/lib/ai")>()),
  getGenerator: vi.fn(async () => ({
    provider: "fake",
    model: "fake",
    generate: async (opts: { system: string; user: string; schema: { parse: (v: unknown) => unknown }; mock?: () => unknown }) => {
      calls.prompts.push({ system: opts.system, user: opts.user });
      // The model claims its answer comes from the sources: the pipeline must not believe it when search is off.
      const data = opts.schema.parse({ answer: "The chain rule composes derivatives.", claimType: "source_grounded", citations: [{ chunkId: "made-up", excerpt: "x" }], followUpQuestion: "Next?", foundInSources: true, warnings: [] });
      return { data, provider: "fake", model: "fake", usage: { inputTokens: 1, outputTokens: 1 } };
    },
  })),
}));

import { POST as send } from "@/app/api/tutor/[conversationId]/messages/route";
import { TUTOR_SYSTEM, TUTOR_SYSTEM_GENERAL } from "@/lib/prompts";

let me: TestUser;
let conversationId: string;

const post = (body: unknown) => send(jsonRequest(`http://localhost/api/tutor/${conversationId}/messages`, "POST", body), { params: { conversationId } });

beforeAll(async () => {
  me = await createTestUser("Tutor switch learner");
  const set = await prisma.studySet.create({ data: { workspaceId: me.workspaceId, createdById: me.id, title: "Backprop notes" } });
  conversationId = (await prisma.tutorConversation.create({ data: { studySetId: set.id, userId: me.id } })).id;
});

afterAll(async () => {
  await disposeTestUser(me.email);
  await prisma.$disconnect();
});

beforeEach(() => {
  calls.search = [];
  calls.prompts = [];
});

describe("tutor source search switch", () => {
  it("off: no search, no passages, general knowledge without citations", async () => {
    signInAs(me.id);
    const res = await post({ content: "What is the chain rule?", sourceSearch: false });
    expect(res.status).toBe(201);
    const { reply } = await res.json();

    expect(calls.search).toEqual([]);
    expect(calls.prompts).toHaveLength(1);
    expect(calls.prompts[0].system).toBe(TUTOR_SYSTEM_GENERAL);
    expect(calls.prompts[0].user).toMatch(/SOURCE SEARCH: off/);
    expect(calls.prompts[0].user).not.toMatch(/SOURCE CHUNKS/);

    expect(reply).toMatchObject({ claimType: "external", foundInSources: false, anchors: [], sourceSearch: false, warnings: [] });
    const [question, answer] = await prisma.tutorMessage.findMany({ where: { conversationId }, orderBy: { createdAt: "asc" }, include: { anchors: true } });
    expect(question).toMatchObject({ role: "USER", metadata: { sourceSearch: false } });
    expect(answer).toMatchObject({ role: "ASSISTANT", claimType: "EXTERNAL", metadata: { sourceSearch: false, foundInSources: false, retrievalScores: [] } });
    // The model that answered, for the timer's tooltip.
    expect(answer.metadata).toMatchObject({ provider: "fake", model: "fake", modelLabel: "fake" });
    expect(answer.anchors).toEqual([]);
  });

  it("on by default: the sources are searched (with the previous question for a follow-up)", async () => {
    signInAs(me.id);
    expect((await post({ content: "Why?" })).status).toBe(201);
    expect(calls.search).toEqual(["Why?", "What is the chain rule?\nWhy?"]);
    expect(calls.prompts[0].system).toBe(TUTOR_SYSTEM);
    expect(calls.prompts[0].user).toMatch(/SOURCE CHUNKS \(retrieved\)/);
    const last = await prisma.tutorMessage.findFirstOrThrow({ where: { conversationId, role: "ASSISTANT" }, orderBy: { createdAt: "desc" } });
    // Nothing was retrieved, so the model's "from the sources" claim is not believed either.
    expect(last).toMatchObject({ claimType: "INFERENCE", metadata: { sourceSearch: true, foundInSources: false } });
  });

  it("refuses Show source while search is off", async () => {
    signInAs(me.id);
    const res = await post({ content: "Where is this?", mode: "show_source", sourceSearch: false });
    expect(res.status).toBe(400);
    expect(calls.prompts).toEqual([]);
  });
});
