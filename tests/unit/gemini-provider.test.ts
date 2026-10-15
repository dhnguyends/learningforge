import { describe, it, expect, vi, afterEach } from "vitest";
import { z } from "zod";
import type { Env } from "@/lib/env";
import { GeminiGenerator, toGeminiSchema } from "@/lib/ai/gemini";
import { resolveAi } from "@/lib/ai/settings";
import { zodToJsonSchema } from "@/lib/ai/zod-to-json-schema";

const KEY = "test-gemini-key-not-real";

const env = (over: Partial<Env> = {}): Env =>
  ({
    AI_PROVIDER: "local",
    LOCAL_AI_MODEL: "gemma4:latest",
    AI_MODEL: "gpt-4o-mini",
    ANTHROPIC_MODEL: "claude",
    GEMINI_API_KEY: KEY,
    GEMINI_MODEL: "gemini-3.8-flash",
    GEMINI_BASE_URL: "https://gemini.test/v1beta",
    GEMINI_THINKING_LEVEL: "low",
    GEMINI_TIMEOUT_MS: 10_000,
    GEMINI_MAX_TOKENS: 16_384,
    ...over,
  }) as Env;

const answer = (text: string, extra: Record<string, unknown> = {}) =>
  new Response(
    JSON.stringify({
      candidates: [{ content: { parts: [{ text: "thinking…", thought: true }, { text }] }, finishReason: "STOP" }],
      usageMetadata: { promptTokenCount: 12, candidatesTokenCount: 5, thoughtsTokenCount: 3 },
      ...extra,
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );

const schema = z.object({ title: z.string().min(3).max(40), kind: z.literal("quiz"), note: z.string().nullable() });
const opts = { system: "sys", user: "user prompt", schema };

afterEach(() => vi.restoreAllMocks());

describe("toGeminiSchema", () => {
  it("maps keywords outside Gemini's JSON-Schema subset onto supported ones", () => {
    const out = toGeminiSchema(zodToJsonSchema(schema)) as {
      properties: Record<string, Record<string, unknown>>;
    };
    expect(out.properties.title).toEqual({ type: "string" }); // string lengths dropped
    expect(out.properties.kind).toEqual({ type: "string", enum: ["quiz"] }); // const → enum
    expect(out.properties.note).toEqual({ anyOf: [{ type: "string" }, { type: "null" }] }); // nullable → anyOf
    expect(toGeminiSchema({ type: "number", exclusiveMinimum: 0, exclusiveMaximum: 1 })).toEqual({ type: "number", minimum: 0, maximum: 1 });
  });

  it("keeps array bounds and recurses into items", () => {
    const s = zodToJsonSchema(z.object({ list: z.array(z.object({ q: z.string().min(1) })).min(2).max(4) }));
    expect(toGeminiSchema(s)).toMatchObject({
      properties: { list: { type: "array", minItems: 2, maxItems: 4, items: { properties: { q: { type: "string" } } } } },
    });
  });
});

describe("GeminiGenerator", () => {
  it("sends a schema-constrained request with the key in a header, never the URL", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(answer('{"title":"Ohm","kind":"quiz","note":null}'));
    const res = await new GeminiGenerator(env(), "gemini-3.5-flash-lite").generate(opts);

    expect(res).toMatchObject({ provider: "gemini", model: "gemini-3.5-flash-lite", data: { title: "Ohm", kind: "quiz", note: null } });
    expect(res.usage).toEqual({ inputTokens: 12, outputTokens: 8 }); // thoughts billed as output
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://gemini.test/v1beta/models/gemini-3.5-flash-lite:generateContent");
    expect(url).not.toContain(KEY);
    expect((init.headers as Record<string, string>)["x-goog-api-key"]).toBe(KEY);
    const body = JSON.parse(init.body as string);
    expect(body.generationConfig).toMatchObject({
      responseMimeType: "application/json",
      thinkingConfig: { thinkingLevel: "LOW" },
      maxOutputTokens: 16_384,
    });
    expect(body.generationConfig.responseJsonSchema.properties.kind).toEqual({ type: "string", enum: ["quiz"] });
    expect(body.systemInstruction.parts[0].text).toMatch(/^sys\n\nReturn ONLY/);
  });

  it("retries overload (503) answers, then succeeds", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response('{"error":{"message":"high demand"}}', { status: 503 }))
      .mockResolvedValueOnce(answer('{"title":"Ohm","kind":"quiz","note":"x"}'));
    const g = new GeminiGenerator(env());
    g.retryDelayMs = 0;
    await expect(g.generate(opts)).resolves.toMatchObject({ data: { note: "x" } });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("reports API errors with Google's message and without the key", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: { message: "API key not valid." } }), { status: 400 }),
    );
    const err = await new GeminiGenerator(env()).generate(opts).catch((e: Error) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toBe("Gemini error 400: API key not valid.");
    expect((err as Error).message).not.toContain(KEY);
  });

  it("asks for a concise answer again when the output was cut off", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: '{"title":"Oh' }] }, finishReason: "MAX_TOKENS" }] })),
      )
      .mockResolvedValueOnce(answer('{"title":"Ohm","kind":"quiz","note":null}'));
    await new GeminiGenerator(env()).generate(opts);
    const retry = JSON.parse((fetchMock.mock.calls[1][1] as RequestInit).body as string);
    expect(retry.contents.at(-1).parts[0].text).toMatch(/cut off/);
  });

  it("fails clearly without an API key, before any request", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    await expect(new GeminiGenerator(env({ GEMINI_API_KEY: "  " })).generate(opts)).rejects.toThrow(/GEMINI_API_KEY is not set/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("resolveAi (admin choice over the environment default)", () => {
  it("uses the environment default without a stored choice", () => {
    expect(resolveAi(null, env())).toEqual({ provider: "local", model: "gemma4:latest", source: "env" });
  });

  it("never overrides mock mode", () => {
    expect(resolveAi({ provider: "gemini", model: "gemini-3.8-flash" }, env({ AI_PROVIDER: "mock" }))).toMatchObject({ provider: "mock", source: "env" });
  });

  it("applies the stored choice", () => {
    expect(resolveAi({ provider: "gemini", model: "gemini-3.5-flash-lite" }, env())).toEqual({ provider: "gemini", model: "gemini-3.5-flash-lite", source: "admin" });
    expect(resolveAi({ provider: "local" }, env({ AI_PROVIDER: "gemini" }))).toEqual({ provider: "local", model: "gemma4:latest", source: "admin" });
  });

  it("falls back to the default when Gemini is chosen but no key is configured", () => {
    expect(resolveAi({ provider: "gemini", model: "gemini-3.8-flash" }, env({ GEMINI_API_KEY: undefined }))).toEqual({
      provider: "local",
      model: "gemma4:latest",
      source: "fallback",
    });
  });
});
