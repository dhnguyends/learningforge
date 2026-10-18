import type { GpuClearReport, LocalSwitchReport } from "@/hooks/use-api";

/**
 * Text of the GPU memory reports in the admin cards. The memory figures come
 * from nvidia-smi (the whole card); Ollama's per-model sizes are not shown
 * because it misreports some models (Gemma 4 shows 0.4 GB for about 6 GB).
 */
export const gb = (bytes: number) => `${(bytes / 1024 ** 3).toFixed(1)} GB`;
export const gbMiB = (mib: number) => `${(mib / 1024).toFixed(1)} GB`;

/** "Unloaded gemma4:latest. GPU memory 6.6 GB -> 1.0 GB." */
export function clearSummary(r: GpuClearReport, nothing = "No other model was in GPU memory."): string {
  const parts: string[] = [];
  parts.push(r.unloaded.length ? `Unloaded ${r.unloaded.map((m) => m.name).join(", ")}.` : nothing);
  if (r.stillLoaded.length) parts.push(`Still loaded: ${r.stillLoaded.join(", ")}.`);
  if (r.unloaded.length && r.usedBeforeMiB != null && r.usedAfterMiB != null) parts.push(`GPU memory ${gbMiB(r.usedBeforeMiB)} \u2192 ${gbMiB(r.usedAfterMiB)}.`);
  return parts.join(" ");
}

export function switchSummary(r: LocalSwitchReport): string {
  const loaded = r.loaded
    ? `${r.model} loaded${r.usedLoadedMiB != null ? ` (card: ${gbMiB(r.usedLoadedMiB)} used)` : ""}.`
    : `${r.model} could not be loaded yet${r.error ? ` (${r.error})` : ""}; the first job will load it.`;
  return `${clearSummary(r)} ${loaded}`;
}

/** After choosing cloud models: what was unloaded from the GPU. */
export function freedSummary(r: GpuClearReport): string {
  return clearSummary(r, "No local language model was in GPU memory.");
}
