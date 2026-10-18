import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import "../helpers";
import { prisma, createTestUser, disposeTestUser, signInAs, type TestUser } from "../helpers";
import { NextRequest } from "next/server";

/**
 * Local translator models (Gemma 4, DeepSeek-R1…) and the one-model rule:
 * while the AI model is local, a local translator must use that same model
 * (else the GPU would unload one for the other at every translation); Azure
 * stays possible. With a cloud AI model, any installed local model may
 * translate. Ollama and the active AI model are faked; the live translator
 * setting is restored afterwards.
 */
const ai = vi.hoisted(() => ({ current: { provider: "local", model: "gemma4:latest", source: "admin" } as { provider: string; model: string; source: string } }));

vi.hoisted(() => {
  process.env.AZURE_TRANSLATOR_KEY = "azure-translator-key-not-real";
  process.env.AI_PROVIDER = "local"; // not the offline demo, where nothing is released
});

vi.mock("@/lib/ai/ollama", async (orig) => ({
  ...(await orig<typeof import("@/lib/ai/ollama")>()),
  installedModels: vi.fn(async () => [
    { name: "deepseek-r1:8b", label: "DeepSeek-R1 8B", parameterSize: "8.2B", sizeBytes: 5e9, capabilities: ["completion", "thinking"], generation: true },
    { name: "embeddinggemma:latest", label: "embeddinggemma:latest", parameterSize: null, sizeBytes: 6e8, capabilities: ["embedding"], generation: false },
    { name: "gemma4:latest", label: "Gemma 4", parameterSize: "7.5B", sizeBytes: 6e9, capabilities: ["completion"], generation: true },
  ]),
  // Never unload the developer's real models.
  clearOllamaGpu: vi.fn(async () => ({ unloaded: [{ name: "gemma4:latest", vramBytes: 6e9, sizeBytes: 6e9 }], stillLoaded: [], usedBeforeMiB: 7_000, usedAfterMiB: 1_200, totalMiB: 11_264 })),
}));
vi.mock("@/lib/ai/settings", async (orig) => ({
  ...(await orig<typeof import("@/lib/ai/settings")>()),
  getActiveAi: vi.fn(async () => ai.current),
}));

import { GET as getSettings, PUT as putTranslator } from "@/app/api/admin/translator/route";
import { POST as testTranslator } from "@/app/api/admin/translator/test/route";
import { getActiveTranslator, getStoredTranslatorChoice, invalidateSpeechSettings, saveTranslatorChoice, translatorFollowsAiModel } from "@/lib/speech/settings";
import { clearOllamaGpu } from "@/lib/ai/ollama";

const req = (method: "GET" | "PUT" | "POST", body?: unknown) =>
  new NextRequest("http://localhost/api/admin/translator", {
    method,
    ...(body === undefined ? {} : { body: JSON.stringify(body), headers: { "content-type": "application/json" } }),
  });

let admin: TestUser;
let saved: { value: unknown; updatedById: string | null } | null = null;

beforeAll(async () => {
  saved = await prisma.appSetting.findUnique({ where: { key: "translator" }, select: { value: true, updatedById: true } });
  admin = await createTestUser("Translator admin");
  await prisma.user.update({ where: { id: admin.id }, data: { role: "ADMIN", nature: "HUMAN" } });
});

afterAll(async () => {
  const current = await prisma.appSetting.findUnique({ where: { key: "translator" }, select: { updatedById: true } });
  if (current && current.updatedById === admin.id) {
    if (saved) await prisma.appSetting.update({ where: { key: "translator" }, data: { value: saved.value as object, updatedById: saved.updatedById } });
    else await prisma.appSetting.deleteMany({ where: { key: "translator" } });
  }
  invalidateSpeechSettings();
  await prisma.auditLog.deleteMany({ where: { userId: admin.id } });
  await disposeTestUser(admin.email);
  await prisma.$disconnect();
});

beforeEach(() => {
  ai.current = { provider: "local", model: "gemma4:latest", source: "admin" };
  vi.mocked(clearOllamaGpu).mockClear();
});

