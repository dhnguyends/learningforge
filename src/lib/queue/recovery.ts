import { prisma } from "@/lib/db";
import { getEnv } from "@/lib/env";
import { enqueue, type JobName } from "@/lib/queue";

/**
 * Orphaned-job recovery for the inline queue driver.
 *
 * The inline driver executes processors in-process at enqueue time; when the
 * server dies (restart, crash, dev redeploys) whatever was QUEUED/RUNNING is
 * orphaned — no worker will ever pick those rows up, and the client polls them
 * forever (the "processing stuck at 0%" state). `ensureRecovered()` resumes
 * them once per process; the study-set API routes call it so recovery runs
 * exactly when someone is looking at the affected UI.
 *
 * Exemptions:
 * - `payload.demoFrozen === true` marks deliberately-stuck demo rows (the seed
 *   creates a mid-ingestion job so the dashboard shows live state; re-running
 *   it would hit real network fetches). See prisma/seed.ts.
 * - Jobs touched within the stale window are left alone: they may belong to a
 *   processor that is genuinely still running, and re-enqueueing those would
 *   double-execute them.
 *
 * With QUEUE_DRIVER=redis this is a no-op — BullMQ's worker owns job state and
 * retries across restarts there.
 */

const JOB_TYPE_TO_NAME: Record<string, JobName> = {
  INGEST_SOURCE: "ingest.source",
  GENERATE_GUIDE: "generate.guide",
  GENERATE_FLASHCARDS: "generate.flashcards",
  GENERATE_QUIZ: "generate.quiz",
  GENERATE_EXERCISES: "generate.exercises",
  GENERATE_AUDIO_RECAP: "generate.audio-recap",
};

/** A job last touched more recently than this is assumed to still have a live processor. */
export const RECOVERY_STALE_AFTER_MS = 60_000;

export type RecoveryJobRow = {
  id: string;
  studySetId: string | null;
  type: string;
  status: string;
  attempts: number;
  maxAttempts: number;
  payload: Record<string, unknown> | null;
};

export type RecoveryPlan =
  | { action: "reenqueue"; id: string; name: JobName; payload: Record<string, unknown>; attempts: number }
  | { action: "fail"; id: string; error: string }
  | { action: "skip"; id: string; reason: string };

/** Decide what to do with one orphaned job row. Pure — unit-tested. */
export function planRecovery(job: RecoveryJobRow): RecoveryPlan {
  if ((job.payload as { demoFrozen?: boolean } | null)?.demoFrozen === true) {
    return { action: "skip", id: job.id, reason: "demo-frozen" };
  }
  const name = JOB_TYPE_TO_NAME[job.type];
  if (!name) {
    return { action: "fail", id: job.id, error: `Interrupted by server restart; unknown job type "${job.type}" cannot be recovered.` };
  }
  const attempts = job.attempts + 1;
  if (attempts > job.maxAttempts) {
    return { action: "fail", id: job.id, error: "Interrupted by server restart and out of retry attempts." };
  }
  // Generation payloads carry their ids (guideId, deckId, …) but not the study
  // set id — the enqueue call sites add it; the column is the source of truth.
  const payload = { ...job.payload, ...(job.studySetId ? { studySetId: job.studySetId } : {}) };
  return { action: "reenqueue", id: job.id, name, payload, attempts };
}

export async function recoverOrphanedJobs(): Promise<{ recovered: number; failed: number; skipped: number }> {
  if (getEnv().QUEUE_DRIVER !== "inline") return { recovered: 0, failed: 0, skipped: 0 };

  const staleBefore = new Date(Date.now() - RECOVERY_STALE_AFTER_MS);
  const orphans = await prisma.generationJob.findMany({
    where: { status: { in: ["QUEUED", "RUNNING"] }, updatedAt: { lt: staleBefore } },
    orderBy: { createdAt: "asc" },
  });

  if (orphans.length === 0) return { recovered: 0, failed: 0, skipped: 0 };

  let recovered = 0;
  let failed = 0;
  let skipped = 0;
  const requeued: { type: string; done?: Promise<void> }[] = [];

  const run = async (job: (typeof orphans)[number]): Promise<void> => {
    const plan = planRecovery(job as RecoveryJobRow);
    if (plan.action === "skip") {
      skipped++;
      return;
    }
    if (plan.action === "fail") {
      await prisma.generationJob.update({
        where: { id: plan.id },
        data: { status: "FAILED", error: plan.error, finishedAt: new Date() },
      });
      failed++;
      console.warn(`[queue:recovery] failed job ${job.id} (${job.type}): ${plan.error}`);
      return;
    }
    // Reset the row first, then enqueue — the inline driver immediately marks
    // it RUNNING, so the order keeps the final state correct.
    await prisma.generationJob.update({
      where: { id: plan.id },
      data: { status: "QUEUED", attempts: plan.attempts, startedAt: null, finishedAt: null, error: null },
    });
    const res = await enqueue(plan.name, plan.payload as never, { generationJobId: plan.id });
    recovered++;
    requeued.push({ type: job.type, done: res.done });
    console.log(`[queue:recovery] re-enqueued job ${job.id} (${job.type}, attempt ${plan.attempts})`);
  };

  // Phase 1: ingests — generation jobs for the same set search its indexed
  // chunks, so they must not run until the recovered ingests have finished
  // (the normal flow gets this ordering for free: maybeAutoGenerate fires
  // after ingest succeeds).
  for (const job of orphans.filter((j) => j.type === "INGEST_SOURCE")) await run(job);
  await Promise.allSettled(requeued.map((r) => r.done).filter((d): d is Promise<void> => Boolean(d)));

  // Phase 2: everything else.
  for (const job of orphans.filter((j) => j.type !== "INGEST_SOURCE")) await run(job);
  await Promise.allSettled(requeued.map((r) => r.done).filter((d): d is Promise<void> => Boolean(d)));

  console.log(`[queue:recovery] done: ${recovered} re-enqueued, ${failed} failed, ${skipped} skipped`);
  return { recovered, failed, skipped };
}

let recoveryStarted: Promise<void> | null = null;

/**
 * Run orphan recovery once per process (fire-and-forget from API routes).
 * A total failure clears the latch so a later request can retry.
 */
export function ensureRecovered(): Promise<void> {
  recoveryStarted ??= recoverOrphanedJobs()
    .then(() => undefined)
    .catch((err) => {
      console.error("[queue:recovery] failed:", err);
      recoveryStarted = null;
    });
  return recoveryStarted;
}
