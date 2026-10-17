import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * One local language model on the GPU at a time: switching unloads the other
 * Ollama models (checked with /api/ps) and loads the chosen one; a job on a
 * model that is not loaded unloads the other language models first but keeps
 * the embeddings model. Ollama and nvidia-smi are faked.
 */
const memory = vi.hoisted(() => ({ used: [10_500, 1_200, 9_900] as number[] }));
vi.mock("@/lib/gpu", async (orig) => ({
  ...(await orig<typeof import("@/lib/gpu")>()),
  gpuMemoryUse: vi.fn(async () => ({ usedMiB: memory.used.shift() ?? 0, totalMiB: 11_264 })),
  cpuTimeoutFactor: vi.fn(async () => 1),
}));

import {
  alwaysThinks,
  clearOllamaGpu,
  localModelLabel,
  resetOllamaCache,
  sameModel,
  switchLocalModel,
  loadAloneOnGpu,
} from "@/lib/ai/ollama";
import { LocalGenerator, stripThinking } from "@/lib/ai/local";
import { parseGpuMemory } from "@/lib/gpu";
import { getEnv } from "@/lib/env";
import { z } from "zod";

const GiB = 1024 ** 3;
const TAGS = {
  models: [
    { name: "deepseek-r1:8b", size: 5.2e9, capabilities: ["completion", "thinking", "tools"], details: { parameter_size: "8.2B" } },
    { name: "embeddinggemma:latest", size: 0.6e9, capabilities: ["embedding"], details: { parameter_size: "307M" } },
    { name: "gemma4:latest", size: 6.6e9, capabilities: ["completion", "vision", "thinking"], details: { parameter_size: "7.5B" } },
  ],
};

/** A fake Ollama: `loaded` is what /api/ps reports; keep_alive 0 removes a model, a bare generate loads one. */
function fakeOllama(initial: string[]) {
  const loaded = new Set(initial);
  const calls: { path: string; body?: Record<string, unknown> }[] = [];
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const path = new URL(url).pathname;
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : undefined;
    calls.push({ path, body });
    const json = (v: unknown) => new Response(JSON.stringify(v), { status: 200 });
    if (path === "/api/tags") return json(TAGS);
    if (path === "/api/ps") return json({ models: [...loaded].map((name) => ({ name, size: 6 * GiB, size_vram: 6 * GiB })) });
    if (path === "/api/generate" && body?.keep_alive === 0) {
      loaded.delete(String(body.model));
      return json({ done: true, done_reason: "unload" });
    }
    if (path === "/api/generate") {
      loaded.add(String(body?.model));
      return json({ done: true, done_reason: "load" });
    }
    if (path === "/api/chat") {
      loaded.add(String(body?.model));
      return json({ message: { content: '<think>\nhmm\n</think>\n{"status":"ok","echo":"LearningForge"}' }, done_reason: "stop" });
    }
    return new Response("not found", { status: 404 });
  });
  vi.stubGlobal("fetch", fetchMock);
  return { loaded, calls, unloads: () => calls.filter((c) => c.body?.keep_alive === 0).map((c) => c.body?.model) };
}

beforeEach(() => {
  resetOllamaCache();
  memory.used = [10_500, 1_200, 9_900];
});
afterEach(() => vi.unstubAllGlobals());

describe("names and labels", () => {
  it("treats a missing tag as :latest and labels known families", () => {
    expect(sameModel("embeddinggemma", "embeddinggemma:latest")).toBe(true);
    expect(sameModel("gemma4:e2b", "gemma4:latest")).toBe(false);
    expect(localModelLabel("deepseek-r1:8b")).toBe("DeepSeek-R1 8B");
    expect(localModelLabel("gemma4:latest")).toBe("Gemma 4");
    expect(localModelLabel("gemma4:e2b")).toBe("Gemma 4 E2B");
    expect(localModelLabel("phi4:14b")).toBe("phi4:14b");
    expect(localModelLabel("hf.co/bartowski/Meta-Llama-3.1-8B-Instruct-GGUF:Q4_K_M")).toBe("Meta-Llama-3.1-8B-Instruct Q4_K_M");
    expect(alwaysThinks("deepseek-r1:8b")).toBe(true);
    expect(alwaysThinks("gemma4:latest")).toBe(false);
  });

  it("reads nvidia-smi memory and strips a reasoning block", () => {
    expect(parseGpuMemory("10759, 11264\r\n")).toEqual({ usedMiB: 10_759, totalMiB: 11_264 });
    expect(parseGpuMemory("No devices were found")).toBeNull();
    expect(stripThinking('<think>\nplan\n</think>\n{"a":1}')).toBe('{"a":1}');
    expect(stripThinking('{"a":"<think>"}')).toBe('{"a":"<think>"}');
  });
});

