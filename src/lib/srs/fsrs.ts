import type { CardState } from "@prisma/client";
import { clamp } from "@/lib/utils";

export type Grade = 1 | 2 | 3 | 4; // 1=Again 2=Hard 3=Good 4=Easy

export const GRADE_LABELS: Record<Grade, string> = { 1: "Again", 2: "Hard", 3: "Good", 4: "Easy" };

export interface CardSchedulingState {
  state: CardState;
  stability?: number | null;
  difficulty?: number | null;
  reps: number;
  lapses: number;
  lastReviewedAt?: Date | null;
  dueAt: Date;
}

export interface ReviewOutcome {
  state: CardState;
  stability?: number;
  difficulty?: number;
  reps: number;
  lapses: number;
  dueAt: Date;
  /** Interval in days (fractional for same-day learning steps). */
  intervalDays: number;
  /** Predicted recall probability at review time (undefined for new cards). */
  retrievabilityBefore?: number;
}

export interface SpacedRepetitionScheduler {
  readonly name: string;
  review(card: CardSchedulingState, grade: Grade, now?: Date): ReviewOutcome;
  retrievability(card: CardSchedulingState, now?: Date): number | undefined;
  /** Predicted interval (days) for a card at target retention — used in UI previews. */
  previewIntervals(card: CardSchedulingState, now?: Date): Record<Grade, number>;
}

const DAY_MS = 86_400_000;

// --- FSRS 4.5 ---------------------------------------------------------------
// Reference implementation of the FSRS-4.5 scheduler (Tsinghua et al.),
// published default parameters. The scheduler is behind an interface so a
// differently-parameterized or future FSRS version can replace it per deck.

const FSRS_DECAY = -0.5;
const FSRS_FACTOR = 19 / 81;
const DEFAULT_W = [
  0.4872, 1.4003, 3.7145, 13.8206, 5.1618, 1.2298, 0.8975, 0.031, 1.6474, 0.1367, 1.0461, 2.1072, 0.0793,
  0.3246, 1.587, 0.2272, 2.8755,
];
const REQUESTED_RETENTION = 0.9;

export class FSRS45Scheduler implements SpacedRepetitionScheduler {
  readonly name = "fsrs-4.5";
  private w: number[];
  private retention: number;

  constructor(weights: number[] = DEFAULT_W, retention: number = REQUESTED_RETENTION) {
    this.w = weights;
    this.retention = clamp(retention, 0.7, 0.99);
  }

  retrievability(card: CardSchedulingState, now = new Date()): number | undefined {
    if (!card.lastReviewedAt || !card.stability || card.reps === 0) return undefined;
    const elapsedDays = Math.max(0, (now.getTime() - new Date(card.lastReviewedAt).getTime()) / DAY_MS);
    return Math.pow(1 + FSRS_FACTOR * (elapsedDays / card.stability), FSRS_DECAY);
  }

  review(card: CardSchedulingState, grade: Grade, now = new Date()): ReviewOutcome {
    const wasNew = card.state === "NEW" || card.reps === 0;
    const retrievabilityBefore = this.retrievability(card, now) ?? (wasNew ? 0 : 0.9);

    let stability: number;
    let difficulty: number;
    let nextState: CardState;
    let lapses = card.lapses;

    if (wasNew) {
      stability = this.initialStability(grade);
      difficulty = this.initialDifficulty(grade);
      nextState = grade === 1 ? "LEARNING" : grade === 2 ? "LEARNING" : "REVIEW";
      if (grade === 1) lapses += 1;
    } else {
      difficulty = this.nextDifficulty(card.difficulty ?? this.initialDifficulty(3), grade);
      if (grade === 1) {
        // Forget: stability shrinks, card returns to relearning.
        stability = this.stabilityAfterForget(
          card.stability!,
          difficulty,
          retrievabilityBefore,
        );
        stability = Math.min(stability, card.stability!);
        nextState = "RELEARNING";
        lapses += 1;
      } else {
        stability = this.stabilityAfterRecall(
          card.stability!,
          difficulty,
          retrievabilityBefore,
          grade,
        );
        stability = Math.max(stability, card.stability! * 1.01);
        nextState = card.state === "RELEARNING" && grade <= 2 ? "RELEARNING" : "REVIEW";
      }
    }

    const intervalDays = this.intervalFor(stability);
    const isLearningStep = wasNew || nextState === "LEARNING" || grade === 1;
    const dueAt = isLearningStep
      ? new Date(now.getTime() + learningStepMinutes(grade) * 60_000)
      : new Date(now.getTime() + Math.max(1, Math.round(intervalDays)) * DAY_MS);

    return {
      state: nextState,
      stability: round2(stability),
      difficulty: round2(difficulty),
      reps: card.reps + 1,
      lapses,
      dueAt,
      intervalDays: isLearningStep ? learningStepMinutes(grade) / 1440 : Math.max(1, Math.round(intervalDays)),
      retrievabilityBefore: round3(retrievabilityBefore),
    };
  }

