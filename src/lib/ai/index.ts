import { getEnv } from "@/lib/env";
import type { StructuredGenerator } from "@/lib/ai/types";
import { MockGenerator } from "@/lib/ai/mock";
import { OpenAIGenerator } from "@/lib/ai/openai";
import { AnthropicGenerator } from "@/lib/ai/anthropic";
import { LocalGenerator } from "@/lib/ai/local";

let cached: StructuredGenerator | null = null;

export function getGenerator(): StructuredGenerator {
  if (cached) return cached;
  const env = getEnv();
  switch (env.AI_PROVIDER) {
    case "openai":
      cached = new OpenAIGenerator(env);
      break;
    case "anthropic":
      cached = new AnthropicGenerator(env);
      break;
    case "local":
      cached = new LocalGenerator(env);
      break;
    default:
      cached = new MockGenerator();
  }
  return cached;
}

export function isMockAI(): boolean {
  return getEnv().AI_PROVIDER === "mock";
}

export type { StructuredGenerator, GenerateOptions, GenerationResult } from "@/lib/ai/types";
