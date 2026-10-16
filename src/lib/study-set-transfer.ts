import { prisma } from "@/lib/db";
import { ApiError, badRequest, notFound } from "@/lib/api";
import { ensureUserWorkspace } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { getStorage, studySetPrefix } from "@/lib/storage";

export interface TransferResult {
  studySetId: string;
  fromUserId: string;
  toUserId: string;
  filesMoved: number;
}

/**
 * Give a study set to another account. A study set belongs to exactly one
 * account: it lives in that account's own workspace, so the transfer moves it
 * to the new owner's workspace and the previous owner loses access.
 *
 * - Stored files live under the workspace's prefix (file serving authorizes on
 *   it), so every object under the set is copied to the new prefix, the
 *   database is switched in one transaction (asset keys, keys inside JSON such
 *   as the audio recap, owner), and only then are the old objects deleted. A
 *   failed transaction removes the copies; nothing is lost either way.
 * - The previous owner's learning history on this set (reviews, attempts,
 *   tutor chats, progress) moves with it to the new owner.
 * - Refused while an import or generation of the set is running: that job
 *   would keep writing under the old prefix.
 */
export async function transferStudySet(opts: { studySetId: string; toUserId: string; actorId: string }): Promise<TransferResult> {
  const set = await prisma.studySet.findUnique({ where: { id: opts.studySetId }, include: { workspace: true } });
  if (!set) throw notFound("Study set");
  const toUser = await prisma.user.findUnique({ where: { id: opts.toUserId }, select: { id: true, name: true } });
  if (!toUser) throw notFound("Account");
  const fromUserId = set.workspace.ownerId;
  if (fromUserId === toUser.id) throw badRequest("This account already owns the study set");

  const running = await prisma.generationJob.count({ where: { studySetId: set.id, status: { in: ["QUEUED", "RUNNING"] } } });
  if (running) {
    throw new ApiError(409, "An import or generation of this study set is running — wait until it finishes", "study_set_busy");
  }

  const toWorkspaceId = await ensureUserWorkspace(toUser.id, toUser.name);
  const oldPrefix = `${studySetPrefix(set.workspaceId, set.id)}/`;
  const newPrefix = `${studySetPrefix(toWorkspaceId, set.id)}/`;
  const swap = (text: string) => text.split(oldPrefix).join(newPrefix);

  // 1. Copy every stored object (originals, extracted audio, recaps…).
  const storage = getStorage();
  const keys = await storage.list(oldPrefix.slice(0, -1));
  try {
    for (const key of keys) await storage.copy(key, swap(key));
  } catch (err) {
    await storage.deletePrefix(newPrefix.slice(0, -1));
    throw err;
  }

  // 2. Switch the database over, all or nothing.
  const sources = await prisma.source.findMany({ where: { studySetId: set.id }, select: { id: true, metadata: true } });
  const sourceIds = sources.map((s) => s.id);
  const [assets, guides, jobs, decks, quizzes, exerciseSets, segments, passages] = await Promise.all([
    prisma.sourceAsset.findMany({ where: { sourceId: { in: sourceIds } }, select: { id: true, storageKey: true } }),
    prisma.studyGuide.findMany({ where: { studySetId: set.id }, select: { id: true, metadata: true, sections: { select: { id: true } } } }),
    prisma.generationJob.findMany({ where: { studySetId: set.id }, select: { id: true, payload: true, result: true } }),
    prisma.flashcardDeck.findMany({ where: { studySetId: set.id }, select: { cards: { select: { id: true } } } }),
    prisma.quiz.findMany({ where: { studySetId: set.id }, select: { questions: { select: { id: true } } } }),
    prisma.exerciseSet.findMany({ where: { studySetId: set.id }, select: { exercises: { select: { id: true } } } }),
    prisma.transcriptSegment.findMany({ where: { transcript: { sourceId: { in: sourceIds } } }, select: { id: true } }),
    prisma.extractedChunk.findMany({ where: { sourceId: { in: sourceIds } }, select: { id: true } }),
  ]);
  const cardIds = decks.flatMap((d) => d.cards.map((c) => c.id));
  const editedEntityIds = [
    ...guides.flatMap((g) => g.sections.map((s) => s.id)),
    ...cardIds,
    ...quizzes.flatMap((q) => q.questions.map((x) => x.id)),
    ...exerciseSets.flatMap((e) => e.exercises.map((x) => x.id)),
    ...segments.map((s) => s.id),
    ...passages.map((p) => p.id),
  ];
  const withNewKeys = <T>(value: T): T => JSON.parse(swap(JSON.stringify(value))) as T;
  const mentionsOld = (value: unknown) => value != null && JSON.stringify(value).includes(oldPrefix);

  try {
    await prisma.$transaction(async (tx) => {
      await tx.studySet.update({ where: { id: set.id }, data: { workspaceId: toWorkspaceId, createdById: toUser.id } });
      for (const a of assets) {
        if (a.storageKey.startsWith(oldPrefix)) await tx.sourceAsset.update({ where: { id: a.id }, data: { storageKey: swap(a.storageKey) } });
      }
      for (const s of sources) {
        if (mentionsOld(s.metadata)) await tx.source.update({ where: { id: s.id }, data: { metadata: withNewKeys(s.metadata) as object } });
      }
      for (const g of guides) {
        if (mentionsOld(g.metadata)) await tx.studyGuide.update({ where: { id: g.id }, data: { metadata: withNewKeys(g.metadata) as object } });
      }
      for (const j of jobs) {
        if (mentionsOld(j.payload) || mentionsOld(j.result)) {
          await tx.generationJob.update({
            where: { id: j.id },
            data: { payload: withNewKeys(j.payload) as object, ...(j.result != null ? { result: withNewKeys(j.result) as object } : {}) },
          });
        }
      }

      // The previous owner's learning history follows the course.
      const keepTopics = await tx.progressMetric.findMany({ where: { studySetId: set.id, userId: toUser.id }, select: { topic: true } });
      if (keepTopics.length) {
        await tx.progressMetric.deleteMany({ where: { studySetId: set.id, userId: fromUserId, topic: { in: keepTopics.map((t) => t.topic) } } });
      }
      const reassign = { where: { studySetId: set.id, userId: fromUserId }, data: { userId: toUser.id } };
      await tx.progressMetric.updateMany(reassign);
      await tx.tutorConversation.updateMany(reassign);
      await tx.attempt.updateMany(reassign);
      await tx.studySession.updateMany(reassign);
      await tx.flashcardReview.updateMany({ where: { cardId: { in: cardIds }, userId: fromUserId }, data: { userId: toUser.id } });
      await tx.artifactEdit.updateMany({ where: { entityId: { in: editedEntityIds }, editedById: fromUserId }, data: { editedById: toUser.id } });
    });
  } catch (err) {
    await storage.deletePrefix(newPrefix.slice(0, -1)); // undo the copies
    throw err;
  }

  // 3. The database now points at the copies; drop the originals.
  await storage.deletePrefix(oldPrefix.slice(0, -1));
  await audit({
    userId: opts.actorId,
    action: "study_set.transfer",
    entityType: "study_set",
    entityId: set.id,
    metadata: { fromUserId, toUserId: toUser.id, fromWorkspaceId: set.workspaceId, toWorkspaceId, filesMoved: keys.length },
  });
  return { studySetId: set.id, fromUserId, toUserId: toUser.id, filesMoved: keys.length };
}