describe("local translator models", () => {
  it("offers every local chat model and Azure, other local models blocked while the AI model is local", async () => {
    signInAs(admin.id);
    const body = await (await getSettings(req("GET"), {} as never)).json();
    expect(body.translator.aiLocalModel).toBe("gemma4:latest");
    const options = body.translator.options as { id: string; model: string | null; blockedBy: string | null; configured: boolean }[];
    expect(options.map((o) => o.id)).toEqual(["local:deepseek-r1:8b", "local:gemma4:latest", "azure"]);
    expect(options.find((o) => o.id === "local:deepseek-r1:8b")?.blockedBy).toMatch(/AI model is Gemma 4/);
    expect(options.find((o) => o.id === "local:gemma4:latest")?.blockedBy).toBeNull();
    expect(options.find((o) => o.id === "azure")).toMatchObject({ blockedBy: null, configured: true });
    expect(JSON.stringify(body)).not.toContain("azure-translator-key-not-real");
  });

  it("refuses another local model than the AI model's, accepts the same one or Azure", async () => {
    signInAs(admin.id);
    const refused = await putTranslator(req("PUT", { provider: "local", model: "deepseek-r1:8b" }), {} as never);
    expect(refused.status).toBe(400);
    expect((await refused.json()).error).toMatch(/must use the same model/);
    expect((await testTranslator(req("POST", { provider: "local", model: "deepseek-r1:8b" }), {} as never)).status).toBe(400);

    expect((await putTranslator(req("PUT", { provider: "local", model: "gemma4:latest" }), {} as never)).status).toBe(200);
    expect(await getStoredTranslatorChoice()).toEqual({ provider: "local", model: "gemma4:latest" });
    // No model given: the AI model's.
    expect((await putTranslator(req("PUT", { provider: "local" }), {} as never)).status).toBe(200);
    expect(await getStoredTranslatorChoice()).toEqual({ provider: "local", model: "gemma4:latest" });

    expect((await putTranslator(req("PUT", { provider: "azure" }), {} as never)).status).toBe(200);
    expect(await getActiveTranslator()).toMatchObject({ provider: "azure", model: null });
  });

  it("with a cloud AI model, any installed local model may translate", async () => {
    signInAs(admin.id);
    ai.current = { provider: "gemini", model: "gemini-3.8-flash", source: "admin" };
    expect((await putTranslator(req("PUT", { provider: "local", model: "deepseek-r1:8b" }), {} as never)).status).toBe(200);
    expect(await getActiveTranslator()).toMatchObject({ provider: "local", model: "deepseek-r1:8b" });
    // Not installed, or embeddings only: refused.
    expect((await putTranslator(req("PUT", { provider: "local", model: "mistral:7b" }), {} as never)).status).toBe(400);
    expect((await putTranslator(req("PUT", { provider: "local", model: "embeddinggemma" }), {} as never)).status).toBe(400);
  });

  it("frees the GPU when neither the AI model nor the translator needs a local model", async () => {
    signInAs(admin.id);
    // Local AI model: it stays, nothing is unloaded.
    await putTranslator(req("PUT", { provider: "azure" }), {} as never);
    expect(clearOllamaGpu).not.toHaveBeenCalled();

    // Cloud AI model and Azure: every language model goes (embeddings stay).
    ai.current = { provider: "zai", model: "glm-5.3-flash", source: "admin" };
    const body = await (await putTranslator(req("PUT", { provider: "azure" }), {} as never)).json();
    expect(clearOllamaGpu).toHaveBeenLastCalledWith({ keep: undefined, keepEmbeddings: true });
    expect(body.gpuFreed).toMatchObject({ unloaded: [{ name: "gemma4:latest" }], usedAfterMiB: 1_200 });

    // Cloud AI model, local translator: its model stays, the others go.
    await putTranslator(req("PUT", { provider: "local", model: "deepseek-r1:8b" }), {} as never);
    expect(clearOllamaGpu).toHaveBeenLastCalledWith({ keep: "deepseek-r1:8b", keepEmbeddings: true });
  });

  it("runs the AI model's local model even when another one is stored, and follows an AI model change", async () => {
    signInAs(admin.id);
    await saveTranslatorChoice({ provider: "local", model: "deepseek-r1:8b" }, admin.id);
    // The AI model is Gemma 4: translation uses Gemma 4, never a second model.
    expect(await getActiveTranslator()).toMatchObject({ provider: "local", model: "gemma4:latest" });

    expect(await translatorFollowsAiModel("gemma4:latest", admin.id)).toEqual({ from: "deepseek-r1:8b", to: "gemma4:latest" });
    expect(await getStoredTranslatorChoice()).toEqual({ provider: "local", model: "gemma4:latest" });
    expect(await translatorFollowsAiModel("gemma4", admin.id)).toBeNull(); // same model

    await saveTranslatorChoice({ provider: "azure" }, admin.id);
    expect(await translatorFollowsAiModel("deepseek-r1:8b", admin.id)).toBeNull();
  });
});
