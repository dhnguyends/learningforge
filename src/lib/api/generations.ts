import type { JobType } from "@prisma/client";
import { prisma } from "@/lib/db";
import { rateLimited } from "@/lib/api";
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
