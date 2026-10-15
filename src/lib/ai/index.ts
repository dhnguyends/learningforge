import { getEnv } from "@/lib/env";
import type { StructuredGenerator } from "@/lib/ai/types";
import { MockGenerator } from "@/lib/ai/mock";
import { OpenAIGenerator } from "@/lib/ai/openai";
import { AnthropicGenerator } from "@/lib/ai/anthropic";
import { LocalGenerator } from "@/lib/ai/local";
import { GeminiGenerator } from "@/lib/ai/gemini";
import { getActiveAi, type ResolvedAi } from "@/lib/ai/settings";

const cache = new Map<string, StructuredGenerator>();

/** Generator for one provider/model pair (cached; adapters are stateless). */
export function generatorFor(ai: Pick<ResolvedAi, "provider" | "model">): StructuredGenerator {
  const key = `${ai.provider}:${ai.model}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const env = getEnv();
  let generator: StructuredGenerator;
  switch (ai.provider) {
    case "openai":
      generator = new OpenAIGenerator(env);
      break;
    case "anthropic":
      generator = new AnthropicGenerator(env);
      break;
    case "local":
      generator = new LocalGenerator(env);
      break;
    case "gemini":
      generator = new GeminiGenerator(env, ai.model);
      break;
    default:
      generator = new MockGenerator();
  }
  cache.set(key, generator);
  return generator;
}

/**
 * The generator for the model currently selected by an administrator
 * (/admin → AI model), or the AI_PROVIDER default. Resolved per call so a
 * change applies to the next generation without a restart.
 */
export async function getGenerator(): Promise<StructuredGenerator> {
  return generatorFor(await getActiveAi());
}

export function isMockAI(): boolean {
  return getEnv().AI_PROVIDER === "mock";
}

export type { StructuredGenerator, GenerateOptions, GenerationResult } from "@/lib/ai/types";
