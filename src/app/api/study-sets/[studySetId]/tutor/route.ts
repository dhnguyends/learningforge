import { z } from "zod";
import { prisma, jsonSafe } from "@/lib/db";
import { apiHandler, ok, parseJsonBody, requireSession } from "@/lib/api";
import { assertStudySetAccess } from "@/lib/access";

type Ctx = { params: { studySetId: string } };

export const GET = apiHandler<Ctx>(async (_req, { params }) => {
  const session = await requireSession();
  const studySet = await assertStudySetAccess(session.user.id, params.studySetId);
  const conversations = await prisma.tutorConversation.findMany({
    where: { studySetId: studySet.id, userId: session.user.id },
    orderBy: { updatedAt: "desc" },
    include: { _count: { select: { messages: true } } },
  });
  return ok(jsonSafe({ conversations }));
});

export const POST = apiHandler<Ctx>(async (req, { params }) => {
  const session = await requireSession();
  const studySet = await assertStudySetAccess(session.user.id, params.studySetId);
  const body = await parseJsonBody(req, z.object({ title: z.string().max(160).optional() }));
  const conversation = await prisma.tutorConversation.create({
    data: {
      studySetId: studySet.id,
      userId: session.user.id,
      title: body.title ?? "New conversation",
      messages: {
        create: {
          role: "SYSTEM",
          content: `Tutor grounded in the sources of "${studySet.title}". Answers cite timestamps/pages; hints before solutions.`,
        },
      },
    },
    include: { messages: true },
  });
  return ok(jsonSafe({ conversation }), { status: 201 });
});
