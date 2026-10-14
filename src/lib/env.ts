import { z } from "zod";

/**
 * Server-side environment. Validated once, lazily, so a misconfigured deploy
 * fails loudly on first use instead of deep inside a job processor.
 * Client bundles must never import this file.
 */

const boolish = z
  .string()
  .optional()
  .transform((v) => v === "true" || v === "1");

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  APP_URL: z.string().optional(),
  DATABASE_URL: z.string().min(1),

  NEXTAUTH_URL: z.string().optional(),
  NEXTAUTH_SECRET: z.string().optional(),

  QUEUE_DRIVER: z.enum(["inline", "redis"]).default("inline"),
  REDIS_URL: z.string().optional(),

  STORAGE_DRIVER: z.enum(["local", "s3"]).default("local"),
  S3_ENDPOINT: z.string().optional(),
  S3_REGION: z.string().default("us-east-1"),
  S3_BUCKET: z.string().default("lectureforge"),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  SIGNED_URL_TTL: z.coerce.number().int().positive().default(3600),

  AI_PROVIDER: z.enum(["mock", "openai", "anthropic", "local"]).default("mock"),
  AI_MODEL: z.string().default("gpt-4o-mini"),
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_BASE_URL: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
  ANTHROPIC_MODEL: z.string().default("claude-sonnet-4-5"),
  LOCAL_AI_BASE_URL: z.string().default("http://localhost:11434"),
  LOCAL_AI_MODEL: z.string().default("llama3.1"),

  EMBEDDINGS_PROVIDER: z.enum(["mock", "openai"]).default("mock"),
  EMBEDDINGS_MODEL: z.string().default("text-embedding-3-small"),
  EMBEDDINGS_DIMENSIONS: z.coerce.number().int().positive().default(1536),

  TRANSCRIPTION_PROVIDER: z.enum(["mock", "whisper", "deepgram"]).default("mock"),
  WHISPER_BASE_URL: z.string().default("https://api.openai.com/v1"),
  WHISPER_API_KEY: z.string().optional(),
  WHISPER_MODEL: z.string().default("whisper-1"),
  DEEPGRAM_API_KEY: z.string().optional(),

  TTS_PROVIDER: z.enum(["mock", "openai"]).default("mock"),
  TTS_MODEL: z.string().default("tts-1"),
  TTS_VOICE: z.string().default("alloy"),

  YOUTUBE_API_KEY: z.string().optional(),

  SMTP_URL: z.string().optional(),

  GENERATION_RATE_LIMIT_PER_HOUR: z.coerce.number().int().positive().default(30),
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | null = null;

export function getEnv(): Env {
  if (cached) return cached;

  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Invalid environment configuration: ${issues}`);
  }

  const env = parsed.data;

  // Fail loudly in production for secrets that matter; stay frictionless in dev.
  if (env.NODE_ENV === "production") {
    if (!env.NEXTAUTH_SECRET) throw new Error("NEXTAUTH_SECRET is required in production");
    if (env.STORAGE_DRIVER === "s3" && (!env.S3_ACCESS_KEY_ID || !env.S3_SECRET_ACCESS_KEY)) {
      throw new Error("S3 credentials are required when STORAGE_DRIVER=s3");
    }
  }

  if (!env.NEXTAUTH_SECRET && env.NODE_ENV !== "production") {
    env.NEXTAUTH_SECRET = "lectureforge-development-secret";
  }

  cached = env;
  return env;
}

/** True when the app is running fully offline with deterministic mocks. */
export function isMockMode(): boolean {
  const env = getEnv();
  return (
    env.AI_PROVIDER === "mock" ||
    env.EMBEDDINGS_PROVIDER === "mock" ||
    env.TRANSCRIPTION_PROVIDER === "mock"
  );
}
