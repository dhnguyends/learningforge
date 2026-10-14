import type { ZodTypeAny } from "zod";
import type { Env } from "@/lib/env";
import type { GenerateOptions, GenerationResult, StructuredGenerator } from "@/lib/ai/types";
import { JSON_CONTRACT_INSTRUCTION } from "@/lib/ai/types";
import { parseWithRepair, type RawCompletion } from "@/lib/ai/shared";
import { zodToJsonSchema } from "@/lib/ai/zod-to-json-schema";

interface OllamaChatResponse {
  message: { content: string };
  prompt_eval_count?: number;
  eval_count?: number;
}

/** Ollama-style local model endpoint with native JSON-schema structured output. */
export class LocalGenerator implements StructuredGenerator {
  readonly provider = "local";
  readonly model: string;
  private baseUrl: string;

  constructor(env: Env) {
    this.model = env.LOCAL_AI_MODEL;
    this.baseUrl = env.LOCAL_AI_BASE_URL.replace(/\/$/, "");
  }

  async generate<S extends ZodTypeAny>(opts: GenerateOptions<S>): Promise<GenerationResult<S>> {
    const messages = [
      { role: "system", content: `${opts.system}\n\n${JSON_CONTRACT_INSTRUCTION}` },
      { role: "user", content: opts.user },
    ];
    const format = zodToJsonSchema(opts.schema);

    const call = async (): Promise<RawCompletion> => {
      const res = await fetch(`${this.baseUrl}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: this.model, messages, stream: false, format }),
      });
      if (!res.ok) throw new Error(`Local model error ${res.status}: ${(await res.text()).slice(0, 300)}`);
      const json = (await res.json()) as OllamaChatResponse;
      return {
        text: json.message?.content ?? "",
        usage: { inputTokens: json.prompt_eval_count ?? 0, outputTokens: json.eval_count ?? 0 },
      };
    };

    const { data, usage } = await parseWithRepair(await call(), opts.schema, async (problem) => {
      messages.push({ role: "assistant", content: "invalid" }, { role: "user", content: problem });
      return call();
    });

    return { data, provider: this.provider, model: this.model, usage };
  }
}
