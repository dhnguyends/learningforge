import { prisma } from "@/lib/db";
import { forbidden, notFound } from "@/lib/api";
import type { StudySet, WorkspaceRole } from "@prisma/client";

/**
 * Per-workspace authorization. Every study-set-scoped route resolves access
 * through here: workspace membership required, role checked for writes.
 */
export async function assertStudySetAccess(
  userId: string,
  studySetId: string,
  require: "read" | "write" = "read",
): Promise<StudySet> {
  const studySet = await prisma.studySet.findUnique({
    where: { id: studySetId },
    include: { workspace: { include: { members: { where: { userId } } } } },
  });
  if (!studySet) throw notFound("Study set");
  const membership = studySet.workspace.members[0];
  if (!membership) throw forbidden();
  if (require === "write" && membership.role === "VIEWER") throw forbidden();
  return studySet;
}

export async function assertWorkspaceAccess(
  userId: string,
  workspaceId: string,
  require: "read" | "write" = "read",
): Promise<{ role: WorkspaceRole }> {
  const membership = await prisma.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId, userId } },
  });
  if (!membership) throw forbidden();
  if (require === "write" && membership.role === "VIEWER") throw forbidden();
  return { role: membership.role };
}

export async function listUserWorkspaceIds(userId: string): Promise<string[]> {
  const memberships = await prisma.workspaceMember.findMany({ where: { userId }, select: { workspaceId: true } });
  return memberships.map((m) => m.workspaceId);
}
