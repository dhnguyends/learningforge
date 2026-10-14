import type { QuizQuestion } from "@prisma/client";
import { prisma } from "@/lib/db";
import { clamp } from "@/lib/utils";

/** Server-authoritative grading for every quiz question type. */

export interface QuizResponse {
  selectedIds?: string[];
  text?: string;
  numeric?: number;
  order?: string[];
  pairs?: Record<string, string>;
}

export interface GradeResult {
  score: number; // 0..1
  correct: boolean;
  expected: string;
  feedback: string;
}

export function gradeQuestion(question: QuizQuestion, response: QuizResponse): GradeResult {
  const answer = question.answer as {
    correctIds?: string[];
    text?: string[];
    numeric?: { value: number; tolerance?: number; unit?: string };
    order?: string[];
    pairs?: Array<{ optionId: string; value: string }>;
  };

  switch (question.type) {
    case "MULTIPLE_CHOICE": {
      const correct = answer.correctIds ?? [];
      const ok = correct.length === 1 && response.selectedIds?.[0] === correct[0];
      return {
        score: ok ? 1 : 0,
        correct: ok,
        expected: optionText(question, correct[0]),
        feedback: ok ? "Correct." : `The correct answer is: ${optionText(question, correct[0])}. ${question.explanation ?? ""}`.trim(),
      };
    }
    case "MULTI_SELECT": {
      const correct = new Set(answer.correctIds ?? []);
      const selected = new Set(response.selectedIds ?? []);
      let hits = 0;
      let wrong = 0;
      for (const id of selected) (correct.has(id) ? hits++ : wrong++);
      const missed = [...correct].filter((id) => !selected.has(id)).length;
      const score = correct.size ? clamp((hits - wrong) / correct.size, 0, 1) : 0;
      return {
        score,
        correct: score === 1,
        expected: (answer.correctIds ?? []).map((id) => optionText(question, id)).join("; "),
        feedback:
          score === 1
            ? "Correct — all and only the right options."
            : `${hits} of ${correct.size} correct options selected${wrong ? `, ${wrong} wrong` : ""}${missed ? `, missed ${missed}` : ""}. ${question.explanation ?? ""}`.trim(),
      };
    }
    case "SHORT_ANSWER":
    case "CODE_TRACING": {
      const acceptable = answer.text ?? [];
      const given = normalizeText(response.text ?? "");
      const ok = acceptable.some((a) => {
        const target = normalizeText(a);
        return given === target || (target.length > 8 && given.includes(target));
      });
      return {
        score: ok ? 1 : 0,
        correct: ok,
        expected: acceptable[0] ?? "(ungraded)",
        feedback: ok ? "Accepted." : `Expected an answer equivalent to: "${acceptable[0] ?? "(none defined)"}". ${question.explanation ?? ""}`.trim(),
      };
    }
    case "NUMERICAL": {
      const target = answer.numeric;
      if (!target || response.numeric == null) {
        return { score: 0, correct: false, expected: formatNumeric(target), feedback: `No numeric answer received. Expected ${formatNumeric(target)}.` };
      }
      const tolerance = target.tolerance ?? Math.max(1e-6, Math.abs(target.value) * 0.02);
      const ok = Math.abs(response.numeric - target.value) <= tolerance;
      return {
        score: ok ? 1 : 0,
        correct: ok,
        expected: formatNumeric(target),
        feedback: ok
          ? `Correct (${response.numeric}${target.unit ? ` ${target.unit}` : ""}).`
          : `You answered ${response.numeric}; expected ${formatNumeric(target)} (±${tolerance}). ${question.explanation ?? ""}`.trim(),
      };
    }
    case "ORDERING":
    case "DERIVATION_STEPS": {
      const expected = answer.order ?? [];
      const given = response.order ?? [];
      const posCorrect = expected.filter((id, i) => given[i] === id).length;
      const score = expected.length ? posCorrect / expected.length : 0;
      return {
        score,
        correct: score === 1,
        expected: expected.map((id) => optionText(question, id)).join(" → "),
        feedback: `${posCorrect}/${expected.length} steps in the right position. ${question.explanation ?? ""}`.trim(),
      };
    }
    case "MATCHING": {
      const pairs = answer.pairs ?? [];
      const given = response.pairs ?? {};
      const right = pairs.filter((p) => given[p.optionId] === p.value).length;
      const score = pairs.length ? right / pairs.length : 0;
      return {
        score,
        correct: score === 1,
        expected: pairs.map((p) => `${optionText(question, p.optionId)} ↔ ${p.value}`).join("; "),
        feedback: `${right}/${pairs.length} pairs matched. ${question.explanation ?? ""}`.trim(),
      };
    }
    default:
      return { score: 0, correct: false, expected: "(ungradable)", feedback: "This question type has no grader." };
  }
}

