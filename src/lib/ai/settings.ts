import { z } from "zod";
import { prisma } from "@/lib/db";
import { getEnv, type Env } from "@/lib/env";

/**
 * Which generation model the app uses, chosen by an administrator at /admin
 * and stored in `app_settings` (key "ai"). Without a stored choice the
 * environment default (AI_PROVIDER) applies.
 *
 * Only the generation model is switchable. Embeddings stay on the configured
 * EMBEDDINGS_PROVIDER: changing them requires re-embedding every chunk.
 */

/** Gemini models offered in the selector (stable ids only; see docs/GEMINI-ASSESSMENT.md). */
export const GEMINI_MODELS = [
  { id: "gemini-3.8-flash", label: "Gemini 3.8 Flash", note: "Recommended: best quality for guides, quizzes and exercises" },
  { id: "gemini-3.5-flash-lite", label: "Gemini 3.5 Flash-Lite", note: "Cheaper and faster; lighter on reasoning" },
] as const;

export type GeminiModelId = (typeof GEMINI_MODELS)[number]["id"];
const GEMINI_MODEL_IDS = GEMINI_MODELS.map((m) => m.id) as [GeminiModelId, ...GeminiModelId[]];

export const aiChoiceSchema = z.discriminatedUnion("provider", [
  z.object({ provider: z.literal("local") }),
  z.object({ provider: z.literal("gemini"), model: z.enum(GEMINI_MODEL_IDS) }),
]);
export type AiChoice = z.infer<typeof aiChoiceSchema>;

/** What the app actually runs with, after defaults and fallbacks. */
export interface ResolvedAi {
  provider: Env["AI_PROVIDER"];
  model: string;
  /** "admin" = stored choice; "env" = AI_PROVIDER default; "fallback" = Gemini chosen without GEMINI_API_KEY (runs locally). */
  source: "admin" | "env" | "fallback";
}

const SETTING_KEY = "ai";
// The admin route invalidates this in-process; the TTL covers a separate
// worker process (QUEUE_DRIVER=redis) picking up a change.
const TTL_MS = 30_000;
let memo: { choice: AiChoice | null; at: number } | null = null;

export function geminiConfigured(env: Env = getEnv()): boolean {
  return Boolean(env.GEMINI_API_KEY?.trim());
}

function envDefault(env: Env): ResolvedAi {
  // Gemini is the default; without a key it would fail every job, so run locally instead.
  if (env.AI_PROVIDER === "gemini" && !geminiConfigured(env)) {
    return { provider: "local", model: env.LOCAL_AI_MODEL, source: "fallback" };
  }
  const model =
    env.AI_PROVIDER === "local"
      ? env.LOCAL_AI_MODEL
      : env.AI_PROVIDER === "gemini"
        ? env.GEMINI_MODEL
        : env.AI_PROVIDER === "anthropic"
          ? env.ANTHROPIC_MODEL
          : env.AI_PROVIDER === "openai"
            ? env.AI_MODEL
            : "mock";
  return { provider: env.AI_PROVIDER, model, source: "env" };
}

export async function getStoredAiChoice(): Promise<AiChoice | null> {
  if (memo && Date.now() - memo.at < TTL_MS) return memo.choice;
  const row = await prisma.appSetting.findUnique({ where: { key: SETTING_KEY } });
  const parsed = row ? aiChoiceSchema.safeParse(row.value) : null;
  const choice = parsed?.success ? parsed.data : null;
  memo = { choice, at: Date.now() };
  return choice;
}

export async function saveAiChoice(choice: AiChoice, userId: string): Promise<void> {
  await prisma.appSetting.upsert({
    where: { key: SETTING_KEY },
    create: { key: SETTING_KEY, value: choice, updatedById: userId },
    update: { value: choice, updatedById: userId },
  });
  memo = { choice, at: Date.now() };
}

export function invalidateAiChoice(): void {
  memo = null;
}

/**
 * Applies the stored choice on top of the environment. Mock mode (tests,
 * offline demos) is never overridden, and a Gemini choice without an API key
 * falls back to the environment default instead of failing every job.
 */
export function resolveAi(choice: AiChoice | null, env: Env = getEnv()): ResolvedAi {
  const fallback = envDefault(env);
  if (env.AI_PROVIDER === "mock" || !choice) return fallback;
  if (choice.provider === "local") return { provider: "local", model: env.LOCAL_AI_MODEL, source: "admin" };
  if (!geminiConfigured(env)) return { ...fallback, source: "fallback" };
  return { provider: "gemini", model: choice.model, source: "admin" };
}

export async function getActiveAi(): Promise<ResolvedAi> {
  const env = getEnv();
  if (env.AI_PROVIDER === "mock") return envDefault(env);
  return resolveAi(await getStoredAiChoice(), env);
}

/** What /admin shows: the active model, the stored choice and what can be picked. Never the API key. */
export async function aiSettingsView() {
  const env = getEnv();
  const stored = env.AI_PROVIDER === "mock" ? null : await getStoredAiChoice();
  return {
    active: resolveAi(stored, env),
    stored,
    envDefault: envDefault(env),
    mockMode: env.AI_PROVIDER === "mock",
    localModel: env.LOCAL_AI_MODEL,
    geminiConfigured: geminiConfigured(env),
    geminiModels: GEMINI_MODELS,
  };
}
export type AiSettingsView = Awaited<ReturnType<typeof aiSettingsView>>;

/** Human label for the top bar ("Gemini 3.8 Flash", "Gemma 4 · local"). */
export function aiLabel(ai: Pick<ResolvedAi, "provider" | "model">): string {
  if (ai.provider === "gemini") return GEMINI_MODELS.find((m) => m.id === ai.model)?.label ?? ai.model;
  if (ai.provider === "local") return /gemma-?4/i.test(ai.model) ? "Gemma 4 · local" : `${ai.model} · local`;
  if (ai.provider === "mock") return "Offline demo";
  return ai.model;
}
