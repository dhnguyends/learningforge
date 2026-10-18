import { describe, it, expect } from "vitest";
import { z } from "zod";
import { summarizeAiUsage, zaiCredits } from "@/lib/ai/usage";
import { isQuotaRefusal, quotaLevel } from "@/lib/speech/translator-quota";
import { parseWithRepair } from "@/lib/ai/shared";

/** The cost of a course, Azure's free tier, and what counts as a call's tokens. */
const at = new Date("2026-10-18T05:00:00Z");

describe("course AI cost", () => {
  it("adds up tokens, Azure characters and Z.ai credits, by feature and by model", () => {
    const cost = summarizeAiUsage(
      [
        { feature: "guide", provider: "zai", model: "glm-5.3-flash", inputTokens: 40_000, outputTokens: 5_000, createdAt: at },
        { feature: "guide", provider: "zai", model: "glm-5.3-flash", inputTokens: 4_000, outputTokens: 1_000, createdAt: at },
        { feature: "quiz", provider: "local", model: "gemma4:latest", inputTokens: 6_000, outputTokens: 2_000, createdAt: at },
        { feature: "translation", provider: "azure-translator", model: "text-translation", inputTokens: 0, outputTokens: 0, characters: 45_000, createdAt: at },
      ],
      5_000,
    );
    expect(cost).toMatchObject({ calls: 4, inputTokens: 50_000, outputTokens: 8_000, characters: 45_000, zaiCredits: 10, tokensPerCredit: 5_000 });
    expect(cost.byFeature[0]).toEqual({ feature: "guide", calls: 2, tokens: 50_000, characters: 0 });
    expect(cost.byFeature.find((f) => f.feature === "translation")).toEqual({ feature: "translation", calls: 1, tokens: 0, characters: 45_000 });
    expect(cost.byModel.find((m) => m.model === "glm-5.3-flash")).toMatchObject({ calls: 2, tokens: 50_000, zaiCredits: 10 });
    expect(cost.byModel.find((m) => m.model === "gemma4:latest")?.zaiCredits).toBeNull();
    expect(cost.since).toBe(at.toISOString());
  });

  it("has no Z.ai credits without GLM calls, and nothing for an untouched course", () => {
    expect(summarizeAiUsage([{ feature: "quiz", provider: "gemini", model: "gemini-3.8-flash", inputTokens: 10, outputTokens: 5, createdAt: at }]).zaiCredits).toBeNull();
    expect(summarizeAiUsage([])).toMatchObject({ calls: 0, inputTokens: 0, characters: 0, since: null, zaiCredits: null, byFeature: [] });
    expect(zaiCredits(27_000, 5_400)).toBe(5);
  });
});

describe("Azure AI Translator free tier", () => {
  it("warns from 80 % and stops at the limit or after a refusal", () => {
    expect(quotaLevel(1_000_000, 2_000_000, false)).toBe("ok");
    expect(quotaLevel(1_600_000, 2_000_000, false)).toBe("near");
    expect(quotaLevel(2_000_000, 2_000_000, false)).toBe("reached");
    expect(quotaLevel(10, 2_000_000, true)).toBe("reached");
  });

  it("recognizes Azure's quota refusals only", () => {
    expect(isQuotaRefusal(403, "The operation is not allowed because the subscription has exceeded its free quota.")).toBe(true);
    expect(isQuotaRefusal(403, "403001")).toBe(true);
    expect(isQuotaRefusal(429, "Out of call volume quota")).toBe(true);
    expect(isQuotaRefusal(401, "Access denied due to invalid subscription key")).toBe(false);
    expect(isQuotaRefusal(403, "Forbidden region")).toBe(false);
  });
});

describe("tokens of a generation", () => {
  it("count the repair round too", async () => {
    const schema = z.object({ a: z.number() });
    const out = await parseWithRepair(
      { text: '{"a": "not a number"}', usage: { inputTokens: 100, outputTokens: 20 } },
      schema,
      async () => ({ text: '{"a": 1}', usage: { inputTokens: 130, outputTokens: 10 } }),
    );
    expect(out).toEqual({ data: { a: 1 }, usage: { inputTokens: 230, outputTokens: 30 } });
  });
});
