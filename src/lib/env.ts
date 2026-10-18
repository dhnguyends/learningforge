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
  AI_PROVIDER: z.enum(["mock", "openai", "anthropic", "local", "gemini", "zai"]).default("mock"),
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
  // Per model and call (all retries); each attempt also has its own timeout,
  // since an overloaded model can hang instead of answering 503.
  GEMINI_TIMEOUT_MS: z.coerce.number().int().positive().default(180_000),
  GEMINI_ATTEMPT_TIMEOUT_MS: z.coerce.number().int().positive().default(90_000),
  // Used when GEMINI_MODEL stays unavailable (503 "high demand", hangs); "" disables.
  GEMINI_FALLBACK_MODEL: z.string().default("gemini-3.5-flash-lite"),
  GEMINI_MAX_TOKENS: z.coerce.number().int().positive().default(16_384),

  // GLM served directly by Z.ai. The key never leaves the server. Pay-as-you-go
  // keys use /api/paas/v4; GLM Coding Plan keys only work on /api/coding/paas/v4.
  ZAI_API_KEY: z.string().optional(),
  GLM_AI_MODEL: z.string().default("glm-5.3-flash"),
  // Z.ai Coding Plan credits: tokens per credit, to estimate a course's cost
  // in credits (measured on GLM-5.3-Flash in October 2026: about 5,400).
  ZAI_TOKENS_PER_CREDIT: z.coerce.number().positive().default(5_400),
  // Azure AI Translator free tier (F0): characters per calendar month. At 80 %
  // and at the limit, Admin suggests switching the translator to a local model.
  AZURE_TRANSLATOR_FREE_CHARS: z.coerce.number().int().positive().default(2_000_000),
  AZURE_TRANSLATOR_FALLBACK_MODEL: z.string().default("gemma4:e2b"),
  ZAI_BASE_URL: z.string().default("https://api.z.ai/api/paas/v4"),
  // GLM-5.3 always thinks and defaults to "max" — very slow for structured output.
  ZAI_REASONING_EFFORT: z.enum(["low", "high", "max"]).default("low"),
  ZAI_TIMEOUT_MS: z.coerce.number().int().positive().default(300_000),
  ZAI_ATTEMPT_TIMEOUT_MS: z.coerce.number().int().positive().default(150_000),
  ZAI_MAX_TOKENS: z.coerce.number().int().positive().default(16_384),

  // ollama = local Ollama /api/embed (e.g. embeddinggemma, multilingual, 768-d padded to 1536).
  EMBEDDINGS_PROVIDER: z.enum(["mock", "openai", "ollama"]).default("mock"),
  OLLAMA_EMBEDDINGS_MODEL: z.string().default("embeddinggemma"),
  // Cosine-similarity floor for retrieval; unset = the provider's calibrated default.
  RETRIEVAL_MIN_SCORE: z.coerce.number().min(0).max(1).optional(),
  EMBEDDINGS_MODEL: z.string().default("text-embedding-3-small"),
  EMBEDDINGS_DIMENSIONS: z.coerce.number().int().positive().default(1536),

  TRANSCRIPTION_PROVIDER: z.enum(["mock", "whisper", "deepgram"]).default("mock"),
  // Mock transcription writes placeholder text ("[mock transcription 3] Lecture audio
  // segment…") that then feeds search and generation as if it were the lecture.
  // Allowed only in tests or when explicitly enabled for demos.
  ALLOW_MOCK_PROVIDERS: boolish,
  WHISPER_BASE_URL: z.string().default("https://api.openai.com/v1"),
  WHISPER_API_KEY: z.string().optional(),
  WHISPER_MODEL: z.string().default("whisper-1"),
  // One transcription request (the whole lecture). A local GPU server such as
  // Speaches runs ~5x real time on a GTX 1080 Ti, so a 90-minute lecture needs
  // ~20 minutes — far beyond the OpenAI SDK's 10-minute default.
  WHISPER_TIMEOUT_MS: z.coerce.number().int().positive().default(3_600_000),
  DEEPGRAM_API_KEY: z.string().optional(),

  // Read-aloud of sources (FR/EN). The model is chosen at /admin → AI model:
  // local Kokoro / Piper through the Speaches server, Azure Neural TTS or Gemini TTS.
  SPEACHES_BASE_URL: z.string().default("http://localhost:8000/v1"),
  GEMINI_TTS_MODEL: z.string().default("gemini-3.8-flash-lite-tts"),
  // Azure (optional): Speech for TTS, Translator for FR→EN. Keys stay server-side.
  AZURE_SPEECH_KEY: z.string().optional(),
  AZURE_SPEECH_REGION: z.string().default("westeurope"),
  AZURE_TRANSLATOR_KEY: z.string().optional(),
  AZURE_TRANSLATOR_REGION: z.string().default("westeurope"),
  AZURE_TRANSLATOR_ENDPOINT: z.string().default("https://api.cognitive.microsofttranslator.com"),
  // Audio-recap TTS (separate from read-aloud).
  TTS_PROVIDER: z.enum(["mock", "openai"]).default("mock"),
  TTS_MODEL: z.string().default("tts-1"),
  TTS_VOICE: z.string().default("alloy"),

  YOUTUBE_API_KEY: z.string().optional(),

  SMTP_URL: z.string().optional(),

  // Web Push for PolyLingue reminders (generate with: npx web-push generate-vapid-keys).
  VAPID_PUBLIC_KEY: z.string().optional(),
  VAPID_PRIVATE_KEY: z.string().optional(),
  VAPID_SUBJECT: z.string().optional(),

  // GPU detection (nvidia-smi) for local processing; "off" = always report No GPU.
  GPU_DETECTION: z.enum(["auto", "off"]).default("auto"),
  // Without a GPU, local transcription/embedding/Gemma timeouts are multiplied by this.
  CPU_TIMEOUT_FACTOR: z.coerce.number().min(1).max(20).default(4),

  // Tokens of source passages a whole-course generation (guide outline, flashcards,
  // quiz, exercises) may read: the whole course when it fits, otherwise a spread sample.
  WHOLE_SET_TOKEN_BUDGET: z.coerce.number().int().positive().default(60_000),
  WHOLE_SET_TOKEN_BUDGET_LOCAL: z.coerce.number().int().positive().default(6_000),

  GENERATION_RATE_LIMIT_PER_HOUR: z.coerce.number().int().positive().default(30),
});

