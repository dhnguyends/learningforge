import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { apiHandler, forbidden, ok, requireSession } from "@/lib/api";
import { listUserWorkspaceIds } from "@/lib/access";
import { loadTaxonomyNodes } from "@/lib/taxonomy/store";

/**
 * The course tree (Discipline › Subject › Course / Module › Topic) with the
 * courses filed in it, for Explore and the topic picker.
 *
 *   ?scope=mine (default)  the caller's own courses
 *   ?scope=all             every course with its owner — administrators only
 *
 * Nodes come flat (parentId, siblings in file order); the client builds the
 * tree and the per-branch counts. Courses without a topic are listed too
 * (topicId null) so Explore can offer to classify them. relatedTopicIds are
 * the course's related ("connexe") topics, shown under those topics too.
 */
export const GET = apiHandler(async (req) => {
  const session = await requireSession();
  const scope = new URL(req.url).searchParams.get("scope") === "all" ? "all" : "mine";
  if (scope === "all" && session.user.role !== "ADMIN") throw forbidden();

  const where: Prisma.StudySetWhereInput =
    scope === "all" ? { archivedAt: null } : { archivedAt: null, workspaceId: { in: await listUserWorkspaceIds(session.user.id) } };
  const [nodes, sets] = await Promise.all([
    loadTaxonomyNodes(),
    prisma.studySet.findMany({
      where,
      orderBy: { title: "asc" },
      select: {
        id: true,
        title: true,
        topicId: true,
        relatedTopics: { orderBy: { position: "asc" }, select: { topicId: true } },
        workspace: { select: { owner: { select: { id: true, name: true, email: true, nature: true } } } },
      },
    }),
  ]);

  return ok({
    scope,
    nodes,
    courses: sets.map(({ workspace, relatedTopics, ...s }) => ({
      ...s,
      relatedTopicIds: relatedTopics.map((r) => r.topicId),
      ...(scope === "all" ? { owner: workspace.owner } : {}),
    })),
  });
});
