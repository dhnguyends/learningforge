import { getGenerator } from "@/lib/ai";
import { z } from "zod";
import { searchChunks, formatRetrievedContext } from "@/lib/retrieval";

const feedbackSchema = z.object({
  score: z.number().min(0).max(1),
  summary: z.string().min(10),
  criteria: z.array(z.object({ description: z.string(), passed: z.boolean(), comment: z.string() })).default([]),
  nextStep: z.string(),
});

export type ExerciseFeedback = z.infer<typeof feedbackSchema>;

/**
 * Feedback on a submitted exercise attempt (text/equations/code).
 * Graded against the exercise's stated expected output and cited sources.
 */
export async function gradeExerciseAttempt(opts: {
  studySetId: string;
  exercise: {
    title: string;
    prompt: string;
    expectedOutput?: string | null;
    solution: string;
    rubric?: unknown;
    grounded: boolean;
    anchors: Array<{ excerpt: string }>;
  };
  submission: string;
}): Promise<ExerciseFeedback> {
  const chunks = await searchChunks(opts.studySetId, opts.exercise.title, { k: 5 });
  return (
    await (await getGenerator()).generate({
      system: `You are LearningForge's exercise grader. Grade the learner's submission against the exercise requirements. Be specific about what is right, what is wrong, and the single most valuable next step. Do not reveal the full solution unless the submission is essentially complete; point at what to fix instead. Verify any arithmetic the learner shows.`,
      user: `EXERCISE: ${opts.exercise.title}\nREQUIREMENTS: ${opts.exercise.prompt}\n${
        opts.exercise.expectedOutput ? `EXPECTED OUTPUT: ${opts.exercise.expectedOutput}\n` : ""
      }SOURCE EXCERPTS:\n${opts.exercise.anchors.map((a) => `- ${a.excerpt}`).join("\n")}\n\nLEARNER SUBMISSION:\n${opts.submission.slice(0, 8000)}\n\nREFERENCE SOLUTION (for grading only, do not quote verbatim):\n${opts.exercise.solution.slice(0, 4000)}\n\nRETRIEVED CONTEXT:\n${formatRetrievedContext(chunks)}`,
      schema: feedbackSchema,
      mock: () => mockFeedback(opts.submission, opts.exercise.grounded),
    })
  ).data;
}

function mockFeedback(submission: string, grounded: boolean): ExerciseFeedback {
  const words = submission.split(/\s+/).filter(Boolean).length;
  const substantive = words >= 40;
  return {
    score: substantive ? 0.7 : 0.25,
    summary: substantive
      ? "Reasonable submission in offline mock mode — structure and reasoning present."
      : "The submission is too short to demonstrate the required reasoning. Expand each step explicitly.",
    criteria: [
      { description: "States assumptions", passed: /assum|given|suppose/i.test(submission), comment: "Look for explicit assumption statements." },
      { description: "Shows step-by-step work", passed: words >= 80, comment: "Each step should be justified." },
      { description: grounded ? "Stays consistent with the source" : "Transfers the concept correctly", passed: substantive, comment: "Compare against the cited source excerpt." },
    ],
    nextStep: "Re-check the step you are least sure about, then compare with the cited source passage.",
  };
}
