import type { ZodTypeAny, output } from "zod";
import {
  ZodString,
  ZodNumber,
  ZodBoolean,
  ZodEnum,
  ZodNativeEnum,
  ZodLiteral,
  ZodArray,
  ZodObject,
  ZodOptional,
  ZodNullable,
  ZodDefault,
  ZodUnion,
  ZodRecord,
} from "zod";
import type { GenerateOptions, GenerationResult, StructuredGenerator } from "@/lib/ai/types";

/**
 * Deterministic offline generator.
 * When the caller supplies a `mock` builder (all pipelines do), it is used so
 * demo output carries real retrieved chunks and citations. Otherwise a minimal
 * schema-valid value is synthesized.
 */
export class MockGenerator implements StructuredGenerator {
  readonly provider = "mock";
  readonly model = "mock-1";

  async generate<S extends ZodTypeAny>(opts: GenerateOptions<S>): Promise<GenerationResult<S>> {
    const data = opts.mock ? opts.mock() : (synthesize(opts.schema) as output<S>);
    return {
      data,
      provider: this.provider,
      model: this.model,
      usage: { inputTokens: opts.user.length / 4 | 0, outputTokens: 64 },
    };
  }
}

function synthesize(schema: ZodTypeAny, depth = 0): unknown {
  if (depth > 6) return null;
  if (schema instanceof ZodString) return "";
  if (schema instanceof ZodNumber) return 0;
  if (schema instanceof ZodBoolean) return false;
  if (schema instanceof ZodLiteral) return schema.value;
  if (schema instanceof ZodEnum) return schema.options[0];
  if (schema instanceof ZodNativeEnum) return Object.values(schema.enum as Record<string, unknown>)[0];
  if (schema instanceof ZodArray) return [];
  if (schema instanceof ZodRecord) return {};
  if (schema instanceof ZodUnion) {
    const options = (schema as unknown as { options: ZodTypeAny[] }).options;
    return synthesize(options[0], depth + 1);
  }
  if (schema instanceof ZodOptional || schema instanceof ZodNullable) return null;
  if (schema instanceof ZodDefault) return schema._def.defaultValue();
  if (schema instanceof ZodObject) {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(schema.shape as Record<string, ZodTypeAny>)) {
      if (value instanceof ZodOptional) continue;
      out[key] = synthesize(value, depth + 1);
    }
    return out;
  }
  return null;
}
