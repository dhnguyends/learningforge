import { getEnv } from "@/lib/env";
import { prisma } from "@/lib/db";
import type { EnqueueOptions, JobContext, JobName, JobPayloadMap } from "@/lib/queue/types";
import { getProcessors } from "@/lib/queue/processors";

export type { EnqueueOptions, JobContext, JobName, JobPayloadMap } from "@/lib/queue/types";

export interface EnqueueResult {
  driver: "inline" | "redis";
  /** Inline driver only: resolves when the in-process processor finishes. */
  done?: Promise<void>;
}

/**
 * Queue facade.
 * - "redis" (production): BullMQ queue consumed by `npm run worker`.
 * - "inline" (dev/tests): processors run in-process in the background, with the
 *   same GenerationJob progress tracking, so the whole product works with zero
 *   extra services.
 */
export async function enqueue<K extends JobName>(
  name: K,
  payload: JobPayloadMap[K],
  opts: EnqueueOptions = {},
): Promise<EnqueueResult> {
  const env = getEnv();

  if (env.QUEUE_DRIVER === "redis") {
    const { Queue } = await import("bullmq");
    const queue = new Queue("lectureforge", { connection: { url: env.REDIS_URL } });
    // Callers pass the GenerationJob id either in opts or inside the payload —
    // prefer opts, but never overwrite a payload id with undefined (undefined
    // keys are dropped when BullMQ serializes the job data).
    const { generationJobId: payloadJobId, ...rest } = payload as JobPayloadMap[K] & {
      generationJobId?: string | undefined;
    };
    try {
      await queue.add(
        name,
        { ...rest, generationJobId: opts.generationJobId ?? payloadJobId },
        {
          jobId: opts.jobId,
          attempts: 3,
          backoff: { type: "exponential", delay: 5000 },
          removeOnComplete: 500,
          removeOnFail: 500,
        },
      );
    } finally {
      await queue.close();
    }
    return { driver: "redis" };
  }

  // Inline driver: same progress semantics, no worker process needed.
  const processors = getProcessors();
  const processor = processors[name] as (ctx: JobContext<JobPayloadMap[K]>) => Promise<void>;
  const { generationJobId, ...rest } = payload as JobPayloadMap[K] & { generationJobId?: string | undefined };
  const jobId = opts.generationJobId ?? generationJobId;
  const ctx: JobContext<JobPayloadMap[K]> = makeContext(rest as JobPayloadMap[K], jobId);

  const done = (async () => {
    try {
      if (jobId) {
        await prisma.generationJob.update({
          where: { id: jobId },
          data: { status: "RUNNING", startedAt: new Date() },
        });
      }
      await processor(ctx);
      if (jobId) {
        await prisma.generationJob.update({
          where: { id: jobId },
          data: { status: "SUCCEEDED", progress: 100, finishedAt: new Date() },
        });
      }
    } catch (err) {
      console.error(`[queue:inline] job ${name} failed:`, err);
      if (jobId) {
        await prisma.generationJob
          .update({
            where: { id: jobId },
            data: {
              status: "FAILED",
              error: err instanceof Error ? err.message : String(err),
              finishedAt: new Date(),
            },
          })
          .catch(() => undefined);
      }
    }
  })();

  return { driver: "inline", done };
}

function makeContext<P>(
  payload: P,
  generationJobId?: string,
): JobContext<P> {
  return {
    payload,
    generationJobId,
    async updateStage(stage, progress) {
      if (!generationJobId) return;
      await prisma.generationJob
        .update({
          where: { id: generationJobId },
          data: {
            stage,
            ...(progress != null ? { progress: Math.min(100, Math.max(0, progress)) } : {}),
          },
        })
        .catch(() => undefined);
    },
    log(message, data) {
      console.log(`[job:${generationJobId ?? "-"}] ${message}`, data ?? "");
    },
  };
}
