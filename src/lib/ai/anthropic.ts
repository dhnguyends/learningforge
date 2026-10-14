import Anthropic from "@anthropic-ai/sdk";
import type { ZodTypeAny } from "zod";
import type { Env } from "@/lib/env";
import type { GenerateOptions, GenerationResult, StructuredGenerator } from "@/lib/ai/types";
import { parseWithRepair, type RawCompletion } from "@/lib/ai/shared";
import { zodToJsonSchema } from "@/lib/ai/zod-to-json-schema";

/**
 * Anthropic Messages API adapter. Structured output is enforced through a
 * forced tool-use block whose input schema is the caller's Zod schema.
 */
export class AnthropicGenerator implements StructuredGenerator {
  readonly provider = "anthropic";
  readonly model: string;
  private client: Anthropic;

  constructor(env: Env) {
    this.model = env.ANTHROPIC_MODEL;
    this.client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  }

  async generate<S extends ZodTypeAny>(opts: GenerateOptions<S>): Promise<GenerationResult<S>> {
    const inputSchema = zodToJsonSchema(opts.schema) as Anthropic.Tool.InputSchema;

    const call = async (repairNote?: string): Promise<RawCompletion> => {
      const res = await this.client.messages.create({
        model: this.model,
        max_tokens: opts.maxTokens ?? 4096,
        temperature: opts.temperature ?? 0.3,
        system: opts.system,
        messages: [
          {
            role: "user",
            content: repairNote ?? opts.user,
          },
        ],
        tools: [
          {
            name: "emit_result",
            description: "Emit the structured result conforming exactly to the schema.",
            input_schema: inputSchema,
          },
        ],
        tool_choice: { type: "tool", name: "emit_result" },
      });

      const toolBlock = res.content.find((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
      const text = toolBlock ? JSON.stringify(toolBlock.input) : "";
      return {
        text,
        usage: { inputTokens: res.usage.input_tokens, outputTokens: res.usage.output_tokens },
      };
    };

    const { data, usage } = await parseWithRepair(await call(), opts.schema, (problem) => call(problem));

    return { data, provider: this.provider, model: this.model, usage };
  }
}
