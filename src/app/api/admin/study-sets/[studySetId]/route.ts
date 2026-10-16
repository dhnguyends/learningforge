import { z } from "zod";
import { prisma } from "@/lib/db";
import { apiHandler, ok, requireAdmin, notFound, parseJsonBody } from "@/lib/api";
import { audit } from "@/lib/audit";
import { deleteStudySetCompletely } from "@/lib/deletion";
import { TOPIC_SELECT, resolveTopicId, toClassification } from "@/lib/taxonomy/store";

type Ctx = { params: { studySetId: string } };

/**
 * Delete any course (study set) as an administrator: its sources, generated
 * material, everyone's progress on it and its stored files. Allowed while a
 * job is running too — a stuck job must not make a course undeletable; the
 * job's rows go with the set.
 */
export const DELETE = apiHandler<Ctx>(async (_req, { params }) => {
  const admin = await requireAdmin();
  const set = await prisma.studySet.findUnique({
    where: { id: params.studySetId },
    select: { id: true, title: true, workspace: { select: { ownerId: true } } },
  });
  if (!set) throw notFound("Study set");
  const removed = await deleteStudySetCompletely(set.id);
  await audit({
    userId: admin.user.id,
    action: "admin.study_set_delete",
    entityType: "study_set",
    entityId: set.id,
    metadata: { title: set.title, ownerId: set.workspace.ownerId, ...removed },
  });
  return ok({ deleted: true, ...removed });
});

const patchSchema = z.object({
  /** Topic (level 4) of the course tree; null removes the classification. */
  topicId: z.string().min(1).nullable(),
});

/** File any course under a topic (or remove its topic) as an administrator. */
export const PATCH = apiHandler<Ctx>(async (req, { params }) => {
  const admin = await requireAdmin();
  const body = await parseJsonBody(req, patchSchema);
  const set = await prisma.studySet.findUnique({ where: { id: params.studySetId }, select: { id: true, topicId: true } });
  if (!set) throw notFound("Study set");
  const topicId = await resolveTopicId(body.topicId);
  // The main topic is never also a related topic: becoming main removes that link.
  const updated = await prisma.$transaction(async (tx) => {
    if (topicId) await tx.studySetRelatedTopic.deleteMany({ where: { studySetId: set.id, topicId } });
    return tx.studySet.update({ where: { id: set.id }, data: { topicId }, select: { topic: TOPIC_SELECT } });
  });
  await audit({
    userId: admin.user.id,
    action: "admin.study_set_classify",
    entityType: "study_set",
    entityId: set.id,
    metadata: { topicId, previousTopicId: set.topicId },
  });
  return ok({ classification: toClassification(updated.topic) });
});
