import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { badRequest } from "@/lib/api";
import { TOPIC_SELECT, toClassification, type Classification } from "@/lib/taxonomy/store";

/**
 * Related ("connexe") topics: besides its one main topic (StudySet.topicId,
 * set by administrators), a course can be linked to up to MAX_RELATED other
 * topics, by its owner or an administrator. Topics only (level 4), each at
 * most once, never the main topic. Deleting a topic node removes its links.
 */
export const MAX_RELATED = 3;

/** Prisma `include`/`select` part for a study set's related topics, in the order they were added. */
export const RELATED_SELECT = {
  orderBy: { position: "asc" },
  select: { topic: TOPIC_SELECT },
} satisfies Prisma.StudySet$relatedTopicsArgs;

type RelatedRow = Prisma.StudySetRelatedTopicGetPayload<typeof RELATED_SELECT>;

export function toRelated(rows: RelatedRow[] | undefined): Classification[] {
  return (rows ?? []).map((r) => toClassification(r.topic)).filter((c): c is Classification => c !== null);
}

/** Replaces a course's related topics with `topicIds` (in that order), after checking every rule. */
export async function setRelatedTopics(studySetId: string, topicIds: string[]): Promise<{ before: string[]; after: string[] }> {
  if (topicIds.length > MAX_RELATED) throw badRequest(`A course has at most ${MAX_RELATED} related topics`);
  if (new Set(topicIds).size !== topicIds.length) throw badRequest("The same related topic is listed twice");

  return prisma.$transaction(async (tx) => {
    const set = await tx.studySet.findUniqueOrThrow({
      where: { id: studySetId },
      select: { topicId: true, relatedTopics: { orderBy: { position: "asc" }, select: { topicId: true } } },
    });
    if (set.topicId && topicIds.includes(set.topicId)) throw badRequest("The course's main topic cannot also be a related topic");
    const nodes = await tx.taxonomyNode.findMany({ where: { id: { in: topicIds } }, select: { id: true, level: true, name: true } });
    for (const id of topicIds) {
      const node = nodes.find((n) => n.id === id);
      if (!node) throw badRequest("Unknown topic");
      if (node.level !== 4) throw badRequest(`"${node.name}" is not a topic: choose a topic (level 4) of the course tree`);
    }
    await tx.studySetRelatedTopic.deleteMany({ where: { studySetId } });
    if (topicIds.length > 0) {
      await tx.studySetRelatedTopic.createMany({ data: topicIds.map((topicId, position) => ({ studySetId, topicId, position })) });
    }
    return { before: set.relatedTopics.map((r) => r.topicId), after: topicIds };
  });
}
