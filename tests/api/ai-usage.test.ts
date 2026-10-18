import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import "./helpers";
import { prisma, createTestUser, disposeTestUser, signInAs, jsonRequest, type TestUser } from "./helpers";
import { z } from "zod";

/**
 * Every AI call is recorded with its course: generations (through the
 * generator wrapper), Azure AI Translator characters; a course shows its
 * cost, Admin › Courses the cost of each course; Azure's free tier is
 * watched and a switch to a local model suggested. The rows and the quota
 * note this test writes are removed, so the live monthly Azure count is not
 * touched.
 */
const ai = vi.hoisted(() => ({ current: { provider: "zai", model: "glm-5.3-flash", source: "admin" } as { provider: string; model: string; source: string } }));
vi.hoisted(() => {
  process.env.AZURE_TRANSLATOR_KEY = "azure-translator-key-not-real";
  process.env.AZURE_TRANSLATOR_FREE_CHARS = "1000";
});
vi.mock("@/lib/ai/settings", async (orig) => ({
  ...(await orig<typeof import("@/lib/ai/settings")>()),
  getActiveAi: vi.fn(async () => ai.current),
}));

import { withAiUsage } from "@/lib/ai/usage";
import { recordingUsage } from "@/lib/ai";
import { AzureTranslator } from "@/lib/translation";
import { azureTranslatorQuota } from "@/lib/speech/translator-quota";
import { GET as courseCost } from "@/app/api/study-sets/[studySetId]/ai-usage/route";
import { GET as adminSets } from "@/app/api/admin/study-sets/route";
import type { StructuredGenerator } from "@/lib/ai/types";

let me: TestUser;
let other: TestUser;
let admin: TestUser;
let studySetId: string;
let savedNote: { value: unknown } | null = null;
const fakeGlm: StructuredGenerator = {
  provider: "zai",
  model: "glm-5.3-flash",
  generate: async () => ({ data: { ok: true } as never, provider: "zai", model: "glm-5.3-flash", usage: { inputTokens: 21_000, outputTokens: 6_000 } }),
};

beforeAll(async () => {
  savedNote = await prisma.appSetting.findUnique({ where: { key: "translator_quota" }, select: { value: true } });
  me = await createTestUser("Cost owner");
  other = await createTestUser("Cost outsider");
  admin = await createTestUser("Cost admin");
  await prisma.user.update({ where: { id: admin.id }, data: { role: "ADMIN", nature: "HUMAN" } });
  studySetId = (await prisma.studySet.create({ data: { workspaceId: me.workspaceId, createdById: me.id, title: "Costed course" } })).id;
});

afterAll(async () => {
  await prisma.aiUsage.deleteMany({ where: { studySetId } });
  if (savedNote) await prisma.appSetting.update({ where: { key: "translator_quota" }, data: { value: savedNote.value as object } });
  else await prisma.appSetting.deleteMany({ where: { key: "translator_quota" } });
  for (const u of [me, other, admin]) await disposeTestUser(u.email);
  await prisma.$disconnect();
});

describe("recording AI usage", () => {
  it("records each generation with its course and feature", async () => {
    const gen = recordingUsage(fakeGlm);
    await withAiUsage({ studySetId, feature: "quiz" }, () => gen.generate({ system: "s", user: "u", schema: z.any() }));
    await withAiUsage({ studySetId }, () => gen.generate({ system: "s", user: "u", schema: z.any(), feature: "guide" }));
    const rows = await prisma.aiUsage.findMany({ where: { studySetId }, orderBy: { createdAt: "asc" } });
    expect(rows.map((r) => [r.feature, r.provider, r.model, r.inputTokens, r.outputTokens])).toEqual([
      ["quiz", "zai", "glm-5.3-flash", 21_000, 6_000],
      ["guide", "zai", "glm-5.3-flash", 21_000, 6_000],
    ]);
  });

  it("records Azure characters, and notes a quota refusal", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify([{ translations: [{ text: "Hello" }] }, { translations: [{ text: "World" }] }]), { status: 200 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: { code: 403001, message: "The operation is not allowed because the subscription has exceeded its free quota." } }), { status: 403 }),
      );
    const t = new AzureTranslator();
    await withAiUsage({ studySetId, feature: "translation" }, () => t.translate(["Bonjour", "le monde"], "fr", "en"));
    const azure = await prisma.aiUsage.findFirstOrThrow({ where: { studySetId, provider: "azure-translator" } });
    expect(azure).toMatchObject({ characters: "Bonjour".length + "le monde".length, inputTokens: 0, feature: "translation" });

    await expect(withAiUsage({ studySetId }, () => t.translate(["Encore"], "fr", "en"))).rejects.toThrow(/403/);
    fetchMock.mockRestore();
    const quota = await azureTranslatorQuota();
    expect(quota.level).toBe("reached");
    expect(quota.refusedAt).not.toBeNull();
  });

  it("suggests Gemma 4 E2B, or the AI model's own local model (one model on the GPU)", async () => {
    ai.current = { provider: "zai", model: "glm-5.3-flash", source: "admin" };
    expect((await azureTranslatorQuota()).suggestion).toEqual({ model: "gemma4:e2b", label: "Gemma 4 E2B", note: null });
    ai.current = { provider: "local", model: "gemma4:12b-it-q4_K_M", source: "admin" };
    const s = (await azureTranslatorQuota()).suggestion;
    expect(s.model).toBe("gemma4:12b-it-q4_K_M");
    expect(s.note).toMatch(/cannot translate while the AI model is Gemma 4 12B Q4_K_M/);
    ai.current = { provider: "zai", model: "glm-5.3-flash", source: "admin" };
  });
});

describe("course AI cost", () => {
  it("shows the course's cost to its owner, not to others", async () => {
    signInAs(me.id);
    const cost = await (await courseCost(jsonRequest("http://localhost/x", "GET"), { params: { studySetId } })).json();
    expect(cost).toMatchObject({ calls: 3, inputTokens: 42_000, outputTokens: 12_000, characters: 15, zaiCredits: 10 });
    expect(cost.byFeature.map((f: { feature: string }) => f.feature).sort()).toEqual(["guide", "quiz", "translation"]);
    signInAs(other.id);
    expect((await courseCost(jsonRequest("http://localhost/x", "GET"), { params: { studySetId } })).status).toBe(403);
  });

  it("gives each course's cost in Admin › Courses", async () => {
    signInAs(admin.id);
    const { studySets } = await (await adminSets(jsonRequest("http://localhost/x", "GET"), {} as never)).json();
    expect(studySets.find((s: { id: string }) => s.id === studySetId).aiCost).toEqual({ calls: 3, tokens: 54_000, characters: 15, zaiCredits: 10 });
  });
});
