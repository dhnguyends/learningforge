import type { ZodTypeAny } from "zod";
import type { Env } from "@/lib/env";
import type { GenerateOptions, GenerationResult, StructuredGenerator } from "@/lib/ai/types";
import { AIProviderError, JSON_CONTRACT_INSTRUCTION } from "@/lib/ai/types";
import { parseWithRepair, type RawCompletion } from "@/lib/ai/shared";
import { zodToJsonSchema } from "@/lib/ai/zod-to-json-schema";

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

  constructor(env: Env) {
    this.model = env.LOCAL_AI_MODEL;
    this.baseUrl = env.LOCAL_AI_BASE_URL.replace(/\/$/, "");
    this.think = env.LOCAL_AI_THINK;
    this.timeoutMs = env.LOCAL_AI_TIMEOUT_MS;
    this.maxTokens = env.LOCAL_AI_MAX_TOKENS;
    this.numCtx = env.LOCAL_AI_NUM_CTX;
  }

  async generate<S extends ZodTypeAny>(opts: GenerateOptions<S>): Promise<GenerationResult<S>> {
    const messages: ChatMessage[] = [
      { role: "system", content: `${opts.system}\n\n${JSON_CONTRACT_INSTRUCTION}` },
      { role: "user", content: opts.user },
    ];
    const format = zodToJsonSchema(opts.schema);
    const options = {
      ...(opts.temperature != null ? { temperature: opts.temperature } : { temperature: 0.3 }),
      num_predict: opts.maxTokens ?? this.maxTokens,
      ...(this.numCtx ? { num_ctx: this.numCtx } : {}),
    };

    let lastText = "";
    let truncated = false;
    const call = async (): Promise<RawCompletion> => {
      let res: Response;
      try {
        res = await fetch(`${this.baseUrl}/api/chat`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ model: this.model, messages, stream: false, format, think: this.think, options }),
          signal: AbortSignal.timeout(this.timeoutMs),
        });
      } catch (err) {
        const reason =
          err instanceof Error && err.name === "TimeoutError"
            ? `timed out after ${Math.round(this.timeoutMs / 1000)}s (raise LOCAL_AI_TIMEOUT_MS or use a smaller model)`
            : `unreachable at ${this.baseUrl} — is Ollama running?`;
        throw new AIProviderError(`Local model ${this.model} ${reason}`, err);
      }
      if (!res.ok) throw new AIProviderError(`Local model error ${res.status}: ${(await res.text()).slice(0, 300)}`);
      const json = (await res.json()) as OllamaChatResponse;
      lastText = json.message?.content ?? "";
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

    return { data, provider: this.provider, model: this.model, usage };
  }
}
