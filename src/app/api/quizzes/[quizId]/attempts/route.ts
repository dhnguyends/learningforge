import { z } from "zod";
import { prisma, jsonSafe } from "@/lib/db";
import { apiHandler, ok, parseJsonBody, requireSession, notFound } from "@/lib/api";
import { assertStudySetAccess } from "@/lib/access";
import { gradeQuestion, recordAttemptAndProgress } from "@/lib/pipelines/grading";

type Ctx = { params: { quizId: string } };

const attemptSchema = z.object({
  answers: z
    .array(
      z.object({
        questionId: z.string(),
        selectedIds: z.array(z.string()).optional(),
        text: z.string().max(4000).optional(),
        numeric: z.number().optional(),
        order: z.array(z.string()).optional(),
        pairs: z.record(z.string()).optional(),
        skipped: z.boolean().optional(),
      }),
    )
    .min(1),
  durationMs: z.number().int().nonnegative().optional(),
});

/** Submit an attempt: server-side grading, then answers + explanations release. */
export const POST = apiHandler<Ctx>(async (req, { params }) => {
  const session = await requireSession();
  const quiz = await prisma.quiz.findUnique({ where: { id: params.quizId }, include: { questions: true } });
  if (!quiz) throw notFound("Quiz");
  await assertStudySetAccess(session.user.id, quiz.studySetId, "write");

  const body = await parseJsonBody(req, attemptSchema);
  const results = [];
  let totalScore = 0;

  for (const question of quiz.questions) {
    const answer = body.answers.find((a) => a.questionId === question.id);
    const response = answer?.skipped
      ? {}
      : {
          selectedIds: answer?.selectedIds,
          text: answer?.text,
          numeric: answer?.numeric,
          order: answer?.order,
          pairs: answer?.pairs,
        };
    const grade = gradeQuestion(question, response);
    totalScore += grade.score;

    await recordAttemptAndProgress({
      userId: session.user.id,
      studySetId: quiz.studySetId,
      subjectType: "QUIZ_QUESTION",
      subjectId: question.id,
      topic: question.learningObjective,
      score: grade.score,
      response,
      feedback: { expected: grade.expected, feedback: grade.feedback },
      durationMs: Math.round((body.durationMs ?? 0) / quiz.questions.length),
    });

    results.push({
      questionId: question.id,
      ...grade,
      correctAnswer: question.answer,
      explanation: question.explanation,
      distractorRationale: question.distractorRationale,
      options: question.options,
    });
  }

  const score = quiz.questions.length ? totalScore / quiz.questions.length : 0;

  // Weak topics for regeneration suggestions.
  const weakTopics = [...new Set(results.filter((r) => r.score < 0.5).map((r) => quiz.questions.find((q) => q.id === r.questionId)?.learningObjective))].filter(
    (t): t is string => Boolean(t),
  );

  return ok(jsonSafe({ score: Math.round(score * 1000) / 1000, results, weakTopics }));
});
