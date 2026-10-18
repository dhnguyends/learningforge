import { prisma } from "@/lib/db";
import { apiHandler, requireSession, notFound } from "@/lib/api";
import { assertStudySetAccess } from "@/lib/access";
import { conversationToMarkdown, exportFileName } from "@/lib/tutor-export";

type Ctx = { params: { conversationId: string } };

/** The conversation as a Markdown file (.md), for its learner only. */
export const GET = apiHandler<Ctx>(async (_req, { params }) => {
  const session = await requireSession();
  const conversation = await prisma.tutorConversation.findUnique({
    where: { id: params.conversationId },
    include: {
      studySet: { select: { title: true } },
      messages: {
        orderBy: { createdAt: "asc" },
        include: { anchors: { include: { source: { select: { title: true } } } } },
      },
    },
  });
  if (!conversation || conversation.userId !== session.user.id) throw notFound("Conversation");
  await assertStudySetAccess(session.user.id, conversation.studySetId);

  const now = new Date();
  const markdown = conversationToMarkdown({
    title: conversation.title,
    studySetTitle: conversation.studySet.title,
    exportedAt: now,
    messages: conversation.messages,
  });
  const filename = exportFileName(conversation.title, now);
  return new Response(markdown, {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
});