  previewIntervals(card: CardSchedulingState, now = new Date()): Record<Grade, number> {
    const out = {} as Record<Grade, number>;
    for (const grade of [1, 2, 3, 4] as Grade[]) {
      out[grade] = this.review(card, grade, now).intervalDays;
    }
    return out;
  }

  /** Interval (days) such that predicted recall equals the requested retention. */
  intervalFor(stability: number): number {
    const days = (stability / FSRS_FACTOR) * (Math.pow(this.retention, 1 / FSRS_DECAY) - 1);
    return clamp(days, 0.007, 365 * 50);
  }

  private initialStability(grade: Grade): number {
    return clamp(this.w[grade - 1], 0.1, 365);
  }

  private initialDifficulty(grade: Grade): number {
    const d = this.w[4] - Math.exp(this.w[5] * (grade - 1)) + 1;
    return clamp(d, 1, 10);
  }

  private nextDifficulty(current: number, grade: Grade): number {
    const delta = -this.w[6] * (grade - 3);
    const reverted = this.w[7] * this.initialDifficulty(4) + (1 - this.w[7]) * (current + delta);
    return clamp(reverted, 1, 10);
  }

  private stabilityAfterRecall(stability: number, difficulty: number, retrievability: number, grade: Grade): number {
    const hardPenalty = grade === 2 ? this.w[14] : 1;
    const easyBonus = grade === 4 ? this.w[15] : 1;
    const inc =
      1 +
      Math.exp(this.w[8]) *
        (11 - difficulty) *
        Math.pow(stability, -this.w[9]) *
        (Math.exp(this.w[10] * (1 - retrievability)) - 1) *
        hardPenalty;
    return clamp(inc * stability * easyBonus, 0.1, 36500);
  }

  private stabilityAfterForget(stability: number, difficulty: number, retrievability: number): number {
    const s =
      this.w[11] *
      Math.pow(difficulty, -this.w[12]) *
      (Math.pow(stability + 1, this.w[13]) - 1) *
      Math.exp(this.w[10] * (1 - retrievability));
    return clamp(s, 0.1, 36500);
  }
}

function learningStepMinutes(grade: Grade): number {
  return grade === 1 ? 10 : grade === 2 ? 30 : 1440; // Again 10m, Hard 30m, Good/Easy graduate
}

// --- SM-2 (classic SuperMemo-2) ---------------------------------------------
// Included to demonstrate the scheduler abstraction; decks default to FSRS.

export class SM2Scheduler implements SpacedRepetitionScheduler {
  readonly name = "sm-2";

  retrievability(card: CardSchedulingState, now = new Date()): number | undefined {
    if (!card.lastReviewedAt || card.reps === 0) return undefined;
    const elapsed = (now.getTime() - new Date(card.lastReviewedAt).getTime()) / DAY_MS;
    const interval = this.priorInterval(card);
    return clamp(Math.exp(-elapsed / Math.max(1, interval)), 0, 1);
  }

  review(card: CardSchedulingState, grade: Grade, now = new Date()): ReviewOutcome {
    if (grade >= 3) {
      // Correct
      const reps = card.reps + 1;
      const interval = reps === 1 ? 1 : reps === 2 ? 6 : Math.round(this.priorInterval(card) * this.ease(card));
      return {
        state: "REVIEW",
        reps,
        lapses: card.lapses,
        dueAt: new Date(now.getTime() + interval * DAY_MS),
        intervalDays: interval,
      };
    }
    // Lapse
    return {
      state: "RELEARNING",
      reps: 0,
      lapses: card.lapses + 1,
      dueAt: new Date(now.getTime() + 10 * 60_000),
      intervalDays: 10 / 1440,
    };
  }

  previewIntervals(card: CardSchedulingState, now = new Date()): Record<Grade, number> {
    const out = {} as Record<Grade, number>;
    for (const grade of [1, 2, 3, 4] as Grade[]) out[grade] = this.review(card, grade, now).intervalDays;
    return out;
  }

  private ease(card: CardSchedulingState): number {
    return clamp(2.5 + 0.1 * (card.reps - 2) - 0.5 * card.lapses + 0.02, 1.3, 2.75);
  }

  private priorInterval(card: CardSchedulingState): number {
    if (!card.lastReviewedAt || card.reps === 0) return 1;
    const due = new Date(card.dueAt).getTime();
    const last = new Date(card.lastReviewedAt).getTime();
    return clamp((due - last) / DAY_MS, 1, 36500);
  }
}

// --- Registry ----------------------------------------------------------------

const SCHEDULERS: Record<string, () => SpacedRepetitionScheduler> = {
  "fsrs-4.5": () => new FSRS45Scheduler(),
  "sm-2": () => new SM2Scheduler(),
};

export function getScheduler(name: string): SpacedRepetitionScheduler {
  const factory = SCHEDULERS[name] ?? SCHEDULERS["fsrs-4.5"];
  return factory();
}

export const DEFAULT_ALGORITHM = "fsrs-4.5";

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}
function round3(v: number): number {
  return Math.round(v * 1000) / 1000;
}