export type Env = z.infer<typeof envSchema>;

const WEAK_SECRETS = new Set(["change-me-development-secret", "lectureforge-development-secret"]);

let cached: Env | null = null;

/**
 * Azure settings may also use the names of the Azure portal (AZ_API_KEY1/2 = one
 * Azure AI Services key for both Speech and Translator, AZ_VOICE_SYNTHESIS =
 * the regional TTS endpoint, AZ_API_TRANSLATE = the Translator endpoint). The
 * AZURE_* variables win when both are set.
 */
function applyAzureAliases(env: Env, raw: NodeJS.ProcessEnv): void {
  const key = raw.AZ_API_KEY1?.trim() || raw.AZ_API_KEY2?.trim();
  const region = azureRegionOf(raw.AZ_VOICE_SYNTHESIS) ?? azureRegionOf(raw.AZ_VOICE_RECOGNITION);
  if (key && !env.AZURE_SPEECH_KEY?.trim()) env.AZURE_SPEECH_KEY = key;
  if (key && !env.AZURE_TRANSLATOR_KEY?.trim()) env.AZURE_TRANSLATOR_KEY = key;
  if (region && !raw.AZURE_SPEECH_REGION) env.AZURE_SPEECH_REGION = region;
  if (region && !raw.AZURE_TRANSLATOR_REGION) env.AZURE_TRANSLATOR_REGION = region;
  if (raw.AZ_API_TRANSLATE?.trim() && !raw.AZURE_TRANSLATOR_ENDPOINT) env.AZURE_TRANSLATOR_ENDPOINT = raw.AZ_API_TRANSLATE.trim();
}

/** "https://eastus.tts.speech.microsoft.com" → "eastus". */
export function azureRegionOf(url: string | undefined): string | undefined {
  return /^https?:\/\/([a-z0-9]+)\.(?:tts|stt)\.speech\.microsoft\.com/i.exec(url?.trim() ?? "")?.[1]?.toLowerCase();
}

export function getEnv(): Env {
  if (cached) return cached;

  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Invalid environment configuration: ${issues}`);
  }

  const env = parsed.data;
  applyAzureAliases(env, process.env);

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

/** Placeholder (mock) transcription may run: in tests, or when ALLOW_MOCK_PROVIDERS=true. */
export function mockProvidersAllowed(env: Env = getEnv()): boolean {
  return env.NODE_ENV === "test" || env.ALLOW_MOCK_PROVIDERS;
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
