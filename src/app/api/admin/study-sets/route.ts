import { prisma, jsonSafe } from "@/lib/db";
import { apiHandler, ok, requireAdmin } from "@/lib/api";

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
      createdAt: true,
      updatedAt: true,
      workspace: { select: { owner: { select: { id: true, name: true, email: true, nature: true } } } },
      _count: { select: { sources: true, guides: true, decks: true, quizzes: true, exerciseSets: true } },
      jobs: { where: { status: { in: ["QUEUED", "RUNNING"] } }, select: { id: true } },
    },
  });
  return ok(
    jsonSafe({
      studySets: sets.map(({ workspace, jobs, ...s }) => ({ ...s, owner: workspace.owner, busy: jobs.length > 0 })),
    }),
  );
});
