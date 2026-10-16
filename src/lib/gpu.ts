import { execFile } from "node:child_process";
import { getEnv } from "@/lib/env";

/**
 * GPU available to this server for local processing (Whisper transcription,
 * EmbeddingGemma, local Gemma).
 *
 * "Available" means the hardware is present AND usable: `nvidia-smi` must
 * answer, which needs the card plus a working driver (in a container: the GPU
 * passed through). Without one, the local services fall back to the CPU by
 * themselves (Ollama; Speaches with WHISPER__INFERENCE_DEVICE=auto), and the
 * app gives their calls more time (cpuTimeoutFactor).
 */
export interface GpuInfo {
  available: boolean;
  /** e.g. "NVIDIA GeForce GTX 1080 Ti" */
  name: string | null;
  memoryMiB: number | null;
  driver: string | null;
}

const NO_GPU: GpuInfo = { available: false, name: null, memoryMiB: null, driver: null };
// Hardware does not change while the server runs; re-check now and then
// anyway (driver reloads, GPU passed through after start).
const CACHE_MS = 10 * 60_000;
let cache: { info: GpuInfo; at: number } | null = null;

/** Parses `nvidia-smi --query-gpu=name,memory.total,driver_version --format=csv,noheader,nounits`. */
export function parseNvidiaSmi(output: string): GpuInfo {
  const first = output.split(/\r?\n/).map((l) => l.trim()).find(Boolean);
  if (!first) return NO_GPU;
  const [name, memory, driver] = first.split(",").map((s) => s.trim());
  if (!name || /^(no devices|failed|nvidia-smi has failed)/i.test(first)) return NO_GPU;
  const memoryMiB = Number.parseInt(memory ?? "", 10);
  return { available: true, name, memoryMiB: Number.isFinite(memoryMiB) ? memoryMiB : null, driver: driver || null };
}

function runNvidiaSmi(): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      "nvidia-smi",
      ["--query-gpu=name,memory.total,driver_version", "--format=csv,noheader,nounits"],
      { timeout: 5_000, windowsHide: true },
      (err, stdout) => (err ? reject(err) : resolve(stdout)),
    );
  });
}

export async function detectGpu(): Promise<GpuInfo> {
  if (getEnv().GPU_DETECTION === "off") return NO_GPU;
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.info;
  let info = NO_GPU;
  try {
    info = parseNvidiaSmi(await runNvidiaSmi());
  } catch {
    info = NO_GPU; // no nvidia-smi, no driver, or no device
  }
  cache = { info, at: Date.now() };
  return info;
}

/** Short label for the top bar: "GTX 1080 Ti", "RTX 4090", or "No GPU". */
export function gpuLabel(info: GpuInfo): string {
  if (!info.available || !info.name) return "No GPU";
  return info.name.replace(/^NVIDIA\s+/i, "").replace(/^GeForce\s+/i, "").trim() || info.name;
}

/**
 * How much longer local processing may take on this machine: 1 with a GPU,
 * CPU_TIMEOUT_FACTOR (default 4) without — CPU transcription and embeddings
 * run several times slower, and their timeouts are sized for a GPU.
 */
export async function cpuTimeoutFactor(): Promise<number> {
  return (await detectGpu()).available ? 1 : getEnv().CPU_TIMEOUT_FACTOR;
}

/** Test hook. */
export function resetGpuCache(): void {
  cache = null;
}