function optionText(question: QuizQuestion, id?: string): string {
  const options = (question.options as Array<{ id: string; text: string }> | null) ?? [];
  return options.find((o) => o.id === id)?.text ?? id ?? "(unknown)";
}

function formatNumeric(target?: { value: number; tolerance?: number; unit?: string }): string {
  if (!target) return "(none)";
  return `${target.value}${target.unit ? ` ${target.unit}` : ""}`;
}

function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .replace(/\\left|\\right|\\,|\\;|\\!/g, "")
    .replace(/\s*([=+\-*/^_{}()])\s*/g, "$1")
    .replace(/[.,;:!?]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// --- Progress & adaptive difficulty ---------------------------------------------

export async function recordAttemptAndProgress(opts: {
  userId: string;
  studySetId: string;
  subjectType: "QUIZ_QUESTION" | "EXERCISE" | "FLASHCARD";
  subjectId: string;
  topic: string;
  score: number;
  response: unknown;
  feedback?: unknown;
  durationMs?: number;
}): Promise<void> {
  await prisma.attempt.create({
    data: {
      userId: opts.userId,
      studySetId: opts.studySetId,
      subjectType: opts.subjectType,
      subjectId: opts.subjectId,
      response: (opts.response ?? {}) as object,
      score: opts.score,
      feedback: (opts.feedback ?? undefined) as object | undefined,
      durationMs: opts.durationMs,
    },
  });

  const metric = await prisma.progressMetric.findUnique({
    where: { userId_studySetId_topic: { userId: opts.userId, studySetId: opts.studySetId, topic: opts.topic } },
  });
  const alpha = 0.3; // EWMA responsiveness
  const mastery = metric ? metric.mastery * (1 - alpha) + opts.score * alpha : opts.score;
  await prisma.progressMetric.upsert({
    where: { userId_studySetId_topic: { userId: opts.userId, studySetId: opts.studySetId, topic: opts.topic } },
    update: { mastery, attempts: { increment: 1 }, correct: { increment: opts.score >= 0.5 ? 1 : 0 }, lastActivityAt: new Date() },
    create: {
      userId: opts.userId,
      studySetId: opts.studySetId,
      topic: opts.topic,
      mastery,
      attempts: 1,
      correct: opts.score >= 0.5 ? 1 : 0,
    },
  });
}

/** Adapt quiz difficulty from mastery metrics (transparent to the learner). */
export function recommendDifficulty(topics: Array<{ topic: string; mastery: number; attempts: number }>): {
  difficulty: "easy" | "medium" | "hard" | "advanced";
  reason: string;
} {
  const studied = topics.filter((t) => t.attempts > 0);
  if (studied.length === 0) return { difficulty: "medium", reason: "Starting at medium difficulty — no attempt history yet." };
  const avg = studied.reduce((s, t) => s + t.mastery, 0) / studied.length;
  if (avg >= 0.85) return { difficulty: "advanced", reason: `Your average mastery is ${(avg * 100).toFixed(0)}% — stepping up to advanced.` };
  if (avg >= 0.7) return { difficulty: "hard", reason: `Average mastery ${(avg * 100).toFixed(0)}% — ready for hard questions.` };
  if (avg >= 0.4) return { difficulty: "medium", reason: `Average mastery ${(avg * 100).toFixed(0)}% — consolidating with medium difficulty.` };
  return { difficulty: "easy", reason: `Average mastery ${(avg * 100).toFixed(0)}% — rebuilding fundamentals with easier questions first.` };
}
