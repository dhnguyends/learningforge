import { describe, it, expect } from "vitest";
import { z } from "zod";
import { zodToJsonSchema } from "@/lib/ai/zod-to-json-schema";
import { guideOutlineSchema } from "@/lib/pipelines/schemas";

/**
 * The JSON Schema is the only place a model learns size limits, and local
 * models (Ollama/llama.cpp) enforce them while decoding — so Zod constraints
 * must survive the conversion (Gemma used to emit >24 outline sections and
 * 200+ char objectives, failing the guide job after two attempts).
 */
describe("zodToJsonSchema constraints", () => {
  it("carries string length bounds", () => {
    expect(zodToJsonSchema(z.string().min(3).max(120))).toEqual({ type: "string", minLength: 3, maxLength: 120 });
    expect(zodToJsonSchema(z.string().length(5))).toEqual({ type: "string", minLength: 5, maxLength: 5 });
  });

  it("carries array item bounds", () => {
    expect(zodToJsonSchema(z.array(z.string()).min(1).max(24))).toMatchObject({ type: "array", minItems: 1, maxItems: 24 });
    expect(zodToJsonSchema(z.array(z.string()).length(3))).toMatchObject({ minItems: 3, maxItems: 3 });
  });

  it("carries number ranges and integer-ness", () => {
    expect(zodToJsonSchema(z.number().int().min(3).max(180))).toEqual({ type: "integer", minimum: 3, maximum: 180 });
    expect(zodToJsonSchema(z.number().gt(0).lt(1))).toEqual({ type: "number", exclusiveMinimum: 0, exclusiveMaximum: 1 });
  });

  it("keeps bounds through optional wrappers", () => {
    const schema = zodToJsonSchema(z.object({ objective: z.string().max(200).optional() })) as {
      properties: { objective: unknown };
      required?: string[];
    };
    expect(schema.properties.objective).toEqual({ type: "string", maxLength: 200 });
    expect(schema.required).toBeUndefined();
  });

  it("exposes the guide outline limits that failed in production", () => {
    const outline = zodToJsonSchema(guideOutlineSchema) as {
      properties: { sections: { maxItems: number; items: { properties: { learningObjective: unknown } } } };
    };
    expect(outline.properties.sections.maxItems).toBe(24);
    expect(outline.properties.sections.items.properties.learningObjective).toEqual({ type: "string", maxLength: 200 });
  });
});
