import { z } from "zod";
import { prisma, jsonSafe } from "@/lib/db";
import { apiHandler, ok, parseJsonBody, requireSession, notFound, badRequest } from "@/lib/api";
import { assertStudySetAccess } from "@/lib/access";
import { answerTutorMessage, type TutorMode } from "@/lib/pipelines/tutor";
import { rateLimit } from "@/lib/rate-limit";
import { rateLimited } from "@/lib/api";

type Ctx = { params: { conversationId: string } };

export const GET = apiHandler<Ctx>(async (_req, { params }) => {
  const session = await requireSession();
  const conversation = await prisma.tutorConversation.findUnique({
    where: { id: params.conversationId },
    include: {
      messages: {
        orderBy: { createdAt: "asc" },
        include: { anchors: { include: { source: { select: { id: true, title: true, type: true } } } } },
      },
    },
  });
  if (!conversation || conversation.userId !== session.user.id) throw notFound("Conversation");
  await assertStudySetAccess(session.user.id, conversation.studySetId);
  return ok(jsonSafe({ conversation }));
});

const messageSchema = z.object({
  content: z.string().min(1).max(6000),
  mode: z.enum(["answer", "hint", "explain_differently", "show_source", "challenge", "reveal_solution"]).default("answer"),
  // Semantic search of the study set's sources (RAG). false: the message is
  // sent without passages and answered from general knowledge.
  sourceSearch: z.boolean().default(true),
});

export const POST = apiHandler<Ctx>(async (req, { params }) => {
  const session = await requireSession();
  const conversation = await prisma.tutorConversation.findUnique({ where: { id: params.conversationId } });
  if (!conversation || conversation.userId !== session.user.id) throw notFound("Conversation");
  await assertStudySetAccess(session.user.id, conversation.studySetId, "write");

  const limit = rateLimit(`tutor:${session.user.id}`, 60);
  if (!limit.allowed) throw rateLimited(limit.retryAfterSec);

  const body = await parseJsonBody(req, messageSchema);
  if (!body.sourceSearch && body.mode === "show_source") throw badRequest("Show source needs source search: turn it on, or pick another mode");
  const result = await answerTutorMessage({
    conversationId: conversation.id,
    question: body.content,
    mode: body.mode as TutorMode,
    sourceSearch: body.sourceSearch,
  });
  return ok(jsonSafe({ reply: result }), { status: 201 });
});
