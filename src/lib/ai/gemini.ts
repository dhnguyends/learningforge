import type { ZodTypeAny } from "zod";
import type { Env } from "@/lib/env";
import type { GenerateOptions, GenerationResult, StructuredGenerator } from "@/lib/ai/types";
import { AIProviderError, JSON_CONTRACT_INSTRUCTION } from "@/lib/ai/types";
import { parseWithRepair, type RawCompletion } from "@/lib/ai/shared";
import { zodToJsonSchema } from "@/lib/ai/zod-to-json-schema";

interface GeminiPart {
  text?: string;
  thought?: boolean;
}

interface GeminiResponse {
  candidates?: { content?: { parts?: GeminiPart[] }; finishReason?: string }[];
  promptFeedback?: { blockReason?: string };
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number };
}

type GeminiContent = { role: "user" | "model"; parts: { text: string }[] };

type JsonSchema = Record<string, unknown>;

/**
 * Gemini accepts a subset of JSON Schema for structured output
 * (`responseJsonSchema`): no string lengths, `const`, exclusive bounds or the
 * OpenAPI-style `nullable`. Map those onto supported keywords, or drop them —
 * the caller's Zod schema still validates (and repairs) every response.
 */
export function toGeminiSchema(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(toGeminiSchema);
  if (!schema || typeof schema !== "object") return schema;
  const out: JsonSchema = {};
  let nullable = false;
  for (const [key, value] of Object.entries(schema as JsonSchema)) {
    switch (key) {
      case "minLength":
      case "maxLength":
        break;
      case "const":
        out.enum = [value];
        break;
      case "exclusiveMinimum":
        out.minimum = value;
        break;
      case "exclusiveMaximum":
        out.maximum = value;
        break;
      case "nullable":
        nullable = value === true;
        break;
      case "properties":
        out.properties = Object.fromEntries(
          Object.entries(value as JsonSchema).map(([k, v]) => [k, toGeminiSchema(v)]),
        );
        break;
      case "items":
      case "additionalProperties":
      case "anyOf":
        out[key] = toGeminiSchema(value);
        break;
      default:
        out[key] = value;
    }
  }
  return nullable ? { anyOf: [out, { type: "null" }] } : out;
}

/**
 * Google Gemini API (`models.generateContent`) with schema-constrained JSON
 * output. Cloud provider: the prompt — including retrieved source excerpts —
 * leaves this machine, which is why it is an explicit administrator choice.
 *
 * - The API key is sent in a header, never in the URL, and never appears in
 *   error messages.
 * - Thought parts (if any are returned) are ignored; only answer text is parsed.
 * - A response cut off at the output cap gets a "be more concise" repair
 *   round, like the local adapter.
 * - Availability: Flash models answer 503 "high demand" — or simply hang — at
 *   peak times. Each attempt has its own timeout, overload answers are retried
 *   with backoff, and if the model stays unavailable the call fails over to
 *   GEMINI_FALLBACK_MODEL (then keeps using it for a few minutes, so a
 *   15-section guide does not wait out the outage on every section).
 */
export class GeminiGenerator implements StructuredGenerator {
  readonly provider = "gemini";
  readonly model: string;
  private apiKey: string;
  private baseUrl: string;
  private thinkingLevel: string;
  private timeoutMs: number;
  private attemptTimeoutMs: number;
  private maxTokens: number;
  private fallbackModel: string | null;
  private maxRetries = 2;
  /** Until when the primary model is skipped after a failover. */
  private degradedUntil = 0;
  /** First backoff delay; tests set it to 0. */
  retryDelayMs = 2_000;
  /** How long to stay on the fallback model after a failover. */
  degradedForMs = 5 * 60_000;

  constructor(env: Env, model?: string) {
    this.model = model ?? env.GEMINI_MODEL;
    this.apiKey = (env.GEMINI_API_KEY ?? "").trim();
    this.baseUrl = env.GEMINI_BASE_URL.replace(/\/$/, "");
    this.thinkingLevel = env.GEMINI_THINKING_LEVEL.toUpperCase();
    this.timeoutMs = env.GEMINI_TIMEOUT_MS;
    this.attemptTimeoutMs = Math.min(env.GEMINI_ATTEMPT_TIMEOUT_MS, env.GEMINI_TIMEOUT_MS);
    this.maxTokens = env.GEMINI_MAX_TOKENS;
    const fallback = env.GEMINI_FALLBACK_MODEL.trim();
    this.fallbackModel = fallback && fallback !== this.model ? fallback : null;
  }

