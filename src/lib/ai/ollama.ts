import { getEnv, type Env } from "@/lib/env";
import { gpuMemoryUse } from "@/lib/gpu";

/**
 * Ollama model management for the local AI: which models are installed, which
 * sit in GPU memory, and running one language model at a time.
 *
 * The GPU (11 GB on a GTX 1080 Ti) holds one 8B model comfortably, not two:
 * with Gemma 4 still loaded, DeepSeek-R1 would spill onto the CPU or push
 * Whisper out. So switching the local model unloads every other Ollama model
 * first (keep_alive 0), checks /api/ps until they are gone, and only then
 * loads the new one. Generation and translation do the same before a model's
 * first call ({@link loadAloneOnGpu}), in case another model was loaded since.
 */

export interface InstalledModel {
  name: string;
  label: string;
  /** "8.2B" */
  parameterSize: string | null;
  sizeBytes: number;
  capabilities: string[];
  /** Can write text (not an embeddings-only model). */
  generation: boolean;
}

export interface LoadedModel {
  name: string;
  /** Bytes in GPU memory (the rest, if any, runs on the CPU). */
  vramBytes: number;
  sizeBytes: number;
}

export interface GpuClearReport {
  /** Models unloaded from memory. */
  unloaded: LoadedModel[];
  /** Models still loaded after waiting (should be empty). */
  stillLoaded: string[];
  /** Whole-GPU memory in use (nvidia-smi), before and after; null without a GPU. */
  usedBeforeMiB: number | null;
  usedAfterMiB: number | null;
  totalMiB: number | null;
}

export interface LocalSwitchReport extends GpuClearReport {
  model: string;
  /** The chosen model is in memory, ready for the first job. */
  loaded: boolean;
  /** Its size in GPU memory once loaded. */
  vramBytes: number | null;
  /** Whole-GPU memory in use after loading it. */
  usedLoadedMiB: number | null;
  error?: string;
}

const baseUrl = (env: Env) => env.LOCAL_AI_BASE_URL.replace(/\/$/, "");

/** "embeddinggemma" and "embeddinggemma:latest" are the same model. */
export function sameModel(a: string, b: string): boolean {
  const norm = (m: string) => (m.includes(":") ? m : `${m}:latest`).toLowerCase();
  return norm(a) === norm(b);
}

/** Reasoning models that think whatever `think` says (DeepSeek-R1): they need a token budget for it. */
export function alwaysThinks(model: string): boolean {
  return /deepseek-r1/i.test(model);
}

/** "deepseek-r1:8b" → "DeepSeek-R1 8B", "gemma4:latest" → "Gemma 4", "hf.co/x/Llama-3.1-8B-GGUF:Q4_K_M" → "Llama-3.1-8B Q4_K_M". */
export function localModelLabel(model: string): string {
  const hf = /^hf\.co\/[^/]+\/([^:]+?)(?:-GGUF)?(?::(.+))?$/i.exec(model);
  if (hf) return hf[2] && hf[2] !== "latest" ? `${hf[1]} ${hf[2]}` : hf[1];
  const [family, tag = "latest"] = model.toLowerCase().split(":");
  const size = tag === "latest" ? "" : ` ${tag.toUpperCase()}`;
  const known: [RegExp, string][] = [
    [/^deepseek-r1$/, "DeepSeek-R1"],
    [/^gemma4$/, "Gemma 4"],
    [/^gemma3$/, "Gemma 3"],
    [/^llama3\.1$/, "Llama 3.1"],
    [/^qwen3$/, "Qwen 3"],
    [/^mistral$/, "Mistral"],
  ];
  const hit = known.find(([re]) => re.test(family));
  return hit ? `${hit[1]}${size}` : model;
}

