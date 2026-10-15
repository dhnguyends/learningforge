import type { JobType } from "@prisma/client";
import { prisma } from "@/lib/db";
import { ApiError, rateLimited } from "@/lib/api";
import { getIndexingReadiness } from "@/lib/retrieval/readiness";
import { rateLimit } from "@/lib/rate-limit";
import { enqueue, type JobName } from "@/lib/queue";

/**
 * Shared flow for expensive generation endpoints:
 * rate limit → create GenerationJob → enqueue → return job id for polling.
 */
export async function startGeneration(opts: {
  userId: string;
  studySetId: string;
  type: JobType;
  jobName: JobName;
  payload: Record<string, unknown>;
}): Promise<{ jobId: string }> {
  const limit = rateLimit(`generation:${opts.userId}`);
  if (!limit.allowed) throw rateLimited(limit.retryAfterSec);

  const job = await prisma.generationJob.create({
    data: { studySetId: opts.studySetId, type: opts.type, payload: opts.payload as object },
  });
  await enqueue(opts.jobName, { ...opts.payload, studySetId: opts.studySetId, generationJobId: job.id } as never, {
    generationJobId: job.id,
  });
  return { jobId: job.id };
}

/**
 * Generation waits until the whole study set is imported (every source READY,
 * every passage vectorized and indexed). Called before any artifact row is
 * created, so a refused request leaves nothing behind.
 */
export async function assertSourcesIndexed(studySetId: string): Promise<void> {
  const readiness = await getIndexingReadiness(studySetId);
  if (!readiness.ready) throw new ApiError(409, readiness.reason ?? "Sources are not ready", "sources_not_ready");
}
