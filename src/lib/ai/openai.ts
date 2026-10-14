import OpenAI from "openai";
import type { ZodTypeAny } from "zod";
import type { Env } from "@/lib/env";
import type { GenerateOptions, GenerationResult, StructuredGenerator } from "@/lib/ai/types";
import { JSON_CONTRACT_INSTRUCTION } from "@/lib/ai/types";
import { parseWithRepair, type RawCompletion } from "@/lib/ai/shared";
import { zodToJsonSchema } from "@/lib/ai/zod-to-json-schema";

/** Any OpenAI-compatible chat API (OpenAI, Azure-compatible gateways, vLLM, ...). */
export class OpenAIGenerator implements StructuredGenerator {
  readonly provider = "openai";
  readonly model: string;
  private client: OpenAI;

  constructor(env: Env) {
    this.model = env.AI_MODEL;
    this.client = new OpenAI({
      apiKey: env.OPENAI_API_KEY,
      ...(env.OPENAI_BASE_URL ? { baseURL: env.OPENAI_BASE_URL } : {}),
    });
  }

  async generate<S extends ZodTypeAny>(opts: GenerateOptions<S>): Promise<GenerationResult<S>> {
    const schemaJson = JSON.stringify(zodToJsonSchema(opts.schema));
    const messages: OpenAI.ChatCompletionMessageParam[] = [
      { role: "system", content: `${opts.system}\n\n${JSON_CONTRACT_INSTRUCTION}` },
      {
        role: "user",
        content: `${opts.user}\n\nThe JSON object must conform to this JSON Schema:\n${schemaJson}`,
      },
    ];

    const call = async (): Promise<RawCompletion> => {
      const res = await this.client.chat.completions.create({
        model: this.model,
        messages,
        temperature: opts.temperature ?? 0.3,
        max_tokens: opts.maxTokens ?? 4000,
        response_format: { type: "json_object" },
      });
      return {
        text: res.choices[0]?.message?.content ?? "",
        usage: {
          inputTokens: res.usage?.prompt_tokens ?? 0,
          outputTokens: res.usage?.completion_tokens ?? 0,
        },
      };
    };

    const { data, usage } = await parseWithRepair(await call(), opts.schema, async (problem) => {
      messages.push({ role: "assistant", content: "invalid" }, { role: "user", content: problem });
      return call();
    });

    return { data, provider: this.provider, model: this.model, usage };
  }
}
