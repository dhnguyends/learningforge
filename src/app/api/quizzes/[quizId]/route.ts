import { prisma, jsonSafe } from "@/lib/db";
import { apiHandler, ok, requireSession, notFound } from "@/lib/api";
import { assertStudySetAccess } from "@/lib/access";

type Ctx = { params: { quizId: string } };

/**
 * Quiz questions WITHOUT answers/explanations — answers are only released
 * after an attempt is graded server-side (never exposed pre-attempt).
 */
export const GET = apiHandler<Ctx>(async (_req, { params }) => {
  const session = await requireSession();
  const quiz = await prisma.quiz.findUnique({
    where: { id: params.quizId },
    include: {
      questions: {
        orderBy: { ordinal: "asc" },
        include: { anchors: { include: { source: { select: { id: true, title: true, type: true } } } } },
      },
    },
  });
  if (!quiz) throw notFound("Quiz");
  await assertStudySetAccess(session.user.id, quiz.studySetId);

  return ok(
    jsonSafe({
      quiz: {
        id: quiz.id,
        title: quiz.title,
        status: quiz.status,
        config: quiz.config,
        questions: quiz.questions.map((q) => {
          // Matching needs the right-hand column to be renderable. The values are
          // inherent to the display (both columns are visible) — but their stored
          // order equals the correct pairing, so shuffle before exposing.
          const answer = q.answer as { pairs?: Array<{ optionId: string; value: string }> } | null;
          const matchValues =
            q.type === "MATCHING" && answer?.pairs?.length
              ? shuffle(answer.pairs.map((p) => p.value))
              : undefined;
          return {
            id: q.id,
            ordinal: q.ordinal,
            type: q.type,
            stem: q.stem,
            options: q.options,
            matchValues,
            learningObjective: q.learningObjective,
            difficulty: q.difficulty,
            warnings: q.warnings,
            anchors: q.anchors,
          };
        }),
      },
    }),
  );
});

function shuffle<T>(arr: T[]): T[] {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
