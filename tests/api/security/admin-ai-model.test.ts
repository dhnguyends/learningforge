import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import "../helpers";
import { prisma, createTestUser, disposeTestUser, signInAs, type TestUser } from "../helpers";
import { NextRequest } from "next/server";
import { GET, PUT } from "@/app/api/admin/ai/route";
import { POST as testConnection } from "@/app/api/admin/ai/test/route";
import { GET as gpuStatus, POST as freeGpu } from "@/app/api/admin/ai/gpu/route";
import { clearOllamaGpu, switchLocalModel } from "@/lib/ai/ollama";
import { getActiveAi, invalidateAiChoice } from "@/lib/ai/settings";

/**
 * Admin AI-model selector: ADMIN only (database role), allow-listed models,
 * audited, applied to the next generation, and the API key never leaves the
 * server.
 */
// Hoisted above the imports: modules imported below may read (and cache) the env.
vi.hoisted(() => {
  process.env.AI_PROVIDER = "local";
  process.env.GEMINI_API_KEY = "test-gemini-key-not-real";
  process.env.ZAI_API_KEY = "zai-test-key-not-real";
  process.env.GLM_AI_MODEL = "GLM-5.3-Flash";
});

// Never touch the developer's real Ollama: switching would unload their models.
vi.mock("@/lib/ai/ollama", async (orig) => {
  const real = await orig<typeof import("@/lib/ai/ollama")>();
  const report = { unloaded: [{ name: "gemma4:latest", vramBytes: 6e9, sizeBytes: 6e9 }], stillLoaded: [], usedBeforeMiB: 10_000, usedAfterMiB: 1_000, totalMiB: 11_264 };
  return {
    ...real,
    installedModels: vi.fn(async () => [
      { name: "deepseek-r1:8b", label: "DeepSeek-R1 8B", parameterSize: "8.2B", sizeBytes: 5e9, capabilities: ["completion", "thinking"], generation: true },
      { name: "embeddinggemma:latest", label: "embeddinggemma:latest", parameterSize: null, sizeBytes: 6e8, capabilities: ["embedding"], generation: false },
      { name: "gemma4:latest", label: "Gemma 4", parameterSize: "7.5B", sizeBytes: 6e9, capabilities: ["completion"], generation: true },
    ]),
    loadedModels: vi.fn(async () => [{ name: "deepseek-r1:8b", vramBytes: 9e9, sizeBytes: 9e9 }]),
    switchLocalModel: vi.fn(async (model: string) => ({ ...report, model, loaded: true, vramBytes: 9e9, usedLoadedMiB: 9_900 })),
    clearOllamaGpu: vi.fn(async () => report),
  };
});

const URL_ = "http://localhost/api/admin/ai";
const req = (method: "GET" | "PUT" | "POST", body?: unknown, url = URL_) =>
  new NextRequest(url, { method, ...(body === undefined ? {} : { body: JSON.stringify(body), headers: { "content-type": "application/json" } }) });

let admin: TestUser;
let user: TestUser;
// The test shares the development database: keep whatever the developer chose.
let saved: { value: unknown; updatedById: string | null } | null = null;

beforeAll(async () => {
  saved = await prisma.appSetting.findUnique({ where: { key: "ai" }, select: { value: true, updatedById: true } });
  admin = await createTestUser("AI admin");
  await prisma.user.update({ where: { id: admin.id }, data: { role: "ADMIN", nature: "HUMAN" } }); // only Human accounts can be Admin
  user = await createTestUser("AI plain user");
});

afterAll(async () => {
  // Restore only what this test changed: if someone saved a model meanwhile
  // (the row was last written by another account), keep their choice.
  const current = await prisma.appSetting.findUnique({ where: { key: "ai" }, select: { updatedById: true } });
  if (current && current.updatedById === admin.id) {
    if (saved) {
      await prisma.appSetting.update({ where: { key: "ai" }, data: { value: saved.value as object, updatedById: saved.updatedById } });
    } else {
      await prisma.appSetting.deleteMany({ where: { key: "ai" } });
    }
  }
  await prisma.auditLog.deleteMany({ where: { userId: admin.id } });
  await disposeTestUser(admin.email);
  await disposeTestUser(user.email);
  await prisma.$disconnect();
});

