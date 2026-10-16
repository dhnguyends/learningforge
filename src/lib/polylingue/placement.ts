import { z } from "zod";
import { CEFR_LEVELS, type Cefr } from "@/lib/polylingue/levels";

/**
 * Placement test: a bank of multiple-choice questions per CEFR level (some
 * with audio), and an adaptive staircase that walks up and down the levels.
 * It only SUGGESTS a level: the learner decides, and the course stays at the
 * level they choose. Pure (shared by the server and the browser).
 */

export const PER_LEVEL = 4;
export const MAX_QUESTIONS = 12;
const START = 1; // A2

export const placementSchema = z.object({
  items: z
    .array(
      z.object({
        level: z.enum(CEFR_LEVELS),
        question: z.string().min(1).max(500),
        /** Target-language text read aloud for listening questions ("" otherwise). */
        audio: z.string().max(400),
        options: z.array(z.string().min(1).max(200)).min(3).max(4),
        answer: z.string().min(1).max(200),
        explanation: z.string().max(300),
      }),
    )
    .min(CEFR_LEVELS.length * 3)
    .max(CEFR_LEVELS.length * 6),
});
export type PlacementItem = z.infer<typeof placementSchema>["items"][number];

/** Keeps playable items (answer among the options) and at most PER_LEVEL per level. */
export function normalizeBank(items: PlacementItem[]): PlacementItem[] {
  const out: PlacementItem[] = [];
  for (const level of CEFR_LEVELS) {
    const ok = items
      .filter((i) => i.level === level)
      .map((i) => {
        const options = [...new Set(i.options.map((o) => o.trim()))];
        if (!options.includes(i.answer.trim())) options.unshift(i.answer.trim());
        return { ...i, answer: i.answer.trim(), options: options.slice(0, 4) };
      })
      .filter((i) => i.options.length >= 3)
      .slice(0, PER_LEVEL);
    out.push(...ok);
  }
  for (const level of CEFR_LEVELS) {
    if (out.filter((i) => i.level === level).length < 2) throw new Error(`Not enough placement questions for ${level}`);
  }
  return out;
}

export interface PlacementAnswer {
  id: number;
  level: Cefr;
  correct: boolean;
}

export interface PlacementState {
  levelIndex: number;
  answers: PlacementAnswer[];
  done: boolean;
}

export const initialPlacement = (): PlacementState => ({ levelIndex: START, answers: [], done: false });

/** Next question to ask at the current level, or null when the test is over. */
export function nextQuestion(state: PlacementState, bank: { level: Cefr }[]): number | null {
  if (state.done) return null;
  const level = CEFR_LEVELS[state.levelIndex];
  const asked = new Set(state.answers.map((a) => a.id));
  const id = bank.findIndex((q, i) => q.level === level && !asked.has(i));
  return id >= 0 ? id : null;
}

/**
 * Staircase: two right answers in a row at a level → one level up; two wrong
 * → one level down; stop after MAX_QUESTIONS, when the level runs out of
 * questions, at the ends of the scale, or once it goes back down to a level
 * it already climbed from (the learner's ceiling is found).
 */
export function recordAnswer(state: PlacementState, answer: PlacementAnswer, bank: { level: Cefr }[]): PlacementState {
  const answers = [...state.answers, answer];
  const atLevel = answers.filter((a) => a.level === CEFR_LEVELS[state.levelIndex]);
  const lastTwo = atLevel.slice(-2);
  let levelIndex = state.levelIndex;
  let done = answers.length >= MAX_QUESTIONS;
  if (lastTwo.length === 2 && lastTwo.every((a) => a.correct)) {
    if (levelIndex === CEFR_LEVELS.length - 1) done = true;
    else levelIndex++;
  } else if (lastTwo.length === 2 && lastTwo.every((a) => !a.correct)) {
    const climbedFromBelow = answers.some((a) => CEFR_LEVELS.indexOf(a.level) === levelIndex - 1 && a.correct);
    if (levelIndex === 0 || climbedFromBelow) done = true;
    else levelIndex--;
  }
  const next: PlacementState = { levelIndex, answers, done };
  if (!done && nextQuestion(next, bank) === null) next.done = true;
  return next;
}

/** Suggested level: the highest level answered at least 60 % right (A1 otherwise). */
export function suggestedLevel(answers: PlacementAnswer[]): Cefr {
  let best: Cefr = "A1";
  for (const level of CEFR_LEVELS) {
    const at = answers.filter((a) => a.level === level);
    if (at.length >= 2 && at.filter((a) => a.correct).length / at.length >= 0.6) best = level;
  }
  return best;
}

/** Questions as the browser sees them (no answers or explanations). */
export function bankForPlayer(items: PlacementItem[]) {
  return items.map((i) => ({ level: i.level as Cefr, question: i.question, audio: i.audio, options: i.options }));
}
export type PlayerPlacementItem = ReturnType<typeof bankForPlayer>[number];
