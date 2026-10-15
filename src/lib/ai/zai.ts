import type { ZodTypeAny } from "zod";
import type { Env } from "@/lib/env";
import type { GenerateOptions, GenerationResult, StructuredGenerator } from "@/lib/ai/types";
import { AIProviderError, JSON_CONTRACT_INSTRUCTION } from "@/lib/ai/types";
import { parseWithRepair, type RawCompletion } from "@/lib/ai/shared";
import { zodToJsonSchema } from "@/lib/ai/zod-to-json-schema";

type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

interface ChatCompletion {
  choices?: { message?: { content?: string | null }; finish_reason?: string }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

/** Status codes worth retrying: rate limit and overloaded service (balance errors excepted). */
const RETRYABLE = new Set([429, 500, 502, 503, 504]);
/** Z.ai business code for "Insufficient balance or no resource package" (sent as 429; retrying is pointless). */
const NO_BALANCE = "1113";

/**
 * GLM served directly by Z.ai (`/chat/completions`, OpenAI-style), e.g.
 * glm-5.3-flash. Cloud provider: the prompt, including source excerpts, leaves
 * this machine.
 *
 * - Structured output: Z.ai only offers `response_format: json_object` (no
 *   constrained decoding), so the JSON Schema is stated in the prompt, its size
 *   limits are repeated in plain words (GLM follows those far better), and
 *   anything still over a limit — extra list items, over-long strings — is
 *   trimmed before Zod validation. One repair round handles the rest.
 * - GLM-5.3 always thinks; `reasoning_effort` (default "max" on Z.ai) is sent
 *   explicitly and kept low for generating study material.
 * - The API key travels only in the Authorization header and never appears in
 *   error messages. Rate-limit/overload answers and hung attempts are retried.
 * - ZAI_BASE_URL selects the pay-as-you-go endpoint (/api/paas/v4) or the GLM
 *   Coding Plan endpoint (/api/coding/paas/v4); keys only work on their own.
 */
export class ZaiGenerator implements StructuredGenerator {
  readonly provider = "zai";
  readonly model: string;
  private apiKey: string;
  private baseUrl: string;
  private reasoningEffort: string;
  private timeoutMs: number;
  private attemptTimeoutMs: number;
  private maxTokens: number;
  private maxRetries = 2;
  /** First backoff delay; tests set it to 0. */
  retryDelayMs = 2_000;

  constructor(env: Env, model?: string) {
    // Z.ai model codes are lower-case ("GLM-5.3-Flash" → "glm-5.3-flash").
    this.model = (model ?? env.GLM_AI_MODEL).trim().toLowerCase();
    this.apiKey = (env.ZAI_API_KEY ?? "").trim();
    this.baseUrl = env.ZAI_BASE_URL.replace(/\/$/, "");
    this.reasoningEffort = env.ZAI_REASONING_EFFORT;
    this.timeoutMs = env.ZAI_TIMEOUT_MS;
    this.attemptTimeoutMs = Math.min(env.ZAI_ATTEMPT_TIMEOUT_MS, env.ZAI_TIMEOUT_MS);
    this.maxTokens = env.ZAI_MAX_TOKENS;
  }

  async generate<S extends ZodTypeAny>(opts: GenerateOptions<S>): Promise<GenerationResult<S>> {
    if (!this.apiKey) throw new AIProviderError("GLM (Z.ai) is selected but ZAI_API_KEY is not set");

    const schema = zodToJsonSchema(opts.schema) as JsonSchema;
    const limits = describeLimits(schema);
    const messages: ChatMessage[] = [
      { role: "system", content: `${opts.system}\n\n${JSON_CONTRACT_INSTRUCTION}` },
      {
        role: "user",
        content:
          `${opts.user}\n\nThe JSON object must conform to this JSON Schema:\n${JSON.stringify(schema)}` +
          (limits.length ? `\n\nHard limits (answers beyond them are rejected):\n${limits.map((l) => `- ${l}`).join("\n")}` : ""),
      },
    ];

    let lastText = "";
    let truncated = false;
    const call = async (): Promise<RawCompletion> => {
      const json = await this.complete(messages, opts);
      const choice = json.choices?.[0];
      lastText = fitToSchema(stripThinking(choice?.message?.content ?? ""), schema);
      truncated = choice?.finish_reason === "length";
      return {
        text: lastText,
        usage: { inputTokens: json.usage?.prompt_tokens ?? 0, outputTokens: json.usage?.completion_tokens ?? 0 },
      };
    };

    const { data, usage } = await parseWithRepair(await call(), opts.schema, async (problem) => {
      if (truncated) {
        messages.push({
          role: "user",
          content: "Your previous answer exceeded the output limit and was cut off. Return the complete JSON object again, keeping every text field concise.",
        });
      } else {
        messages.push({ role: "assistant", content: lastText.slice(0, 20_000) }, { role: "user", content: problem });
      }
      return call();
    });

    return { data, provider: this.provider, model: this.model, usage };
  }

  private async complete<S extends ZodTypeAny>(messages: ChatMessage[], opts: GenerateOptions<S>): Promise<ChatCompletion> {
    const res = await this.post(
      JSON.stringify({
        model: this.model,
        messages,
        // Reasoning tokens count against the cap; billing is per token used.
        max_tokens: Math.max(opts.maxTokens ?? 0, this.maxTokens),
        temperature: opts.temperature ?? 0.3,
        reasoning_effort: this.reasoningEffort,
        response_format: { type: "json_object" },
        stream: false,
      }),
    );
    if (!res.ok) throw zaiError(res.status, await res.text());
    return (await res.json()) as ChatCompletion;
  }

