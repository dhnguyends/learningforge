import { z } from "zod";
import { prisma, jsonSafe } from "@/lib/db";
import { apiHandler, ok, parseJsonBody, requireSession, notFound } from "@/lib/api";
import { assertStudySetAccess } from "@/lib/access";
import { recordAttemptAndProgress } from "@/lib/pipelines/grading";
import { gradeExerciseAttempt } from "@/lib/pipelines/exercise-feedback";

type Ctx = { params: { exerciseId: string } };

const attemptSchema = z.object({
  submission: z.string().min(10).max(20_000),
  durationMs: z.number().int().nonnegative().optional(),
});

/** Submit work (text / equations / code) and receive structured feedback. */
export const POST = apiHandler<Ctx>(async (req, { params }) => {
  const session = await requireSession();
  const exercise = await prisma.exercise.findUnique({
    where: { id: params.exerciseId },
    include: { exerciseSet: true, anchors: true },
  });
  if (!exercise) throw notFound("Exercise");
  await assertStudySetAccess(session.user.id, exercise.exerciseSet.studySetId, "write");

  const body = await parseJsonBody(req, attemptSchema);
  const feedback = await gradeExerciseAttempt({
    studySetId: exercise.exerciseSet.studySetId,
    exercise: {
      title: exercise.title,
      prompt: exercise.prompt,
      expectedOutput: exercise.expectedOutput,
      solution: exercise.solution ?? "(no stored solution)",
      grounded: exercise.grounded,
      rubric: exercise.rubric,
      anchors: exercise.anchors,
    },
    submission: body.submission,
  });

  await recordAttemptAndProgress({
    userId: session.user.id,
    studySetId: exercise.exerciseSet.studySetId,
    subjectType: "EXERCISE",
    subjectId: exercise.id,
    topic: exercise.title,
    score: feedback.score,
    response: { submission: body.submission.slice(0, 4000) },
    feedback,
    durationMs: body.durationMs,
  });

  return ok(jsonSafe({ feedback }));
});
