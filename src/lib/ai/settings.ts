import { z } from "zod";
import { prisma } from "@/lib/db";
import { getEnv, type Env } from "@/lib/env";
import { installedModels, localModelLabel, sameModel } from "@/lib/ai/ollama";

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

/** An Ollama model name ("gemma4:latest", "hf.co/user/repo:Q4_K_M"); checked against the installed models when saved. */
export const ollamaModelName = z
  .string()
  .trim()
  .regex(/^[\w.\-/]+(:[\w.\-]+)?$/, "Not an Ollama model name")
  .max(100);

export const aiChoiceSchema = z.discriminatedUnion("provider", [
  // An installed Ollama model (checked when saved); LOCAL_AI_MODEL when absent.
  z.object({ provider: z.literal("local"), model: ollamaModelName.optional() }),
  z.object({ provider: z.literal("gemini"), model: z.enum(GEMINI_MODEL_IDS) }),
  // GLM served by Z.ai; the model is GLM_AI_MODEL.
  z.object({ provider: z.literal("zai") }),
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

export function zaiConfigured(env: Env = getEnv()): boolean {
  return Boolean(env.ZAI_API_KEY?.trim());
}

/** Z.ai model codes are lower-case; GLM_AI_MODEL may be written "GLM-5.3-Flash". */
export function zaiModel(env: Env = getEnv()): string {
  return env.GLM_AI_MODEL.trim().toLowerCase();
}

function envDefault(env: Env): ResolvedAi {
  // A cloud default without its key would fail every job, so run locally instead.
  if ((env.AI_PROVIDER === "gemini" && !geminiConfigured(env)) || (env.AI_PROVIDER === "zai" && !zaiConfigured(env))) {
    return { provider: "local", model: env.LOCAL_AI_MODEL, source: "fallback" };
  }
  const model =
    env.AI_PROVIDER === "local"
      ? env.LOCAL_AI_MODEL
      : env.AI_PROVIDER === "gemini"
        ? env.GEMINI_MODEL
        : env.AI_PROVIDER === "zai"
          ? zaiModel(env)
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
 * offline demos) is never overridden, and a cloud choice without its key
 * (GEMINI_API_KEY, ZAI_API_KEY) falls back to the environment default instead of
 * failing every job.
 */
export function resolveAi(choice: AiChoice | null, env: Env = getEnv()): ResolvedAi {
  const fallback = envDefault(env);
  if (env.AI_PROVIDER === "mock" || !choice) return fallback;
  if (choice.provider === "local") return { provider: "local", model: choice.model ?? env.LOCAL_AI_MODEL, source: "admin" };
  if (choice.provider === "zai") {
    if (!zaiConfigured(env)) return { ...fallback, source: "fallback" };
    return { provider: "zai", model: zaiModel(env), source: "admin" };
  }
  if (!geminiConfigured(env)) return { ...fallback, source: "fallback" };
  return { provider: "gemini", model: choice.model, source: "admin" };
}

export async function getActiveAi(): Promise<ResolvedAi> {
  const env = getEnv();
  if (env.AI_PROVIDER === "mock") return envDefault(env);
  return resolveAi(await getStoredAiChoice(), env);
}

/**
 * The local models an administrator can pick: those installed in Ollama that
 * write text (embeddings-only models excluded). Without Ollama, just
 * LOCAL_AI_MODEL, marked not installed.
 */
export async function localModelOptions(env: Env = getEnv()) {
  const fallback = [{ name: env.LOCAL_AI_MODEL, label: localModelLabel(env.LOCAL_AI_MODEL), parameterSize: null, sizeBytes: 0, thinking: false, installed: false }];
  try {
    const models = (await installedModels(env)).filter((m) => m.generation);
    if (!models.length) return fallback;
    return models.map((m) => ({ name: m.name, label: m.label, parameterSize: m.parameterSize, sizeBytes: m.sizeBytes, thinking: m.capabilities.includes("thinking"), installed: true }));
  } catch {
    return fallback;
  }
}

/** Why `model` cannot be used as the local model (not installed, embeddings only, Ollama down), or null. */
export async function localModelProblem(model: string, env: Env = getEnv()): Promise<string | null> {
  let models;
  try {
    models = await installedModels(env);
  } catch {
    return `Ollama is not reachable at ${env.LOCAL_AI_BASE_URL}: start it before choosing a local model`;
  }
  const hit = models.find((m) => sameModel(m.name, model));
  if (!hit) return `${model} is not installed in Ollama (run: ollama pull ${model})`;
  if (!hit.generation) return `${model} is an embeddings model: it cannot write text`;
  return null;
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
    localModels: env.AI_PROVIDER === "mock" ? [] : await localModelOptions(env),
    geminiConfigured: geminiConfigured(env),
    geminiModels: GEMINI_MODELS,
    zai: {
      configured: zaiConfigured(env),
      model: zaiModel(env),
      label: aiLabel({ provider: "zai", model: zaiModel(env) }),
    },
  };
}
export type AiSettingsView = Awaited<ReturnType<typeof aiSettingsView>>;

/** Human label for the top bar ("Gemini 3.8 Flash", "GLM-5.3", "Gemma 4 · local"). */
export function aiLabel(ai: Pick<ResolvedAi, "provider" | "model">): string {
  if (ai.provider === "gemini") return GEMINI_MODELS.find((m) => m.id === ai.model)?.label ?? ai.model;
  if (ai.provider === "local") return `${localModelLabel(ai.model)} · local`;
  if (ai.provider === "zai") return glmLabel(ai.model);
  if (ai.provider === "mock") return "Offline demo";
  return ai.model;
}

/** "glm-5.3-flash" → "GLM-5.3-Flash". */
export function glmLabel(model: string): string {
  return model
    .replace(/^glm/i, "GLM")
    .replace(/-([a-z])/g, (_m, c: string) => `-${c.toUpperCase()}`);
}
