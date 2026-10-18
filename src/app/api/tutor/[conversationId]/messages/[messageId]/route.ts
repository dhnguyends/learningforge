import { z } from "zod";
import { prisma } from "@/lib/db";
import { apiHandler, ok, parseJsonBody, requireSession, notFound } from "@/lib/api";

type Ctx = { params: { conversationId: string; messageId: string } };

const timingSchema = z.object({
  // From sending the question to the answer on screen, measured in the learner's browser.
  displayedMs: z.number().int().min(0).max(24 * 3_600_000),
});

/**
 * Saves the time the learner waited for an answer (the timer under it), so
 * it shows the same in a later session. The learner's own answers only, and
 * once: the first measurement is kept.
 */
export const PATCH = apiHandler<Ctx>(async (req, { params }) => {
  const session = await requireSession();
  const message = await prisma.tutorMessage.findUnique({
    where: { id: params.messageId },
    include: { conversation: { select: { id: true, userId: true } } },
  });
  if (!message || message.conversation.id !== params.conversationId || message.conversation.userId !== session.user.id || message.role !== "ASSISTANT") {
    throw notFound("Message");
  }
  const { displayedMs } = await parseJsonBody(req, timingSchema);
  const metadata = (message.metadata ?? {}) as Record<string, unknown>;
  if (typeof metadata.displayedMs === "number") return ok({ displayedMs: metadata.displayedMs, saved: false });
  await prisma.tutorMessage.update({ where: { id: message.id }, data: { metadata: { ...metadata, displayedMs } } });
  return ok({ displayedMs, saved: true });
});
