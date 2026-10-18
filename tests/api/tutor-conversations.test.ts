import { describe, it, expect, beforeAll, afterAll } from "vitest";
import "./helpers";
import { prisma, createTestUser, disposeTestUser, signInAs, jsonRequest, type TestUser } from "./helpers";
import { PATCH as rename, DELETE as remove } from "@/app/api/tutor/[conversationId]/route";

/**
 * Renaming and deleting tutor conversations (the conversation list's menu):
 * the learner's own only, a title that is not empty, and a deletion that
 * takes the messages with it, audited.
 */
let me: TestUser;
let other: TestUser;
let conversationId: string;

const ctx = () => ({ params: { conversationId } });
const url = () => `http://localhost/api/tutor/${conversationId}`;

beforeAll(async () => {
  me = await createTestUser("Conversation owner");
  other = await createTestUser("Conversation outsider");
  const set = await prisma.studySet.create({ data: { workspaceId: me.workspaceId, createdById: me.id, title: "Rename set" } });
  const c = await prisma.tutorConversation.create({ data: { studySetId: set.id, userId: me.id } });
  conversationId = c.id;
  await prisma.tutorMessage.createMany({
    data: [
      { conversationId, role: "USER", content: "Why is backprop cheap?" },
      { conversationId, role: "ASSISTANT", content: "One backward sweep." },
    ],
  });
});

afterAll(async () => {
  await disposeTestUser(me.email);
  await disposeTestUser(other.email);
  await prisma.$disconnect();
});

describe("tutor conversations: rename and delete", () => {
  it("renames the learner's own conversation, trimmed", async () => {
    signInAs(me.id);
    const res = await rename(jsonRequest(url(), "PATCH", { title: "  Backprop costs  " }), ctx());
    expect(res.status).toBe(200);
    expect((await res.json()).conversation.title).toBe("Backprop costs");
    expect((await prisma.tutorConversation.findUniqueOrThrow({ where: { id: conversationId } })).title).toBe("Backprop costs");
  });

  it("refuses an empty or too long title", async () => {
    signInAs(me.id);
    expect((await rename(jsonRequest(url(), "PATCH", { title: "   " }), ctx())).status).toBe(400);
    expect((await rename(jsonRequest(url(), "PATCH", { title: "x".repeat(121) }), ctx())).status).toBe(400);
  });

  it("is closed to anyone else", async () => {
    signInAs(other.id);
    expect((await rename(jsonRequest(url(), "PATCH", { title: "Mine now" }), ctx())).status).toBe(404);
    expect((await remove(jsonRequest(url(), "DELETE"), ctx())).status).toBe(404);
    signInAs(null);
    expect((await remove(jsonRequest(url(), "DELETE"), ctx())).status).toBe(401);
    expect(await prisma.tutorConversation.count({ where: { id: conversationId } })).toBe(1);
  });

  it("deletes it with its messages, audited", async () => {
    signInAs(me.id);
    const res = await remove(jsonRequest(url(), "DELETE"), ctx());
    expect(await res.json()).toEqual({ deleted: true, messages: 2 });
    expect(await prisma.tutorConversation.count({ where: { id: conversationId } })).toBe(0);
    expect(await prisma.tutorMessage.count({ where: { conversationId } })).toBe(0);
    expect(await prisma.auditLog.count({ where: { userId: me.id, action: "tutor.conversation_delete", entityId: conversationId } })).toBe(1);
    expect((await remove(jsonRequest(url(), "DELETE"), ctx())).status).toBe(404);
  });
});
