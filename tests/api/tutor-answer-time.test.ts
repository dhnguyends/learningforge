import { describe, it, expect, beforeAll, afterAll } from "vitest";
import "./helpers";
import { prisma, createTestUser, disposeTestUser, signInAs, jsonRequest, type TestUser } from "./helpers";
import { PATCH as saveTime } from "@/app/api/tutor/[conversationId]/messages/[messageId]/route";
import { GET as getMessages } from "@/app/api/tutor/[conversationId]/messages/route";

/**
 * The tutor timer's time and model are kept with the answer, so the learner
 * finds the same tooltip in a later session: the model at answer time (by
 * the pipeline), the on-screen time from the browser (here), first value kept.
 */
let me: TestUser;
let other: TestUser;
let conversationId: string;
let answerId: string;
let questionId: string;

const patch = (messageId: string, body: unknown, conv = conversationId) =>
  saveTime(jsonRequest(`http://localhost/api/tutor/${conv}/messages/${messageId}`, "PATCH", body), { params: { conversationId: conv, messageId } });

beforeAll(async () => {
  me = await createTestUser("Timer learner");
  other = await createTestUser("Timer outsider");
  const set = await prisma.studySet.create({ data: { workspaceId: me.workspaceId, createdById: me.id, title: "Timer set" } });
  conversationId = (await prisma.tutorConversation.create({ data: { studySetId: set.id, userId: me.id } })).id;
  questionId = (await prisma.tutorMessage.create({ data: { conversationId, role: "USER", content: "What is a gradient?" } })).id;
  answerId = (
    await prisma.tutorMessage.create({
      data: {
        conversationId,
        role: "ASSISTANT",
        content: "The vector of partial derivatives.",
        metadata: { provider: "local", model: "deepseek-r1:8b", modelLabel: "DeepSeek-R1 8B · local" },
      },
    })
  ).id;
});

afterAll(async () => {
  await disposeTestUser(me.email);
  await disposeTestUser(other.email);
  await prisma.$disconnect();
});

describe("tutor answer time", () => {
  it("saves the on-screen time with the answer, next to its model, once", async () => {
    signInAs(me.id);
    expect(await (await patch(answerId, { displayedMs: 74_000 })).json()).toEqual({ displayedMs: 74_000, saved: true });
    // A second measurement does not replace the first.
    expect(await (await patch(answerId, { displayedMs: 5_000 })).json()).toEqual({ displayedMs: 74_000, saved: false });

    // What the next session loads: the time and the model, for the tooltip.
    const { conversation } = await (await getMessages(jsonRequest(`http://localhost/api/tutor/${conversationId}/messages`, "GET"), { params: { conversationId } })).json();
    const answer = conversation.messages.find((m: { id: string }) => m.id === answerId);
    expect(answer.metadata).toEqual({ provider: "local", model: "deepseek-r1:8b", modelLabel: "DeepSeek-R1 8B · local", displayedMs: 74_000 });
  });

  it("refuses bad times, questions, other conversations and other learners", async () => {
    signInAs(me.id);
    expect((await patch(answerId, { displayedMs: -1 })).status).toBe(400);
    expect((await patch(answerId, { displayedMs: 1.5 })).status).toBe(400);
    expect((await patch(questionId, { displayedMs: 1_000 })).status).toBe(404);
    expect((await patch(answerId, { displayedMs: 1_000 }, "another-conversation")).status).toBe(404);
    signInAs(other.id);
    expect((await patch(answerId, { displayedMs: 1_000 })).status).toBe(404);
  });
});

describe("tutor conversation export", () => {
  it("downloads the learner's conversation as Markdown, to nobody else", async () => {
    const { GET: exportMd } = await import("@/app/api/tutor/[conversationId]/export/route");
    const get = () => exportMd(jsonRequest(`http://localhost/api/tutor/${conversationId}/export`, "GET"), { params: { conversationId } });
    signInAs(me.id);
    const res = await get();
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/markdown; charset=utf-8");
    expect(res.headers.get("content-disposition")).toMatch(/^attachment; filename="tutor-new-conversation-\d{4}-\d{2}-\d{2}\.md"$/);
    const md = await res.text();
    expect(md).toContain("# New conversation");
    expect(md).toContain("study set **Timer set**");
    expect(md).toContain("What is a gradient?");
    expect(md).toContain("### Tutor · DeepSeek-R1 8B · local · answered in 00:01:14");
    signInAs(other.id);
    expect((await get()).status).toBe(404);
    signInAs(null);
    expect((await get()).status).toBe(401);
  });
});
