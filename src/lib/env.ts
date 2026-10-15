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
  // Site-wide access key (src/lib/access-gate.ts); unset = no gate. Read directly
  // from process.env by the middleware; declared here for validation and docs.
  LECTURE_ACCESS_KEY: z.string().optional(),

  QUEUE_DRIVER: z.enum(["inline", "redis"]).default("inline"),
  REDIS_URL: z.string().optional(),

  STORAGE_DRIVER: z.enum(["local", "s3"]).default("local"),
  S3_ENDPOINT: z.string().optional(),
  S3_REGION: z.string().default("us-east-1"),
  S3_BUCKET: z.string().default("lectureforge"),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  SIGNED_URL_TTL: z.coerce.number().int().positive().default(3600),

  // Default provider. Administrators can switch between "local" and "gemini" at
  // runtime from /admin (stored in app_settings; see src/lib/ai/settings.ts).
  AI_PROVIDER: z.enum(["mock", "openai", "anthropic", "local", "gemini"]).default("mock"),
  AI_MODEL: z.string().default("gpt-4o-mini"),
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_BASE_URL: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
  ANTHROPIC_MODEL: z.string().default("claude-sonnet-4-5"),
  LOCAL_AI_BASE_URL: z.string().default("http://localhost:11434"),
  LOCAL_AI_MODEL: z.string().default("llama3.1"),
  // Reasoning models (Gemma 4, Qwen 3, DeepSeek-R1…) "think" by default, which
  // multiplies latency for structured generation; off unless asked for.
  LOCAL_AI_THINK: boolish,
  LOCAL_AI_TIMEOUT_MS: z.coerce.number().int().positive().default(300_000),
  // Output cap per call (Ollama num_predict). Grammar-constrained local models
  // occasionally run away (one Gemma 4 section call hit 14k+ tokens); a cap turns
  // that into a fast, repairable failure instead of a timeout.
  LOCAL_AI_MAX_TOKENS: z.coerce.number().int().positive().default(4096),
  // Context window override; unset = let Ollama size it for the available memory.
  LOCAL_AI_NUM_CTX: z.coerce.number().int().positive().optional(),

  // Google Gemini API (cloud). The key stays server-side: never stored in the
  // database or returned by any API.
  GEMINI_API_KEY: z.string().optional(),
  GEMINI_MODEL: z.string().default("gemini-3.8-flash"),
  GEMINI_BASE_URL: z.string().default("https://generativelanguage.googleapis.com/v1beta"),
  // gemini-3.8-flash rejects "minimal"; thinking tokens are billed as output.
  GEMINI_THINKING_LEVEL: z.enum(["low", "medium", "high"]).default("low"),
  GEMINI_TIMEOUT_MS: z.coerce.number().int().positive().default(180_000),
  GEMINI_MAX_TOKENS: z.coerce.number().int().positive().default(16_384),

  // ollama = local Ollama /api/embed (e.g. embeddinggemma, multilingual, 768-d padded to 1536).
  EMBEDDINGS_PROVIDER: z.enum(["mock", "openai", "ollama"]).default("mock"),
  OLLAMA_EMBEDDINGS_MODEL: z.string().default("embeddinggemma"),
  // Cosine-similarity floor for retrieval; unset = the provider's calibrated default.
  RETRIEVAL_MIN_SCORE: z.coerce.number().min(0).max(1).optional(),
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

const WEAK_SECRETS = new Set(["change-me-development-secret", "lectureforge-development-secret"]);

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
    // Sessions and local upload tickets are signed with this secret; the
    // checked-in example values would let anyone forge both.
    if (env.LECTURE_ACCESS_KEY !== undefined && env.LECTURE_ACCESS_KEY.trim().length > 0 && env.LECTURE_ACCESS_KEY.trim().length < 12) {
      throw new Error("LECTURE_ACCESS_KEY must be at least 12 characters in production");
    }
    if (env.NEXTAUTH_SECRET.length < 32 || WEAK_SECRETS.has(env.NEXTAUTH_SECRET)) {
      throw new Error("NEXTAUTH_SECRET is too weak for production; generate one with: openssl rand -base64 32");
    }
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
