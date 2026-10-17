import { ApiError, apiHandler, ok, requireAdmin } from "@/lib/api";
import { audit } from "@/lib/audit";
import { clearOllamaGpu, loadedModels } from "@/lib/ai/ollama";
import { gpuMemoryUse } from "@/lib/gpu";

/**
 * GPU memory as the admin AI card shows it: the Ollama models loaded now and
 * the whole card's use (nvidia-smi, every process). POST unloads every Ollama
 * model and checks they are gone; the next job loads what it needs.
 */

export const GET = apiHandler(async () => {
  await requireAdmin();
  const [loaded, memory] = await Promise.all([loadedModels().catch(() => null), gpuMemoryUse()]);
  return ok({ ollamaReachable: loaded !== null, loaded: loaded ?? [], usedMiB: memory?.usedMiB ?? null, totalMiB: memory?.totalMiB ?? null });
});

export const POST = apiHandler(async () => {
  const admin = await requireAdmin();
  const report = await clearOllamaGpu().catch(() => {
    throw new ApiError(503, "Ollama is not reachable: nothing to unload", "unavailable");
  });
  await audit({
    userId: admin.user.id,
    action: "admin.gpu_clear",
    entityType: "app_setting",
    entityId: "ai",
    metadata: { unloaded: report.unloaded.map((m) => m.name), stillLoaded: report.stillLoaded },
  });
  return ok(report);
});
