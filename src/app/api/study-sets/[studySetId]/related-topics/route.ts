import { z } from "zod";
import { prisma } from "@/lib/db";
import { apiHandler, notFound, ok, parseJsonBody, requireSession } from "@/lib/api";
import { assertStudySetAccess } from "@/lib/access";
import { audit } from "@/lib/audit";
import { MAX_RELATED, RELATED_SELECT, setRelatedTopics, toRelated } from "@/lib/taxonomy/related";

type Ctx = { params: { studySetId: string } };

const putSchema = z.object({
  /** The full list, in order (replaces the current one). */
  topicIds: z.array(z.string().min(1)).max(MAX_RELATED + 1),
});

/**
 * Set a course's related ("connexe") topics: up to 3 topics besides its main
 * one. The course owner (write access) or any administrator.
 */
export const PUT = apiHandler<Ctx>(async (req, { params }) => {
  const session = await requireSession();
  if (session.user.role === "ADMIN") {
    if (!(await prisma.studySet.findUnique({ where: { id: params.studySetId }, select: { id: true } }))) throw notFound("Study set");
  } else {
    await assertStudySetAccess(session.user.id, params.studySetId, "write");
  }
  const body = await parseJsonBody(req, putSchema);
  const { before, after } = await setRelatedTopics(params.studySetId, body.topicIds);
  await audit({
    userId: session.user.id,
    action: "study_set.related_topics",
    entityType: "study_set",
    entityId: params.studySetId,
    metadata: { before, after, asAdmin: session.user.role === "ADMIN" },
  });
  const set = await prisma.studySet.findUniqueOrThrow({ where: { id: params.studySetId }, select: { relatedTopics: RELATED_SELECT } });
  return ok({ related: toRelated(set.relatedTopics) });
});