async function ollama<T>(path: string, init: RequestInit & { timeoutMs?: number } = {}, env: Env = getEnv()): Promise<T> {
  const res = await fetch(`${baseUrl(env)}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json" },
    signal: AbortSignal.timeout(init.timeoutMs ?? 10_000),
  });
  if (!res.ok) throw new Error(`Ollama ${path} ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return (await res.json()) as T;
}

let tagsMemo: { at: number; models: InstalledModel[] } | null = null;

/** Models installed in Ollama (/api/tags), cached a minute. Throws when Ollama is unreachable. */
export async function installedModels(env: Env = getEnv()): Promise<InstalledModel[]> {
  if (tagsMemo && Date.now() - tagsMemo.at < 60_000) return tagsMemo.models;
  const json = await ollama<{ models?: { name: string; size?: number; capabilities?: string[]; details?: { parameter_size?: string } }[] }>("/api/tags", {}, env);
  const models = (json.models ?? [])
    .map((m) => {
      const capabilities = m.capabilities ?? [];
      return {
        name: m.name,
        label: localModelLabel(m.name),
        parameterSize: m.details?.parameter_size ?? null,
        sizeBytes: m.size ?? 0,
        capabilities,
        // Older Ollama versions do not list capabilities: then go by the name.
        generation: capabilities.length ? capabilities.includes("completion") : !/embed/i.test(m.name),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
  tagsMemo = { at: Date.now(), models };
  return models;
}

/** Models in memory now (/api/ps). */
export async function loadedModels(env: Env = getEnv()): Promise<LoadedModel[]> {
  const json = await ollama<{ models?: { name: string; size?: number; size_vram?: number }[] }>("/api/ps", {}, env);
  return (json.models ?? []).map((m) => ({ name: m.name, vramBytes: m.size_vram ?? 0, sizeBytes: m.size ?? 0 }));
}

/** Asks Ollama to unload a model now (keep_alive 0); works for embedding models too. */
export async function unloadModel(name: string, env: Env = getEnv()): Promise<void> {
  await ollama("/api/generate", { method: "POST", body: JSON.stringify({ model: name, keep_alive: 0 }), timeoutMs: 30_000 }, env);
}

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Polls /api/ps until none of `names` is loaded (or the wait is over); returns those still loaded. */
async function waitUntilUnloaded(names: string[], env: Env, waitMs: number): Promise<string[]> {
  const until = Date.now() + waitMs;
  for (;;) {
    const left = (await loadedModels(env)).filter((m) => names.some((n) => sameModel(n, m.name))).map((m) => m.name);
    if (!left.length || Date.now() >= until) return left;
    await pause(250);
  }
}

// One switch at a time in this process: two jobs starting on different
// models must not both load theirs.
let lock: Promise<unknown> = Promise.resolve();
function exclusive<T>(fn: () => Promise<T>): Promise<T> {
  const run = lock.then(fn, fn);
  lock = run.catch(() => undefined);
  return run;
}

/**
 * Unloads every Ollama model except `keep` and checks they are gone, with the
 * GPU memory in use before and after. `keepEmbeddings` leaves embedding
 * models (small, used by every search) where they are.
 */
export function clearOllamaGpu(opts: { keep?: string; keepEmbeddings?: boolean; waitMs?: number } = {}, env: Env = getEnv()): Promise<GpuClearReport> {
  return exclusive(() => clear(opts, env));
}

async function clear({ keep, keepEmbeddings = false, waitMs = 15_000 }: { keep?: string; keepEmbeddings?: boolean; waitMs?: number }, env: Env): Promise<GpuClearReport> {
  const before = await gpuMemoryUse();
  let embeddings: InstalledModel[] = [];
  if (keepEmbeddings) embeddings = (await installedModels(env).catch(() => [])).filter((m) => !m.generation);
  const isEmbedding = (name: string) => sameModel(name, env.OLLAMA_EMBEDDINGS_MODEL) || embeddings.some((m) => sameModel(m.name, name));
  const targets = (await loadedModels(env)).filter((m) => !(keep && sameModel(m.name, keep)) && !(keepEmbeddings && isEmbedding(m.name)));
  for (const m of targets) await unloadModel(m.name, env);
  const stillLoaded = targets.length ? await waitUntilUnloaded(targets.map((m) => m.name), env, waitMs) : [];
  // The driver releases the memory a moment after the runner exits.
  if (targets.length) await pause(500);
  const after = targets.length ? await gpuMemoryUse() : before;
  return {
    unloaded: targets.filter((m) => !stillLoaded.includes(m.name)),
    stillLoaded,
    usedBeforeMiB: before?.usedMiB ?? null,
    usedAfterMiB: after?.usedMiB ?? null,
    totalMiB: before?.totalMiB ?? null,
  };
}

/**
 * Makes `model` the only language model in GPU memory: unloads every other
 * Ollama model (embeddings included), checks they are gone, then loads
 * `model` so the first job does not wait for it.
 */
export function switchLocalModel(model: string, env: Env = getEnv()): Promise<LocalSwitchReport> {
  return exclusive(async () => {
    const cleared = await clear({ keep: model }, env);
    try {
      await ollama(
        "/api/generate",
        { method: "POST", body: JSON.stringify({ model, ...(env.LOCAL_AI_NUM_CTX ? { options: { num_ctx: env.LOCAL_AI_NUM_CTX } } : {}) }), timeoutMs: 180_000 },
        env,
      );
      const mine = (await loadedModels(env)).find((m) => sameModel(m.name, model));
      return { ...cleared, model, loaded: Boolean(mine), vramBytes: mine?.vramBytes ?? null, usedLoadedMiB: (await gpuMemoryUse())?.usedMiB ?? null };
    } catch (err) {
      return { ...cleared, model, loaded: false, vramBytes: null, usedLoadedMiB: null, error: err instanceof Error ? err.message : String(err) };
    }
  });
}

/**
 * Before calling a local language model: when it is not in memory yet, unload
 * the other language models first, so two never share the GPU. Embedding
 * models stay. Never throws: if Ollama cannot be asked, the call itself will
 * report the problem.
 */
export async function loadAloneOnGpu(model: string, env: Env = getEnv()): Promise<void> {
  try {
    const loaded = await loadedModels(env);
    if (loaded.some((m) => sameModel(m.name, model))) return;
    if (!loaded.length) return;
    await clearOllamaGpu({ keep: model, keepEmbeddings: true, waitMs: 10_000 }, env);
  } catch {
    // Ollama unreachable: the generation call says so.
  }
}

/** Test hook. */
export function resetOllamaCache(): void {
  tagsMemo = null;
}
