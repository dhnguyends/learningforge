import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { apiHandler, requireSession } from "@/lib/api";
import { audit } from "@/lib/audit";

/**
 * Data export (GDPR-style): every source-derived artifact the user owns,
 * including citations, as a single JSON download.
 */
export const GET = apiHandler(async (req: NextRequest) => {
  const session = await requireSession();

  const [user, workspaces, studySets, attempts, reviews] = await Promise.all([
    prisma.user.findUnique({ where: { id: session.user.id }, select: { id: true, email: true, name: true, createdAt: true } }),
    prisma.workspaceMember.findMany({ where: { userId: session.user.id }, include: { workspace: { select: { id: true, name: true } } } }),
    prisma.studySet.findMany({
      where: { workspace: { members: { some: { userId: session.user.id } } } },
      include: {
        sources: {
          include: {
            transcripts: { include: { segments: true } },
            chunks: { select: { id: true, ordinal: true, kind: true, content: true, page: true, startMs: true, endMs: true } },
          },
        },
        guides: { include: { sections: { include: { anchors: true } } } },
        decks: { include: { cards: { include: { anchors: true } } } },
        quizzes: { include: { questions: { include: { anchors: true } } } },
        exerciseSets: { include: { exercises: { include: { anchors: true } } } },
        conversations: { include: { messages: { include: { anchors: true } } } },
      },
    }),
    prisma.attempt.findMany({ where: { userId: session.user.id } }),
    prisma.flashcardReview.findMany({ where: { userId: session.user.id } }),
  ]);

  await audit({ userId: session.user.id, action: "account.export" });

  const payload = {
    exportedAt: new Date().toISOString(),
    product: "LearningForge",
    user,
    workspaces: workspaces.map((w) => w.workspace),
    studySets,
    attempts,
    flashcardReviews: reviews,
  };

  return new Response(JSON.stringify(payload, null, 2), {
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="learningforge-export-${new Date().toISOString().slice(0, 10)}.json"`,
    },
  });
});
