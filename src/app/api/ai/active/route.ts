import { apiHandler, ok, requireSession } from "@/lib/api";
import { aiLabel, getActiveAi } from "@/lib/ai/settings";
import { detectGpu, gpuLabel } from "@/lib/gpu";

/** The generation model in use and the GPU for local processing, for the top bar (any signed-in user). */
export const GET = apiHandler(async () => {
  await requireSession();
  const [ai, gpu] = await Promise.all([getActiveAi(), detectGpu()]);
  return ok({
    provider: ai.provider,
    model: ai.model,
    label: aiLabel(ai),
    cloud: ai.provider !== "local" && ai.provider !== "mock",
    gpu: { available: gpu.available, name: gpu.name, label: gpuLabel(gpu), memoryMiB: gpu.memoryMiB },
  });
});