  /** One request with retries for rate-limit/overload answers and hung attempts, within ZAI_TIMEOUT_MS. */
  private async post(body: string): Promise<Response> {
    const deadline = Date.now() + this.timeoutMs;
    let problem = "";
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      const remaining = deadline - Date.now();
      if (remaining < 1_000) break;
      try {
        const res = await fetch(`${this.baseUrl}/chat/completions`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "Accept-Language": "en-US,en", Authorization: `Bearer ${this.apiKey}` },
          body,
          signal: AbortSignal.timeout(Math.min(this.attemptTimeoutMs, remaining)),
        });
        if (!RETRYABLE.has(res.status) || attempt === this.maxRetries) return res;
        const text = await res.text();
        // An empty balance is reported as 429 too — fail now instead of retrying.
        if (errorCode(text) === NO_BALANCE) throw zaiError(res.status, text);
        problem = `answered ${res.status} (${errorMessage(text).slice(0, 120)})`;
      } catch (err) {
        if (err instanceof AIProviderError) throw err;
        if (!(err instanceof Error && err.name === "TimeoutError")) {
          throw new AIProviderError(`GLM (Z.ai) ${this.model} is unreachable — check the internet connection`, err);
        }
        problem = `did not answer within ${Math.round(Math.min(this.attemptTimeoutMs, remaining) / 1000)}s`;
      }
      const wait = this.retryDelayMs * 3 ** attempt;
      if (attempt < this.maxRetries && Date.now() + wait < deadline) {
        await new Promise((resolve) => setTimeout(resolve, wait));
      }
    }
    throw new AIProviderError(`GLM (Z.ai) ${this.model} is unavailable: ${problem || "timed out"}`);
  }
}

/** Error with Z.ai's message and a hint for the common account problems (never the key). */
function zaiError(status: number, body: string): AIProviderError {
  const hint =
    status === 401
      ? " — check ZAI_API_KEY"
      : errorCode(body) === NO_BALANCE
        ? " — the Z.ai account has no balance for this endpoint: recharge it, or set ZAI_BASE_URL to the endpoint your key belongs to (GLM Coding Plan keys: https://api.z.ai/api/coding/paas/v4)"
        : "";
  return new AIProviderError(`GLM (Z.ai) error ${status}: ${errorMessage(body)}${hint}`);
}

type JsonSchema = {
  type?: string;
  properties?: Record<string, JsonSchema>;
  items?: JsonSchema;
  maxItems?: number;
  minItems?: number;
  maxLength?: number;
};

/** "sections: at most 24 items", "sections[].title: at most 120 characters", … */
export function describeLimits(schema: JsonSchema, path = ""): string[] {
  const out: string[] = [];
  const name = path || "the answer";
  if (schema.maxLength != null) out.push(`${name}: at most ${schema.maxLength} characters`);
  if (schema.maxItems != null || schema.minItems != null) {
    const range =
      schema.minItems != null && schema.maxItems != null
        ? `${schema.minItems} to ${schema.maxItems} items`
        : schema.maxItems != null
          ? `at most ${schema.maxItems} items`
          : `at least ${schema.minItems} items`;
    out.push(`${name}: ${range}`);
  }
  for (const [key, child] of Object.entries(schema.properties ?? {})) {
    out.push(...describeLimits(child, path ? `${path}.${key}` : key));
  }
  if (schema.items) out.push(...describeLimits(schema.items, `${path}[]`));
  return out;
}

/**
 * Trims a JSON answer to the schema's maxItems/maxLength (strings cut at a word
 * boundary with "…"). Without constrained decoding GLM regularly writes a 25th
 * section or a 130-character title; trimming keeps the rest of an otherwise
 * good answer. Text that is not JSON is returned unchanged.
 */
export function fitToSchema(text: string, schema: JsonSchema): string {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return text;
  }
  return JSON.stringify(clamp(value, schema));
}

function clamp(value: unknown, schema: JsonSchema): unknown {
  if (typeof value === "string" && schema.maxLength != null && value.length > schema.maxLength) {
    const cut = value.slice(0, Math.max(1, schema.maxLength - 1));
    const space = cut.lastIndexOf(" ");
    return `${space >= schema.maxLength * 0.5 ? cut.slice(0, space) : cut}…`;
  }
  if (Array.isArray(value)) {
    const kept = schema.maxItems != null ? value.slice(0, schema.maxItems) : value;
    const items = schema.items;
    return items ? kept.map((v) => clamp(v, items)) : kept;
  }
  if (value && typeof value === "object" && schema.properties) {
    const props = schema.properties;
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, props[k] ? clamp(v, props[k]) : v]),
    );
  }
  return value;
}

/** Reasoning text inlined as <think>…</think> (instead of reasoning_content) is not part of the answer. */
function stripThinking(text: string): string {
  return text.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
}

/** Z.ai errors are `{ error: { code, message } }`; fall back to the raw body. */
function parseError(body: string): { code?: string; message?: string } {
  try {
    const parsed = JSON.parse(body) as { error?: { code?: string | number; message?: string } | string };
    if (typeof parsed.error === "string") return { message: parsed.error };
    return { code: parsed.error?.code != null ? String(parsed.error.code) : undefined, message: parsed.error?.message };
  } catch {
    return {};
  }
}

function errorCode(body: string): string | undefined {
  return parseError(body).code;
}

function errorMessage(body: string): string {
  return (parseError(body).message ?? body).slice(0, 300);
}