describe("switching the local model", () => {
  it("unloads every other model, checks they are gone, then loads the chosen one", async () => {
    const o = fakeOllama(["gemma4:latest", "embeddinggemma:latest"]);
    const r = await switchLocalModel("deepseek-r1:8b");
    expect(o.unloads()).toEqual(["gemma4:latest", "embeddinggemma:latest"]);
    expect([...o.loaded]).toEqual(["deepseek-r1:8b"]);
    expect(r).toMatchObject({
      model: "deepseek-r1:8b",
      loaded: true,
      vramBytes: 6 * GiB,
      stillLoaded: [],
      usedBeforeMiB: 10_500,
      usedAfterMiB: 1_200,
      usedLoadedMiB: 9_900,
      totalMiB: 11_264,
    });
    expect(r.unloaded.map((m) => m.name)).toEqual(["gemma4:latest", "embeddinggemma:latest"]);
    // Unloaded and checked before the load.
    const load = o.calls.findIndex((c) => c.path === "/api/generate" && c.body?.keep_alive === undefined);
    const lastCheck = o.calls.map((c) => c.path).lastIndexOf("/api/ps", load);
    expect(lastCheck).toBeGreaterThan(o.calls.findIndex((c) => c.body?.keep_alive === 0));
  });

  it("keeps the chosen model when it is already loaded", async () => {
    const o = fakeOllama(["deepseek-r1:8b", "gemma4:latest"]);
    const r = await switchLocalModel("deepseek-r1:8b");
    expect(o.unloads()).toEqual(["gemma4:latest"]);
    expect(r.loaded).toBe(true);
  });

  it("reports a model Ollama would not unload", async () => {
    const o = fakeOllama(["gemma4:latest"]);
    o.loaded.delete = () => false; // stuck in memory
    const r = await clearOllamaGpu({ waitMs: 300 });
    expect(r.stillLoaded).toEqual(["gemma4:latest"]);
    expect(r.unloaded).toEqual([]);
  });

  it("frees the whole GPU on request", async () => {
    const o = fakeOllama(["deepseek-r1:8b", "embeddinggemma:latest"]);
    const r = await clearOllamaGpu();
    expect(o.loaded.size).toBe(0);
    expect(r.unloaded).toHaveLength(2);
  });
});

describe("before a job", () => {
  it("does nothing when the model is already loaded", async () => {
    const o = fakeOllama(["deepseek-r1:8b", "embeddinggemma:latest"]);
    await loadAloneOnGpu("deepseek-r1:8b");
    expect(o.unloads()).toEqual([]);
  });

  it("unloads the other language models but keeps the embeddings model", async () => {
    const o = fakeOllama(["gemma4:latest", "embeddinggemma:latest"]);
    await loadAloneOnGpu("deepseek-r1:8b");
    expect(o.unloads()).toEqual(["gemma4:latest"]);
    expect([...o.loaded]).toEqual(["embeddinggemma:latest"]);
  });

  it("never fails the job when Ollama cannot be asked", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new TypeError("fetch failed"))));
    await expect(loadAloneOnGpu("deepseek-r1:8b")).resolves.toBeUndefined();
  });
});

describe("DeepSeek-R1 as the generator", () => {
  it("lets it think with a budget, alone on the GPU, and keeps only the JSON answer", async () => {
    const o = fakeOllama(["gemma4:latest"]);
    const env = getEnv();
    const gen = new LocalGenerator(env, "deepseek-r1:8b");
    const out = await gen.generate({ system: "s", user: "u", schema: z.object({ status: z.literal("ok"), echo: z.string() }), maxTokens: 256 });
    expect(out).toMatchObject({ provider: "local", model: "deepseek-r1:8b", data: { status: "ok", echo: "LearningForge" } });
    expect(o.unloads()).toEqual(["gemma4:latest"]);
    const chat = o.calls.find((c) => c.path === "/api/chat")!;
    expect(chat.body).toMatchObject({ model: "deepseek-r1:8b", think: true, options: { num_predict: 256 + LocalGenerator.THINKING_BUDGET } });
  });

  it("leaves Gemma's settings as they were", async () => {
    const o = fakeOllama([]);
    const env = getEnv();
    await new LocalGenerator(env, "gemma4:latest").generate({ system: "s", user: "u", schema: z.object({ status: z.literal("ok"), echo: z.string() }), maxTokens: 256 });
    expect(o.calls.find((c) => c.path === "/api/chat")!.body).toMatchObject({ model: "gemma4:latest", think: env.LOCAL_AI_THINK, options: { num_predict: 256 } });
  });
});
