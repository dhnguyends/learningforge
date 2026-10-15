import { prisma } from "@/lib/db";
import { getStorage, studySetPrefix } from "@/lib/storage";

export interface DeletionSummary {
  studySets: number;
  sources: number;
}

/**
 * Permanent deletion of study sets and accounts, with their stored files.
 *
 * Rows go first (one cascade: sources, transcripts, passages, guides, cards,
 * quizzes, exercises, progress, jobs), files second. A storage failure then
 * only leaves unreferenced files behind (logged), never rows pointing at
 * files that are gone.
 */
async function purge(prefixes: string[], context: string): Promise<void> {
  const storage = getStorage();
  for (const prefix of prefixes) {
    await storage.deletePrefix(prefix).catch((err) => console.error(`[${context}] storage purge failed for ${prefix}`, err));
  }
}

export async function deleteStudySetCompletely(studySetId: string): Promise<DeletionSummary> {
  const set = await prisma.studySet.findUniqueOrThrow({
    where: { id: studySetId },
    select: { id: true, workspaceId: true, _count: { select: { sources: true } } },
  });
  await prisma.studySet.delete({ where: { id: set.id } });
  await purge([studySetPrefix(set.workspaceId, set.id)], "study_set.delete");
  return { studySets: 1, sources: set._count.sources };
}

/**
 * Deletes an account and everything it owns: its workspaces with every study
 * set in them, plus any study set it created in someone else's workspace.
 */
export async function deleteAccountCompletely(userId: string): Promise<DeletionSummary> {
  const owned = await prisma.workspace.findMany({ where: { ownerId: userId }, select: { id: true } });
  const ownedIds = owned.map((w) => w.id);
  const sets = await prisma.studySet.findMany({
    where: { OR: [{ workspaceId: { in: ownedIds } }, { createdById: userId }] },
    select: { id: true, workspaceId: true, _count: { select: { sources: true } } },
  });
  const elsewhere = sets.filter((s) => !ownedIds.includes(s.workspaceId));

  await prisma.$transaction([
    // Sets created in other people's workspaces cascade from the creator too,
    // but deleting them explicitly keeps the intent obvious.
    prisma.studySet.deleteMany({ where: { id: { in: sets.map((s) => s.id) } } }),
    prisma.user.delete({ where: { id: userId } }), // cascades workspaces, memberships, history
  ]);
  await purge(
    [...ownedIds.map((id) => `workspaces/${id}`), ...elsewhere.map((s) => studySetPrefix(s.workspaceId, s.id))],
    "account.delete",
  );
  return { studySets: sets.length, sources: sets.reduce((n, s) => n + s._count.sources, 0) };
}