describe("admin AI model", () => {
  it("is closed to anonymous and non-admin callers", async () => {
    signInAs(null);
    expect((await GET(req("GET"), {} as never)).status).toBe(401);
    signInAs(user.id);
    expect((await GET(req("GET"), {} as never)).status).toBe(403);
    expect((await PUT(req("PUT", { provider: "local" }), {} as never)).status).toBe(403);
    expect((await testConnection(req("POST", { provider: "local" }, `${URL_}/test`), {} as never)).status).toBe(403);
    expect((await gpuStatus(req("GET"), {} as never)).status).toBe(403);
    expect((await freeGpu(req("POST"), {} as never)).status).toBe(403);
    expect(clearOllamaGpu).not.toHaveBeenCalled();
  });

  it("offers the installed local models and switches to DeepSeek-R1 with the GPU cleared first", async () => {
    signInAs(admin.id);
    const view = await (await GET(req("GET"), {} as never)).json();
    // Embeddings-only models cannot be chosen.
    expect(view.localModels.map((m: { name: string }) => m.name)).toEqual(["deepseek-r1:8b", "gemma4:latest"]);

    vi.mocked(switchLocalModel).mockClear();
    const res = await PUT(req("PUT", { provider: "local", model: "deepseek-r1:8b" }), {} as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.active).toMatchObject({ provider: "local", model: "deepseek-r1:8b", source: "admin" });
    expect(body.gpu).toMatchObject({ model: "deepseek-r1:8b", loaded: true, unloaded: [{ name: "gemma4:latest" }] });
    expect(switchLocalModel).toHaveBeenCalledWith("deepseek-r1:8b", expect.anything());
    invalidateAiChoice();
    expect(await getActiveAi()).toMatchObject({ provider: "local", model: "deepseek-r1:8b" });
    const log = await prisma.auditLog.findFirst({ where: { userId: admin.id, action: "admin.ai_model" }, orderBy: { createdAt: "desc" } });
    expect(log?.metadata).toMatchObject({ to: { provider: "local", model: "deepseek-r1:8b" }, unloaded: ["gemma4:latest"], loaded: true });

    // Not installed, embeddings only, or not a model name: refused, nothing unloaded.
    vi.mocked(switchLocalModel).mockClear();
    for (const model of ["mistral:7b", "embeddinggemma", "rm -rf /"]) {
      expect((await PUT(req("PUT", { provider: "local", model }), {} as never)).status).toBe(400);
    }
    expect((await testConnection(req("POST", { provider: "local", model: "mistral:7b" }, `${URL_}/test`), {} as never)).status).toBe(400);
    expect(switchLocalModel).not.toHaveBeenCalled();
  });

  it("shows what is in GPU memory and frees it on request, audited", async () => {
    signInAs(admin.id);
    expect(await (await gpuStatus(req("GET"), {} as never)).json()).toMatchObject({ ollamaReachable: true, loaded: [{ name: "deepseek-r1:8b" }] });
    const freed = await (await freeGpu(req("POST"), {} as never)).json();
    expect(freed).toMatchObject({ unloaded: [{ name: "gemma4:latest" }], stillLoaded: [], usedAfterMiB: 1_000 });
    const log = await prisma.auditLog.findFirst({ where: { userId: admin.id, action: "admin.gpu_clear" } });
    expect(log?.metadata).toMatchObject({ unloaded: ["gemma4:latest"] });
  });

  it("switches the model for the next generation, audited, without exposing the key", async () => {
    signInAs(admin.id);
    const res = await PUT(req("PUT", { provider: "gemini", model: "gemini-3.5-flash-lite" }), {} as never);
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).not.toContain("test-gemini-key-not-real");
    expect(JSON.parse(text)).toMatchObject({
      active: { provider: "gemini", model: "gemini-3.5-flash-lite", source: "admin" },
      geminiConfigured: true,
    });

    invalidateAiChoice(); // as another process would see it after the TTL
    expect(await getActiveAi()).toMatchObject({ provider: "gemini", model: "gemini-3.5-flash-lite" });

    const log = await prisma.auditLog.findFirst({ where: { userId: admin.id, action: "admin.ai_model" }, orderBy: { createdAt: "desc" } });
    expect(log?.metadata).toMatchObject({ to: { provider: "gemini", model: "gemini-3.5-flash-lite" } });

    expect((await PUT(req("PUT", { provider: "local" }), {} as never)).status).toBe(200);
    expect(await getActiveAi()).toMatchObject({ provider: "local", source: "admin" });
  });

  it("switches to GLM on Z.ai without exposing the key", async () => {
    signInAs(admin.id);
    const res = await PUT(req("PUT", { provider: "zai" }), {} as never);
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).not.toContain("zai-test-key-not-real");
    expect(JSON.parse(text)).toMatchObject({
      active: { provider: "zai", model: "glm-5.3-flash", source: "admin" },
      zai: { configured: true, label: "GLM-5.3-Flash" },
    });
    expect((await PUT(req("PUT", { provider: "local" }), {} as never)).status).toBe(200);
  });

  it("only accepts allow-listed models", async () => {
    signInAs(admin.id);
    for (const bad of [{ provider: "gemini", model: "gemini-4-argon" }, { provider: "openai" }, { provider: "gemini" }]) {
      expect((await PUT(req("PUT", bad), {} as never)).status).toBe(400);
    }
  });

  it("tests a connection with a content-free prompt and reports failures", async () => {
    signInAs(admin.id);
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(JSON.stringify({ error: { message: "API key not valid." } }), { status: 400 }));
    const res = await testConnection(req("POST", { provider: "gemini", model: "gemini-3.8-flash" }, `${URL_}/test`), {} as never);
    expect(await res.json()).toMatchObject({ ok: false, model: "gemini-3.8-flash", error: "Gemini error 400: API key not valid." });
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body.contents[0].parts[0].text).toMatch(/LearningForge/);
    fetchMock.mockRestore();
  });
});
