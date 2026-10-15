import { prisma } from "@/lib/db";
import { apiHandler, ok, requireAdmin, notFound } from "@/lib/api";
import { audit } from "@/lib/audit";
import { deleteStudySetCompletely } from "@/lib/deletion";

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
