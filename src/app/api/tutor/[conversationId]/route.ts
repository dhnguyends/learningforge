import { z } from "zod";
import { prisma } from "@/lib/db";
import { apiHandler, ok, parseJsonBody, requireSession, notFound } from "@/lib/api";
import { assertStudySetAccess } from "@/lib/access";
import { audit } from "@/lib/audit";

type Ctx = { params: { conversationId: string } };

/** A tutor conversation of the signed-in learner (anyone else gets a 404). */
async function ownConversation(userId: string, conversationId: string) {
  const conversation = await prisma.tutorConversation.findUnique({ where: { id: conversationId } });
  if (!conversation || conversation.userId !== userId) throw notFound("Conversation");
  await assertStudySetAccess(userId, conversation.studySetId, "write");
  return conversation;
}

const renameSchema = z.object({ title: z.string().trim().min(1, "The title cannot be empty").max(120) });

/** Renames a conversation (its title in the tutor's list). */
export const PATCH = apiHandler<Ctx>(async (req, { params }) => {
  const session = await requireSession();
  await ownConversation(session.user.id, params.conversationId);
  const { title } = await parseJsonBody(req, renameSchema);
  const conversation = await prisma.tutorConversation.update({
    where: { id: params.conversationId },
    data: { title },
    select: { id: true, title: true, studySetId: true, updatedAt: true },
  });
  return ok({ conversation });
});

/** Deletes a conversation and its messages. */
export const DELETE = apiHandler<Ctx>(async (_req, { params }) => {
  const session = await requireSession();
  const conversation = await ownConversation(session.user.id, params.conversationId);
  const messages = await prisma.tutorMessage.count({ where: { conversationId: conversation.id } });
  await prisma.tutorConversation.delete({ where: { id: conversation.id } }); // messages cascade
  await audit({
    userId: session.user.id,
    action: "tutor.conversation_delete",
    entityType: "tutor_conversation",
    entityId: conversation.id,
    metadata: { studySetId: conversation.studySetId, messages },
  });
  return ok({ deleted: true, messages });
});
