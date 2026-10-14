import type { ZodTypeAny } from "zod";
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
  ZodUnion,
  ZodDefault,
  ZodRecord,
  ZodAny,
  ZodNull,
} from "zod";

type JsonSchema = Record<string, unknown>;

/**
 * Minimal Zod → JSON Schema converter covering the subset used by our
 * generation schemas (objects, strings, numbers, booleans, enums, arrays,
 * unions, records, optional/nullable). Avoids pulling a heavier dependency
 * into the provider adapters.
 */
export function zodToJsonSchema(schema: ZodTypeAny): JsonSchema {
  return convert(schema) ?? { type: "string" };
}

function convert(schema: ZodTypeAny): JsonSchema | null {
  if (schema instanceof ZodString) return { type: "string" };
  if (schema instanceof ZodNumber) return { type: "number" };
  if (schema instanceof ZodBoolean) return { type: "boolean" };
  if (schema instanceof ZodNull) return { type: "null" };
  if (schema instanceof ZodLiteral) {
    return { type: typeof schema.value as string, const: schema.value };
  }
  if (schema instanceof ZodEnum || schema instanceof ZodNativeEnum) {
    const values: (string | number)[] =
      schema instanceof ZodEnum
        ? [...schema.options]
        : Object.values(schema.enum as Record<string, string | number>);
    const allStrings = values.every((v) => typeof v === "string");
    return allStrings ? { type: "string", enum: values } : { enum: values };
  }
  if (schema instanceof ZodArray) {
    return { type: "array", items: zodToJsonSchema(schema.element) };
  }
  if (schema instanceof ZodObject) {
    const shape = schema.shape as Record<string, ZodTypeAny>;
    const properties: JsonSchema = {};
    const required: string[] = [];
    for (const [key, value] of Object.entries(shape)) {
      properties[key] = zodToJsonSchema(value);
      if (!(value instanceof ZodOptional) && !isNullableWithDefault(value)) required.push(key);
    }
    return {
      type: "object",
      properties,
      ...(required.length ? { required } : {}),
      additionalProperties: false,
    };
  }
  if (schema instanceof ZodRecord) {
    return { type: "object", additionalProperties: zodToJsonSchema(schema.keySchema ? schema.valueSchema : (schema as unknown as { valueSchema: ZodTypeAny }).valueSchema) };
  }
  if (schema instanceof ZodUnion) {
    const options = (schema as unknown as { options: ZodTypeAny[] }).options;
    return { anyOf: options.map((o) => zodToJsonSchema(o)) };
  }
  if (schema instanceof ZodOptional) return convert(schema.unwrap());
  if (schema instanceof ZodNullable) {
    const inner = convert(schema.unwrap());
    return inner ? { ...inner, nullable: true } : null;
  }
  if (schema instanceof ZodDefault) return convert(schema.removeDefault());
  if (schema instanceof ZodAny) return {};
  return null;
}

function isNullableWithDefault(schema: ZodTypeAny): boolean {
  return schema instanceof ZodDefault || (schema instanceof ZodNullable && schema instanceof ZodDefault);
}
