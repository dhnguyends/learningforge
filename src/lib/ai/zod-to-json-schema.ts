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
 *
 * Size constraints (string min/max length, array min/max items, number
 * ranges, integers) are carried over: the schema is the only place a model
 * learns them, and Ollama/llama.cpp enforce them while decoding. Without them
 * a local model happily emits 30 outline sections against a max of 24 and the
 * Zod validation after the fact fails the whole job.
 */
export function zodToJsonSchema(schema: ZodTypeAny): JsonSchema {
  return convert(schema) ?? { type: "string" };
}

function convert(schema: ZodTypeAny): JsonSchema | null {
  if (schema instanceof ZodString) return { type: "string", ...stringBounds(schema) };
  if (schema instanceof ZodNumber) return numberSchema(schema);
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
    return { type: "array", items: zodToJsonSchema(schema.element), ...arrayBounds(schema) };
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

type Check = { kind: string; value?: number; inclusive?: boolean };

function stringBounds(schema: ZodString): JsonSchema {
  const out: JsonSchema = {};
  for (const check of (schema._def.checks ?? []) as Check[]) {
    if (check.kind === "min") out.minLength = check.value;
    if (check.kind === "max") out.maxLength = check.value;
    if (check.kind === "length") out.minLength = out.maxLength = check.value;
  }
  return out;
}

function numberSchema(schema: ZodNumber): JsonSchema {
  const out: JsonSchema = { type: "number" };
  for (const check of (schema._def.checks ?? []) as Check[]) {
    if (check.kind === "int") out.type = "integer";
    if (check.kind === "min") out[check.inclusive === false ? "exclusiveMinimum" : "minimum"] = check.value;
    if (check.kind === "max") out[check.inclusive === false ? "exclusiveMaximum" : "maximum"] = check.value;
  }
  return out;
}

function arrayBounds(schema: ZodArray<ZodTypeAny>): JsonSchema {
  const def = schema._def as {
    minLength: { value: number } | null;
    maxLength: { value: number } | null;
    exactLength: { value: number } | null;
  };
  const out: JsonSchema = {};
  if (def.exactLength) out.minItems = out.maxItems = def.exactLength.value;
  if (def.minLength) out.minItems = def.minLength.value;
  if (def.maxLength) out.maxItems = def.maxLength.value;
  return out;
}

function isNullableWithDefault(schema: ZodTypeAny): boolean {
  return schema instanceof ZodDefault || (schema instanceof ZodNullable && schema instanceof ZodDefault);
}
