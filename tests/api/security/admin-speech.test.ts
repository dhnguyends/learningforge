import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import "../helpers";
import { prisma, createTestUser, disposeTestUser, signInAs, type TestUser } from "../helpers";
import { NextRequest } from "next/server";
import { GET as getTranslator, PUT as putTranslator } from "@/app/api/admin/translator/route";
import { POST as testTranslator } from "@/app/api/admin/translator/test/route";
import { GET as getTts, PUT as putTts } from "@/app/api/admin/tts/route";
import { POST as testTts } from "@/app/api/admin/tts/test/route";
import { getActiveTts } from "@/lib/speech/settings";

/**
 * Admin translator and read-aloud selectors: ADMIN only, cloud choices need
 * their key in the server environment, voices must belong to the model,
 * changes are audited, and no key is ever returned.
 */
vi.hoisted(() => {
  process.env.AZURE_SPEECH_KEY = ""; // blank, not deleted: Prisma loads .env later and would restore real keys
  process.env.AZURE_TRANSLATOR_KEY = ""; // blank, not deleted: Prisma loads .env later and would restore real keys
  process.env.AZ_API_KEY1 = ""; // blank, not deleted: Prisma loads .env later and would restore real keys
  process.env.AZ_API_KEY2 = ""; // blank, not deleted: Prisma loads .env later and would restore real keys
  process.env.GEMINI_API_KEY = "test-gemini-key-not-real";
});

// Never ask the developer's real Ollama: the installed models are faked.
vi.mock("@/lib/ai/ollama", async (orig) => ({
  ...(await orig<typeof import("@/lib/ai/ollama")>()),
  installedModels: vi.fn(async () => [
    { name: "gemma4:latest", label: "Gemma 4", parameterSize: "7.5B", sizeBytes: 6e9, capabilities: ["completion"], generation: true },
  ]),
  clearOllamaGpu: vi.fn(async () => ({ unloaded: [], stillLoaded: [], usedBeforeMiB: null, usedAfterMiB: null, totalMiB: null })),
}));

// The AI model is in the cloud here, so any installed local model may translate
// (whatever AI model the developer chose live).
vi.mock("@/lib/ai/settings", async (orig) => ({
  ...(await orig<typeof import("@/lib/ai/settings")>()),
  getActiveAi: vi.fn(async () => ({ provider: "gemini", model: "gemini-3.8-flash", source: "admin" })),
}));

const req = (method: "GET" | "PUT" | "POST", body?: unknown) =>
  new NextRequest("http://localhost/api/admin/x", {
    method,
    ...(body === undefined ? {} : { body: JSON.stringify(body), headers: { "content-type": "application/json" } }),
  });

let admin: TestUser;
let user: TestUser;
const saved = new Map<string, { value: unknown; updatedById: string | null }>();

beforeAll(async () => {
  for (const key of ["translator", "tts"]) {
    const row = await prisma.appSetting.findUnique({ where: { key }, select: { value: true, updatedById: true } });
    if (row) saved.set(key, row);
  }
  admin = await createTestUser("Speech admin");
  await prisma.user.update({ where: { id: admin.id }, data: { role: "ADMIN", nature: "HUMAN" } });
  user = await createTestUser("Speech plain user");
});

afterAll(async () => {
  for (const key of ["translator", "tts"]) {
    // Restore only what this test changed: keep a choice someone saved meanwhile.
    const current = await prisma.appSetting.findUnique({ where: { key }, select: { updatedById: true } });
    if (current && current.updatedById !== admin.id) continue;
    const row = saved.get(key);
    if (row) await prisma.appSetting.update({ where: { key }, data: { value: row.value as object, updatedById: row.updatedById } });
    else await prisma.appSetting.deleteMany({ where: { key } });
  }
  await prisma.auditLog.deleteMany({ where: { userId: admin.id } });
  await disposeTestUser(admin.email);
  await disposeTestUser(user.email);
  await prisma.$disconnect();
});

describe("admin translator and text-to-speech", () => {
  it("is closed to anonymous and non-admin callers", async () => {
    signInAs(null);
    expect((await getTts(req("GET"), {} as never)).status).toBe(401);
    signInAs(user.id);
    expect((await getTranslator(req("GET"), {} as never)).status).toBe(403);
    expect((await putTranslator(req("PUT", { provider: "local" }), {} as never)).status).toBe(403);
    expect((await testTranslator(req("POST", { provider: "local" }), {} as never)).status).toBe(403);
    expect((await putTts(req("PUT", { provider: "kokoro", voices: { en: "af_heart", fr: "ff_siwis" } }), {} as never)).status).toBe(403);
    expect((await testTts(req("POST", { choice: { provider: "kokoro", voices: { en: "af_heart", fr: "ff_siwis" } }, lang: "fr" }), {} as never)).status).toBe(403);
  });

  it("lists the options and which need a key, without any key", async () => {
    signInAs(admin.id);
    const res = await getTts(req("GET"), {} as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.translator.options.map((o: { id: string }) => o.id)).toEqual(["local:gemma4:latest", "azure"]);
    expect(body.translator.options.find((o: { id: string }) => o.id === "azure")).toMatchObject({ configured: false, missingKey: "AZURE_TRANSLATOR_KEY" });
    expect(body.tts.options.map((o: { id: string }) => o.id)).toEqual(["kokoro", "piper", "azure", "gemini"]);
    expect(body.tts.options.find((o: { id: string }) => o.id === "gemini")).toMatchObject({ configured: true });
    expect(JSON.stringify(body)).not.toContain("test-gemini-key-not-real");
  });

  it("refuses cloud choices whose key is missing", async () => {
    signInAs(admin.id);
    expect((await putTranslator(req("PUT", { provider: "azure" }), {} as never)).status).toBe(400);
    expect((await putTts(req("PUT", { provider: "azure", voices: { en: "en-US-JennyNeural", fr: "fr-FR-DeniseNeural" } }), {} as never)).status).toBe(400);
    expect((await testTranslator(req("POST", { provider: "azure" }), {} as never)).status).toBe(400);
  });

  it("refuses voices that do not belong to the model", async () => {
    signInAs(admin.id);
    expect((await putTts(req("PUT", { provider: "piper", voices: { en: "af_heart", fr: "siwis" } }), {} as never)).status).toBe(400);
  });

  it("saves the read-aloud model and voices, audited", async () => {
    signInAs(admin.id);
    const res = await putTts(req("PUT", { provider: "piper", voices: { en: "ryan", fr: "tom" } }), {} as never);
    expect(res.status).toBe(200);
    expect((await res.json()).tts.active).toMatchObject({ provider: "piper", voices: { en: "ryan", fr: "tom" }, source: "admin" });
    expect(await getActiveTts()).toMatchObject({ provider: "piper", voices: { en: "ryan", fr: "tom" } });
    expect(await prisma.auditLog.count({ where: { userId: admin.id, action: "admin.tts_model" } })).toBe(1);

    expect((await putTranslator(req("PUT", { provider: "local" }), {} as never)).status).toBe(200);
    expect(await prisma.auditLog.count({ where: { userId: admin.id, action: "admin.translator_model" } })).toBe(1);
  });
});