  async generate<S extends ZodTypeAny>(opts: GenerateOptions<S>): Promise<GenerationResult<S>> {
    if (!this.apiKey) throw new AIProviderError("Gemini is selected but GEMINI_API_KEY is not set");

    const contents: GeminiContent[] = [{ role: "user", parts: [{ text: opts.user }] }];
    const generationConfig = {
      ...(opts.temperature != null ? { temperature: opts.temperature } : {}),
      // Thinking tokens count against this cap, and callers size maxTokens for
      // local models; billing is per token used, so a generous cap costs nothing.
      maxOutputTokens: Math.max(opts.maxTokens ?? 0, this.maxTokens),
      responseMimeType: "application/json",
      responseJsonSchema: toGeminiSchema(zodToJsonSchema(opts.schema)),
      thinkingConfig: { thinkingLevel: this.thinkingLevel },
    };
    const body = () =>
      JSON.stringify({
        systemInstruction: { parts: [{ text: `${opts.system}\n\n${JSON_CONTRACT_INSTRUCTION}` }] },
        contents,
        generationConfig,
      });

    let lastText = "";
    let truncated = false;
    let answeredBy = this.model;
    const call = async (): Promise<RawCompletion> => {
      const { res, model } = await this.send(body());
      answeredBy = model;
      if (!res.ok) {
        throw new AIProviderError(`Gemini error ${res.status}: ${geminiErrorMessage(await res.text())}`);
      }
      const json = (await res.json()) as GeminiResponse;
      if (json.promptFeedback?.blockReason) {
        throw new AIProviderError(`Gemini blocked the request (${json.promptFeedback.blockReason})`);
      }
      const candidate = json.candidates?.[0];
      lastText = (candidate?.content?.parts ?? [])
        .filter((p) => !p.thought && typeof p.text === "string")
        .map((p) => p.text)
        .join("");
      truncated = candidate?.finishReason === "MAX_TOKENS";
      if (!lastText && candidate?.finishReason && !truncated && candidate.finishReason !== "STOP") {
        throw new AIProviderError(`Gemini returned no answer (finish reason ${candidate.finishReason})`);
      }
      const usage = json.usageMetadata ?? {};
      return {
        text: lastText,
        usage: {
          inputTokens: usage.promptTokenCount ?? 0,
          outputTokens: (usage.candidatesTokenCount ?? 0) + (usage.thoughtsTokenCount ?? 0),
        },
      };
    };

    const { data, usage } = await parseWithRepair(await call(), opts.schema, async (problem) => {
      if (truncated) {
        contents.push({
          role: "user",
          parts: [{ text: "Your previous answer exceeded the output limit and was cut off. Return the complete JSON object again, keeping every text field concise." }],
        });
      } else {
        contents.push(
          { role: "model", parts: [{ text: lastText.slice(0, 20_000) }] },
          { role: "user", parts: [{ text: problem }] },
        );
      }
      return call();
    });

    // Report the model that actually answered (the fallback during an outage).
    return { data, provider: this.provider, model: answeredBy, usage };
  }

  /** Primary model, or the fallback while the primary is unavailable. */
  private async send(body: string): Promise<{ res: Response; model: string }> {
    const useFallback = this.fallbackModel && Date.now() < this.degradedUntil;
    if (!useFallback) {
      try {
        return { res: await this.post(this.model, body), model: this.model };
      } catch (err) {
        if (!(err instanceof GeminiUnavailableError) || !this.fallbackModel) throw err;
        console.warn(`[gemini] ${err.message}; falling back to ${this.fallbackModel}`);
        this.degradedUntil = Date.now() + this.degradedForMs;
      }
    }
    const fallback = this.fallbackModel as string;
    return { res: await this.post(fallback, body), model: fallback };
  }

  /**
   * generateContent on one model. Overload/rate-limit answers (429, 500, 503)
   * and attempts that hang past GEMINI_ATTEMPT_TIMEOUT_MS are retried with
   * backoff within GEMINI_TIMEOUT_MS; if the model is still unavailable this
   * throws GeminiUnavailableError. Other answers are returned to the caller.
   */
  private async post(model: string, body: string): Promise<Response> {
    const deadline = Date.now() + this.timeoutMs;
    let problem = "";
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      const remaining = deadline - Date.now();
      if (remaining < 1_000) break;
      try {
        const res = await fetch(`${this.baseUrl}/models/${encodeURIComponent(model)}:generateContent`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-goog-api-key": this.apiKey },
          body,
          signal: AbortSignal.timeout(Math.min(this.attemptTimeoutMs, remaining)),
        });
        if (!RETRYABLE.has(res.status)) return res;
        problem = `answered ${res.status} (${geminiErrorMessage(await res.text()).slice(0, 120)})`;
      } catch (err) {
        if (!(err instanceof Error && err.name === "TimeoutError")) {
          throw new AIProviderError(`Gemini ${model} is unreachable — check the internet connection`, err);
        }
        problem = `did not answer within ${Math.round(Math.min(this.attemptTimeoutMs, remaining) / 1000)}s`;
      }
      const wait = this.retryDelayMs * 3 ** attempt;
      if (attempt < this.maxRetries && Date.now() + wait < deadline) {
        await new Promise((resolve) => setTimeout(resolve, wait));
      }
    }
    throw new GeminiUnavailableError(`Gemini ${model} is unavailable: ${problem || "timed out"}`);
  }
}

/** The model stayed overloaded or unresponsive through every retry. */
class GeminiUnavailableError extends AIProviderError {}

/** Status codes worth retrying: rate limit and "model experiencing high demand". */
const RETRYABLE = new Set([429, 500, 503]);

/** Google's error envelope is `{ error: { message } }`; fall back to the raw body. */
function geminiErrorMessage(body: string): string {
  try {
    const message = (JSON.parse(body) as { error?: { message?: string } }).error?.message;
    if (message) return message.slice(0, 300);
  } catch {
    /* not JSON */
  }
  return body.slice(0, 300);
}
