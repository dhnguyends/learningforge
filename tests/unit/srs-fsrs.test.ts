import { describe, it, expect } from "vitest";
import { FSRS45Scheduler, SM2Scheduler, getScheduler, DEFAULT_ALGORITHM, type CardSchedulingState, type Grade } from "@/lib/srs/fsrs";

const DAY_MS = 86_400_000;

function newCard(): CardSchedulingState {
  return { state: "NEW", stability: null, difficulty: null, reps: 0, lapses: 0, lastReviewedAt: null, dueAt: new Date() };
}

function reviewCard(stability: number, daysAgoReviewed: number, intervalDays = 10): CardSchedulingState {
  const last = new Date(Date.now() - daysAgoReviewed * DAY_MS);
  return {
    state: "REVIEW",
    stability,
    difficulty: 5,
    reps: 4,
    lapses: 0,
    lastReviewedAt: last,
    dueAt: new Date(last.getTime() + intervalDays * DAY_MS),
  };
}

describe("FSRS45Scheduler", () => {
  it("returns undefined retrievability for new cards and decaying values for reviewed ones", () => {
    const s = new FSRS45Scheduler();
    expect(s.retrievability(newCard())).toBeUndefined();

    const fresh = s.retrievability(reviewCard(10, 0));
    const old = s.retrievability(reviewCard(10, 10));
    expect(fresh).toBeGreaterThan(0.89); // just reviewed → ~target retention
    expect(old).toBeLessThan(fresh!);
    expect(old).toBeGreaterThan(0);
    expect(old).toBeLessThanOrEqual(1);
  });

  it("keeps retrievability higher for more stable cards at equal elapsed time", () => {
    const s = new FSRS45Scheduler();
    const weak = s.retrievability(reviewCard(2, 5));
    const strong = s.retrievability(reviewCard(30, 5));
    expect(strong!).toBeGreaterThan(weak!);
  });

  it("graduates a new card on Good: REVIEW state, ≥1 day interval, reps incremented", () => {
    const s = new FSRS45Scheduler();
    const out = s.review(newCard(), 3);
    expect(out.state).toBe("REVIEW");
    expect(out.reps).toBe(1);
    expect(out.lapses).toBe(0);
    expect(out.stability).toBeGreaterThan(0);
    expect(out.intervalDays).toBeGreaterThanOrEqual(1);
    expect(out.dueAt.getTime()).toBeGreaterThan(Date.now());
  });

  it("sends a new Again card to a short learning step and counts the lapse", () => {
    const s = new FSRS45Scheduler();
    const out = s.review(newCard(), 1);
    expect(out.state).toBe("LEARNING");
    expect(out.lapses).toBe(1);
    // Learning steps are minutes, not days.
    expect(out.dueAt.getTime()).toBeLessThan(Date.now() + 60 * 60_000);
    expect(out.intervalDays).toBeLessThan(1);
  });

  it("initial stability and interval grow monotonically with grade on a new card", () => {
    const s = new FSRS45Scheduler();
    const stabs = ([1, 2, 3, 4] as Grade[]).map((g) => s.review(newCard(), g).stability!);
    for (let i = 1; i < stabs.length; i++) expect(stabs[i]).toBeGreaterThan(stabs[i - 1]);
  });

  it("stability grows over successive successful reviews and intervals follow", () => {
    const s = new FSRS45Scheduler();
    let card = newCard();
    let prevStability = 0;
    let prevInterval = 0;
    for (let i = 0; i < 6; i++) {
      const out = s.review(card, 3);
      expect(out.stability).toBeGreaterThan(prevStability);
      expect(out.intervalDays).toBeGreaterThanOrEqual(prevInterval);
      prevStability = out.stability ?? 0;
      prevInterval = out.intervalDays ?? 0;
      card = {
        state: out.state,
        stability: out.stability,
        difficulty: out.difficulty,
        reps: out.reps,
        lapses: out.lapses,
        lastReviewedAt: new Date(),
        dueAt: out.dueAt,
      };
    }
  });

  it("a lapse shrinks stability and relearns", () => {
    const s = new FSRS45Scheduler();
    const card = reviewCard(20, 3);
    const out = s.review(card, 1);
    expect(out.state).toBe("RELEARNING");
    expect(out.lapses).toBe(card.lapses + 1);
    expect(out.stability!).toBeLessThanOrEqual(card.stability!);
    expect(out.dueAt.getTime()).toBeLessThan(Date.now() + 60 * 60_000);
  });

  it("successful review never decreases stability", () => {
    const s = new FSRS45Scheduler();
    for (const grade of [2, 3, 4] as Grade[]) {
      const card = reviewCard(15, 5);
      const out = s.review(card, grade);
      expect(out.stability!).toBeGreaterThan(card.stability!);
      expect(out.state).toBe("REVIEW");
    }
  });

  it("reports retrievabilityBefore for a reviewed card", () => {
    const s = new FSRS45Scheduler();
    const out = s.review(reviewCard(10, 5), 3);
    expect(out.retrievabilityBefore).toBeGreaterThan(0);
    expect(out.retrievabilityBefore!).toBeLessThan(1);
  });

  it("previewIntervals covers all four grades", () => {
    const s = new FSRS45Scheduler();
    const preview = s.previewIntervals(reviewCard(10, 2));
    expect(Object.keys(preview).sort()).toEqual(["1", "2", "3", "4"]);
    // Easy should not schedule sooner than Again.
    expect(preview[4]).toBeGreaterThanOrEqual(preview[1]);
  });

  it("intervalFor respects the requested retention target", () => {
    const s = new FSRS45Scheduler();
    const days = s.intervalFor(10);
    expect(days).toBeGreaterThan(0);
    // At the computed interval, predicted recall should be ≈ 0.9.
    const recall = s.retrievability({ ...reviewCard(10, 0), stability: 10, dueAt: new Date(Date.now() + days * DAY_MS) }, new Date(Date.now() + days * DAY_MS));
    expect(recall!).toBeGreaterThan(0.85);
    expect(recall!).toBeLessThanOrEqual(0.92);
  });
});

describe("SM2Scheduler", () => {
  it("follows the classic 1/6/expanding ladder on success", () => {
    const s = new SM2Scheduler();
    let card = newCard();
    const intervals: number[] = [];
    for (let i = 0; i < 3; i++) {
      const out = s.review(card, 4);
      intervals.push(out.intervalDays);
      card = { state: out.state, stability: out.stability, difficulty: out.difficulty, reps: out.reps, lapses: out.lapses, lastReviewedAt: new Date(), dueAt: out.dueAt };
    }
    expect(intervals[0]).toBe(1);
    expect(intervals[1]).toBe(6);
    expect(intervals[2]).toBeGreaterThan(6);
  });

  it("resets reps and relearns after a lapse", () => {
    const s = new SM2Scheduler();
    const out = s.review(reviewCard(10, 3), 1);
    expect(out.state).toBe("RELEARNING");
    expect(out.reps).toBe(0);
    expect(out.lapses).toBe(1);
  });
});

describe("scheduler registry", () => {
  it("resolves known algorithms and falls back to the default", () => {
    expect(getScheduler("fsrs-4.5").name).toBe("fsrs-4.5");
    expect(getScheduler("sm-2").name).toBe("sm-2");
    expect(getScheduler("nonsense").name).toBe(DEFAULT_ALGORITHM);
  });
});
