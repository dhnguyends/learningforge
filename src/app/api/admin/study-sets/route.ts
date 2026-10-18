import { prisma, jsonSafe } from "@/lib/db";
import { apiHandler, ok, requireAdmin } from "@/lib/api";
import { TOPIC_SELECT, toClassification } from "@/lib/taxonomy/store";
import { zaiCredits } from "@/lib/ai/usage";

/** Every study set ("course") with its owner, for administrators (grouped by owner in the UI). */
export const GET = apiHandler(async () => {
  await requireAdmin();
  const sets = await prisma.studySet.findMany({
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      title: true,
      subject: true,
      course: true,
      topic: TOPIC_SELECT,
      createdAt: true,
      updatedAt: true,
      workspace: { select: { owner: { select: { id: true, name: true, email: true, nature: true } } } },
      _count: { select: { sources: true, guides: true, decks: true, quizzes: true, exerciseSets: true } },
      jobs: { where: { status: { in: ["QUEUED", "RUNNING"] } }, select: { id: true } },
    },
  });
  // The AI cost of each course: tokens (Z.ai credits for GLM calls) and Azure characters.
  const usage = await prisma.aiUsage.groupBy({
    by: ["studySetId", "provider"],
    where: { studySetId: { in: sets.map((s) => s.id) } },
    _sum: { inputTokens: true, outputTokens: true, characters: true },
    _count: { _all: true },
  });
  const cost = new Map<string, { calls: number; tokens: number; characters: number; zaiTokens: number }>();
  for (const u of usage) {
    const c = cost.get(u.studySetId!) ?? { calls: 0, tokens: 0, characters: 0, zaiTokens: 0 };
    const tokens = (u._sum.inputTokens ?? 0) + (u._sum.outputTokens ?? 0);
    cost.set(u.studySetId!, {
      calls: c.calls + u._count._all,
      tokens: c.tokens + tokens,
      characters: c.characters + (u._sum.characters ?? 0),
      zaiTokens: c.zaiTokens + (u.provider === "zai" ? tokens : 0),
    });
  }
  return ok(
    jsonSafe({
      studySets: sets.map(({ workspace, jobs, topic, ...s }) => {
        const c = cost.get(s.id);
        return {
          ...s,
          classification: toClassification(topic),
          owner: workspace.owner,
          busy: jobs.length > 0,
          aiCost: { calls: c?.calls ?? 0, tokens: c?.tokens ?? 0, characters: c?.characters ?? 0, zaiCredits: c?.zaiTokens ? zaiCredits(c.zaiTokens) : null },
        };
      }),
    }),
  );
});
