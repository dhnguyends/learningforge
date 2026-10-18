import type { ZodTypeAny } from "zod";
import type { Env } from "@/lib/env";
import type { GenerateOptions, GenerationResult, StructuredGenerator } from "@/lib/ai/types";
import { AIProviderError, JSON_CONTRACT_INSTRUCTION } from "@/lib/ai/types";
import { extractJson, parseWithRepair, type RawCompletion } from "@/lib/ai/shared";
import { zodToJsonSchema } from "@/lib/ai/zod-to-json-schema";
import { cpuTimeoutFactor } from "@/lib/gpu";
import { alwaysThinks, loadAloneOnGpu } from "@/lib/ai/ollama";

/**
 * Local models write JSON under a grammar: a bare double quote inside a text
 * ends that text, and the model carries on with the next fields — an answer
 * then stops mid-sentence ("…the value of this "). Seen with Gemma 4 12B.
 */
export const LOCAL_QUOTE_RULE =
  "Inside JSON text values, quote words with single quotes ('like this'), never with a bare double quote: a double quote ends the text. In code, escape it as \\\".";

/**
 * The first text value of a JSON result that stops in the middle: it ends with
 * a space after a word, which a finished text never does (the mark of a bare
 * double quote that closed it early). null when every text is whole.
 */
export function findCutText(value: unknown): string | null {
  if (typeof value === "string") return /\S[ \t]+$/.test(value) ? value : null;
  if (Array.isArray(value)) {
    for (const v of value) {
      const cut = findCutText(v);
      if (cut !== null) return cut;
    }
    return null;
  }
  if (value && typeof value === "object") {
    for (const v of Object.values(value)) {
      const cut = findCutText(v);
      if (cut !== null) return cut;
    }
  }
  return null;
}

/** Drops a `<think>…</think>` block a reasoning model may leave in its answer. */
export function stripThinking(text: string): string {
  return text.replace(/^\s*<think>[\s\S]*?<\/think>\s*/i, "");
}

interface OllamaChatResponse {
  message: { content: string };
  done_reason?: string;
  prompt_eval_count?: number;
  eval_count?: number;
}

type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

/**
 * Ollama-style local model endpoint (e.g. Gemma 4, Llama 3.1) with native
 * JSON-schema structured output (`format`).
 *
 * - `think` is sent explicitly: reasoning models think by default, which costs
 *   ~10x latency here and adds nothing once output is schema-constrained.
 * - Every call has a timeout and an output cap (`num_predict`), so a stalled
 *   or runaway model fails fast instead of leaving the job RUNNING.
 * - The repair round shows the model its own previous output, so it can
 *   actually correct it — unless that output was cut off at the cap, in which
 *   case the model is asked for a complete, more concise answer instead.
 */
export class LocalGenerator implements StructuredGenerator {
  readonly provider = "local";
  readonly model: string;
  private baseUrl: string;
  private think: boolean;
  private timeoutMs: number;
  private maxTokens: number;
  private numCtx?: number;

  /** Tokens allowed for the reasoning of a model that always thinks (DeepSeek-R1), on top of the answer. */
  static readonly THINKING_BUDGET = 4096;

  /** `model`: an installed Ollama model chosen at /admin; LOCAL_AI_MODEL by default. */
  constructor(env: Env, model: string = env.LOCAL_AI_MODEL) {
    this.model = model;
    this.baseUrl = env.LOCAL_AI_BASE_URL.replace(/\/$/, "");
    // DeepSeek-R1 reasons whatever `think` says; asking for it explicitly keeps
    // the reasoning in its own field, out of the JSON answer.
    this.think = env.LOCAL_AI_THINK || alwaysThinks(model);
    this.timeoutMs = env.LOCAL_AI_TIMEOUT_MS;
    this.maxTokens = env.LOCAL_AI_MAX_TOKENS;
    this.numCtx = env.LOCAL_AI_NUM_CTX;
  }

  async generate<S extends ZodTypeAny>(opts: GenerateOptions<S>): Promise<GenerationResult<S>> {
    const messages: ChatMessage[] = [
      { role: "system", content: `${opts.system}\n\n${JSON_CONTRACT_INSTRUCTION}\n${LOCAL_QUOTE_RULE}` },
      { role: "user", content: opts.user },
    ];
    const format = zodToJsonSchema(opts.schema);
    const options = {
      ...(opts.temperature != null ? { temperature: opts.temperature } : { temperature: 0.3 }),
      // Reasoning tokens count against num_predict.
      num_predict: (opts.maxTokens ?? this.maxTokens) + (alwaysThinks(this.model) ? LocalGenerator.THINKING_BUDGET : 0),
      ...(this.numCtx ? { num_ctx: this.numCtx } : {}),
    };

    let lastText = "";
    let truncated = false;
    // Ollama runs on the CPU when there is no GPU: allow for it.
    const timeoutMs = this.timeoutMs * (await cpuTimeoutFactor());
    const call = async (): Promise<RawCompletion> => {
      // One language model on the GPU at a time.
      await loadAloneOnGpu(this.model);
      let res: Response;
      try {
        res = await fetch(`${this.baseUrl}/api/chat`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ model: this.model, messages, stream: false, format, think: this.think, options }),
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (err) {
        const reason =
          err instanceof Error && err.name === "TimeoutError"
            ? `timed out after ${Math.round(timeoutMs / 1000)}s (raise LOCAL_AI_TIMEOUT_MS or use a smaller model)`
            : `unreachable at ${this.baseUrl} — is Ollama running?`;
        throw new AIProviderError(`Local model ${this.model} ${reason}`, err);
      }
      if (!res.ok) throw new AIProviderError(`Local model error ${res.status}: ${(await res.text()).slice(0, 300)}`);
      const json = (await res.json()) as OllamaChatResponse;
      lastText = stripThinking(json.message?.content ?? "");
      truncated = json.done_reason === "length";
      return {
        text: lastText,
        usage: { inputTokens: json.prompt_eval_count ?? 0, outputTokens: json.eval_count ?? 0 },
      };
    };

    const { data, usage } = await parseWithRepair(await call(), opts.schema, async (problem) => {
      if (truncated) {
        messages.push({
          role: "user",
          content:
            "Your previous answer exceeded the output limit and was cut off. Return the complete JSON object again, " +
            "keeping every text field concise.",
        });
      } else {
        messages.push({ role: "assistant", content: lastText.slice(0, 20_000) }, { role: "user", content: problem });
      }
      return call();
    });

    // A text cut short by a bare double quote: ask once more for the whole JSON.
    const cut = findCutText(data);
    if (cut !== null) {
      messages.push(
        { role: "assistant", content: lastText.slice(0, 20_000) },
        {
          role: "user",
          content:
            `A text in your JSON stops in the middle ("...${cut.trim().slice(-80)}"): a bare double quote ended it. ` +
            "Return the complete JSON object again; inside texts use single quotes, never a bare double quote.",
        },
      );
      try {
        const again = await call();
        const parsed = opts.schema.safeParse(extractJson(again.text));
        // Keep the retry when it is whole, or at least longer than the cut one.
        if (parsed.success && (findCutText(parsed.data) === null || JSON.stringify(parsed.data).length > JSON.stringify(data).length)) {
          const total = { inputTokens: usage.inputTokens + again.usage.inputTokens, outputTokens: usage.outputTokens + again.usage.outputTokens };
          return { data: parsed.data, provider: this.provider, model: this.model, usage: total };
        }
      } catch {
        // The first answer, cut or not, is better than none.
      }
    }

    return { data, provider: this.provider, model: this.model, usage };
  }
}
