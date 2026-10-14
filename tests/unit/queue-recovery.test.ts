import { describe, expect, it } from "vitest";
import { planRecovery, type RecoveryJobRow } from "@/lib/queue/recovery";

const base: RecoveryJobRow = {
  id: "job1",
  studySetId: "set1",
  type: "GENERATE_GUIDE",
  status: "QUEUED",
  attempts: 0,
  maxAttempts: 3,
  payload: { guideId: "g1" },
};

describe("planRecovery", () => {
  it("re-enqueues a QUEUED orphan, bumping attempts", () => {
    const plan = planRecovery(base);
    expect(plan).toMatchObject({ action: "reenqueue", id: "job1", name: "generate.guide", attempts: 1 });
  });

  it("merges the studySetId column into the payload (generation payloads lack it)", () => {
    const plan = planRecovery(base);
    if (plan.action !== "reenqueue") throw new Error("expected reenqueue");
    expect(plan.payload).toEqual({ guideId: "g1", studySetId: "set1" });
  });

  it("keeps ingest payloads as-is when there is no studySetId column value", () => {
    const plan = planRecovery({ ...base, type: "INGEST_SOURCE", studySetId: null, payload: { sourceId: "s1" } });
    if (plan.action !== "reenqueue") throw new Error("expected reenqueue");
    expect(plan).toMatchObject({ name: "ingest.source" });
    expect(plan.payload).toEqual({ sourceId: "s1" });
  });

  it("maps every job type to its queue name", () => {
    const types: Record<string, string> = {
      INGEST_SOURCE: "ingest.source",
      GENERATE_GUIDE: "generate.guide",
      GENERATE_FLASHCARDS: "generate.flashcards",
      GENERATE_QUIZ: "generate.quiz",
      GENERATE_EXERCISES: "generate.exercises",
      GENERATE_AUDIO_RECAP: "generate.audio-recap",
    };
    for (const [type, name] of Object.entries(types)) {
      expect(planRecovery({ ...base, type })).toMatchObject({ action: "reenqueue", name });
    }
  });

  it("fails a job that is out of retry attempts", () => {
    const plan = planRecovery({ ...base, attempts: 3, maxAttempts: 3 });
    expect(plan).toMatchObject({ action: "fail", id: "job1" });
    if (plan.action === "fail") expect(plan.error).toMatch(/out of retry attempts/i);
  });

  it("allows one final attempt when attempts is just below the cap", () => {
    expect(planRecovery({ ...base, attempts: 2, maxAttempts: 3 })).toMatchObject({ action: "reenqueue", attempts: 3 });
  });

  it("skips demo-frozen rows (the seeded mid-processing fixture)", () => {
    const plan = planRecovery({ ...base, payload: { sourceId: "s1", demoFrozen: true } });
    expect(plan).toEqual({ action: "skip", id: "job1", reason: "demo-frozen" });
  });

  it("fails unknown job types instead of silently dropping them", () => {
    const plan = planRecovery({ ...base, type: "SOME_FUTURE_TYPE" });
    expect(plan).toMatchObject({ action: "fail" });
    if (plan.action === "fail") expect(plan.error).toContain("SOME_FUTURE_TYPE");
  });

  it("tolerates a null payload", () => {
    const plan = planRecovery({ ...base, type: "INGEST_SOURCE", studySetId: null, payload: null });
    if (plan.action !== "reenqueue") throw new Error("expected reenqueue");
    expect(plan.payload).toEqual({});
  });
});
