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
 */
export class GeminiGenerator implements StructuredGenerator {
  readonly provider = "gemini";
  readonly model: string;
  private apiKey: string;
  private baseUrl: string;
  private thinkingLevel: string;
  private timeoutMs: number;
  private maxTokens: number;
  private maxRetries = 2;
  /** First backoff delay; tests set it to 0. */
  retryDelayMs = 2_000;

  constructor(env: Env, model?: string) {
    this.model = model ?? env.GEMINI_MODEL;
    this.apiKey = (env.GEMINI_API_KEY ?? "").trim();
    this.baseUrl = env.GEMINI_BASE_URL.replace(/\/$/, "");
    this.thinkingLevel = env.GEMINI_THINKING_LEVEL.toUpperCase();
    this.timeoutMs = env.GEMINI_TIMEOUT_MS;
    this.maxTokens = env.GEMINI_MAX_TOKENS;
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

    let lastText = "";
    let truncated = false;
    const call = async (): Promise<RawCompletion> => {
      const res = await this.post(opts.system, contents, generationConfig);
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

    return { data, provider: this.provider, model: this.model, usage };
  }

  /**
   * One generateContent request. Overload (503) and rate-limit (429) answers
   * are retried with backoff — Flash models do return "high demand" 503s at
   * peak times — within the overall timeout.
   */
  private async post(system: string, contents: GeminiContent[], generationConfig: object): Promise<Response> {
    const deadline = Date.now() + this.timeoutMs;
    for (let attempt = 0; ; attempt++) {
      let res: Response;
      try {
        res = await fetch(`${this.baseUrl}/models/${encodeURIComponent(this.model)}:generateContent`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-goog-api-key": this.apiKey },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: `${system}\n\n${JSON_CONTRACT_INSTRUCTION}` }] },
            contents,
            generationConfig,
          }),
          signal: AbortSignal.timeout(Math.max(1_000, deadline - Date.now())),
        });
      } catch (err) {
        const reason =
          err instanceof Error && err.name === "TimeoutError"
            ? `timed out after ${Math.round(this.timeoutMs / 1000)}s`
            : "is unreachable — check the internet connection";
        throw new AIProviderError(`Gemini ${this.model} ${reason}`, err);
      }
      const wait = this.retryDelayMs * 3 ** attempt;
      if (!RETRYABLE.has(res.status) || attempt >= this.maxRetries || Date.now() + wait >= deadline) return res;
      await res.body?.cancel();
      await new Promise((resolve) => setTimeout(resolve, wait));
    }
  }
}

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
