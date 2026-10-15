import { describe, it, expect, vi, afterEach } from "vitest";
import { z } from "zod";
import type { Env } from "@/lib/env";
import { ZaiGenerator, describeLimits, fitToSchema } from "@/lib/ai/zai";
import { zodToJsonSchema } from "@/lib/ai/zod-to-json-schema";
import { aiLabel, glmLabel, resolveAi } from "@/lib/ai/settings";

const KEY = "0123456789abcdef0123456789abcdef.testKeyNotReal1";

const env = (over: Partial<Env> = {}): Env =>
  ({
    AI_PROVIDER: "gemini",
    LOCAL_AI_MODEL: "gemma4:latest",
    GEMINI_API_KEY: "g",
    GEMINI_MODEL: "gemini-3.8-flash",
    ZAI_API_KEY: KEY,
    GLM_AI_MODEL: "GLM-5.3-Flash",
    ZAI_BASE_URL: "https://api.z.test/api/coding/paas/v4",
    ZAI_REASONING_EFFORT: "low",
    ZAI_TIMEOUT_MS: 10_000,
    ZAI_ATTEMPT_TIMEOUT_MS: 10_000,
    ZAI_MAX_TOKENS: 16_384,
    ...over,
  }) as Env;

const completion = (content: string, finish = "stop") =>
  new Response(
    JSON.stringify({ choices: [{ message: { content, reasoning_content: "thinking" }, finish_reason: finish }], usage: { prompt_tokens: 32, completion_tokens: 26 } }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
const zaiError = (status: number, code: string, message: string) =>
  new Response(JSON.stringify({ error: { code, message } }), { status });

const schema = z.object({ title: z.string(), kind: z.literal("quiz") });
const opts = { system: "sys", user: "user prompt", schema };
const good = '{"title":"Ohm","kind":"quiz"}';

afterEach(() => vi.restoreAllMocks());

describe("ZaiGenerator (GLM served by Z.ai)", () => {
  it("calls Z.ai chat completions in JSON mode with low reasoning effort and the schema in the prompt", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(completion(good));
    const res = await new ZaiGenerator(env()).generate(opts);

    expect(res).toMatchObject({ provider: "zai", model: "glm-5.3-flash", data: { title: "Ohm", kind: "quiz" }, usage: { inputTokens: 32, outputTokens: 26 } });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.z.test/api/coding/paas/v4/chat/completions");
    expect(url).not.toContain(KEY);
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${KEY}`);
    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({
      model: "glm-5.3-flash", // Z.ai model codes are lower-case
      reasoning_effort: "low",
      response_format: { type: "json_object" },
      max_tokens: 16_384,
      stream: false,
    });
    expect(body.messages[1].content).toMatch(/must conform to this JSON Schema/);
  });

  it("does not retry an empty balance (429 code 1113) and says how to fix it", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async () => zaiError(429, "1113", "Insufficient balance or no resource package. Please recharge."));
    const err = (await new ZaiGenerator(env()).generate(opts).catch((e: Error) => e)) as Error;
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(err.message).toMatch(/error 429: Insufficient balance.*recharge it, or set ZAI_BASE_URL.*coding\/paas\/v4/);
    expect(err.message).not.toContain(KEY);
  });

  it("retries a rate-limited request, then succeeds", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(zaiError(429, "1302", "Rate limit reached"))
      .mockResolvedValueOnce(completion(good));
    const g = new ZaiGenerator(env());
    g.retryDelayMs = 0;
    await expect(g.generate(opts)).resolves.toMatchObject({ data: { kind: "quiz" } });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("reports a rejected key clearly", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(zaiError(401, "1000", "Authentication failed"));
    await expect(new ZaiGenerator(env()).generate(opts)).rejects.toThrow(/error 401: Authentication failed — check ZAI_API_KEY/);
  });

  it("ignores inline <think> blocks", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(completion(`<think>plan…</think>${good}`));
    await expect(new ZaiGenerator(env()).generate(opts)).resolves.toMatchObject({ data: { title: "Ohm" } });
  });

  it("asks for a concise answer again when the output hit the token cap", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(completion('{"title":"Oh', "length"))
      .mockResolvedValueOnce(completion(good));
    await new ZaiGenerator(env()).generate(opts);
    const retry = JSON.parse((fetchMock.mock.calls[1][1] as RequestInit).body as string);
    expect(retry.messages.at(-1).content).toMatch(/cut off/);
  });

  it("fails clearly without ZAI_API_KEY, before any request", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    await expect(new ZaiGenerator(env({ ZAI_API_KEY: " " })).generate(opts)).rejects.toThrow(/ZAI_API_KEY is not set/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("fitting GLM output to schema limits (no constrained decoding on Z.ai)", () => {
  const outline = z.object({
    title: z.string().max(40),
    sections: z.array(z.object({ title: z.string().max(20), chunkIds: z.array(z.string()) })).min(1).max(2),
  });
  const json = zodToJsonSchema(outline);

  it("states the limits in plain words", () => {
    expect(describeLimits(json)).toEqual([
      "title: at most 40 characters",
      "sections: 1 to 2 items",
      "sections[].title: at most 20 characters",
    ]);
  });

  it("trims extra items and over-long strings so the rest of the answer validates", () => {
    const raw = JSON.stringify({
      title: "Technical analysis for intraday momentum traders",
      sections: [
        { title: "Anatomy of a Japanese candlestick", chunkIds: ["a"] },
        { title: "VWAP", chunkIds: ["b"] },
        { title: "One section too many", chunkIds: ["c"] },
      ],
    });
    const fitted = JSON.parse(fitToSchema(raw, json));
    expect(outline.safeParse(fitted).success).toBe(true);
    expect(fitted.sections).toHaveLength(2);
    expect(fitted.sections[0].title).toBe("Anatomy of a…");
    expect(fitted.sections[1]).toEqual({ title: "VWAP", chunkIds: ["b"] });
  });

  it("leaves non-JSON text for the repair round", () => {
    expect(fitToSchema("not json", json)).toBe("not json");
  });

  it("sends the limits with the request", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(completion('{"title":"t","sections":[{"title":"s","chunkIds":[]}]}'));
    await new ZaiGenerator(env()).generate({ system: "s", user: "u", schema: outline });
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body.messages[1].content).toMatch(/Hard limits[\s\S]*sections: 1 to 2 items/);
  });
});

describe("GLM (Z.ai) in the model selection", () => {
  it("applies an admin choice of GLM with GLM_AI_MODEL, lower-cased", () => {
    expect(resolveAi({ provider: "zai" }, env())).toEqual({ provider: "zai", model: "glm-5.3-flash", source: "admin" });
  });

  it("falls back to the default when ZAI_API_KEY is missing", () => {
    expect(resolveAi({ provider: "zai" }, env({ ZAI_API_KEY: undefined }))).toMatchObject({ provider: "gemini", source: "fallback" });
  });

  it("can be the environment default", () => {
    expect(resolveAi(null, env({ AI_PROVIDER: "zai" }))).toEqual({ provider: "zai", model: "glm-5.3-flash", source: "env" });
    expect(resolveAi(null, env({ AI_PROVIDER: "zai", ZAI_API_KEY: "" }))).toMatchObject({ provider: "local", source: "fallback" });
  });

  it("labels the model for the top bar", () => {
    expect(glmLabel("glm-5.3-flash")).toBe("GLM-5.3-Flash");
    expect(glmLabel("glm-5.3")).toBe("GLM-5.3");
    expect(aiLabel({ provider: "zai", model: "glm-5.3-flash" })).toBe("GLM-5.3-Flash");
  });
});
