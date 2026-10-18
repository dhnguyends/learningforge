import type { ZodTypeAny, output } from "zod";

export interface GenerateOptions<S extends ZodTypeAny> {
  /** What the call is for, in the AI usage records when no withAiUsage context says it ("polylingue"…). */
  feature?: string;
  system: string;
  user: string;
  schema: S;
  temperature?: number;
  maxTokens?: number;
  /**
   * Deterministic builder used when AI_PROVIDER=mock (offline dev/tests).
   * Pipelines provide these so the full product works without API keys and
   * mock output still carries real chunk-level citations.
   */
  mock?: () => output<S>;
}

export interface GenerationResult<S extends ZodTypeAny> {
  data: output<S>;
  provider: string;
  model: string;
  usage: { inputTokens: number; outputTokens: number };
}

export interface StructuredGenerator {
  readonly provider: string;
  readonly model: string;
  /** Every generation returns JSON validated against the caller's Zod schema. */
  generate<S extends ZodTypeAny>(opts: GenerateOptions<S>): Promise<GenerationResult<S>>;
}

export class AIProviderError extends Error {
  constructor(message: string, public cause?: unknown) {
    super(message);
    this.name = "AIProviderError";
  }
}

/** Shared instruction appended to every structured call. */
export const JSON_CONTRACT_INSTRUCTION = `Return ONLY a single JSON object that exactly matches the requested structure. No markdown fences, no commentary before or after. Every factual claim must carry its source anchor fields; if a required fact is absent from the provided context, use the provided "warnings" field instead of inventing content.`;
