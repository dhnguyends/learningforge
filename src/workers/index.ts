/**
 * LearningForge background worker.
 * Runs alongside the web app when QUEUE_DRIVER=redis:
 *   npm run worker
 * Consumes the "lectureforge" BullMQ queue and executes the same processors
 * the inline driver uses, updating GenerationJob rows as stages progress.
 */
import { Worker, type Job } from "bullmq";
import { getEnv } from "@/lib/env";
import { getProcessors } from "@/lib/queue/processors";

const env = getEnv();

if (env.QUEUE_DRIVER !== "redis") {
  console.log("QUEUE_DRIVER is not 'redis' — the web process runs jobs inline; no worker needed.");
  console.log("Set QUEUE_DRIVER=redis and start this worker to use BullMQ.");
  process.exit(0);
}

if (!env.REDIS_URL) {
  console.error("REDIS_URL is required for the worker.");
  process.exit(1);
}

const processors = getProcessors();
const connection = { url: env.REDIS_URL };

const worker = new Worker(
  "lectureforge",
  async (job: Job) => {
    const name = job.name as keyof typeof processors;
    const processor = processors[name];
    if (!processor) throw new Error(`No processor registered for ${name}`);

    const { generationJobId, ...payload } = job.data as Record<string, unknown>;
    const { prisma } = await import("@/lib/db");

    if (generationJobId) {
      await prisma.generationJob
        .update({ where: { id: generationJobId as string }, data: { status: "RUNNING", startedAt: new Date() } })
        .catch(() => undefined);
    }

    try {
      await processor({
        payload: payload as never,
        generationJobId: generationJobId as string | undefined,
        async updateStage(stage, progress) {
          await job.updateProgress({ stage, progress });
          if (generationJobId) {
            await prisma.generationJob
              .update({
                where: { id: generationJobId as string },
                data: { stage, ...(progress != null ? { progress } : {}) },
              })
              .catch(() => undefined);
          }
        },
        log: (message, data) => console.log(`[worker:${job.id}] ${message}`, data ?? ""),
      });
      if (generationJobId) {
        await prisma.generationJob
          .update({ where: { id: generationJobId as string }, data: { status: "SUCCEEDED", progress: 100, finishedAt: new Date() } })
          .catch(() => undefined);
      }
    } catch (err) {
      if (generationJobId) {
        await prisma.generationJob
          .update({
            where: { id: generationJobId as string },
            data: { status: "FAILED", error: err instanceof Error ? err.message : String(err), finishedAt: new Date() },
          })
          .catch(() => undefined);
      }
      throw err;
    }
  },
  { connection, concurrency: 4 },
);

worker.on("failed", (job, err) => {
  console.error(`[worker] job ${job?.name}(${job?.id}) failed:`, err.message);
});
worker.on("error", (err) => console.error("[worker] worker error:", err));

console.log(`LearningForge worker listening on queue "lectureforge" (${env.REDIS_URL})`);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, async () => {
    await worker.close();
    process.exit(0);
  });
}
