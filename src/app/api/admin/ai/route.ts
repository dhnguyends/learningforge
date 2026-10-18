import { apiHandler, ok, parseJsonBody, requireAdmin, badRequest } from "@/lib/api";
import { audit } from "@/lib/audit";
import { getEnv } from "@/lib/env";
import { aiChoiceSchema, aiSettingsView, geminiConfigured, getStoredAiChoice, localModelProblem, saveAiChoice, zaiConfigured } from "@/lib/ai/settings";
import { switchLocalModel } from "@/lib/ai/ollama";
import { translatorFollowsAiModel } from "@/lib/speech/settings";
import { releaseUnusedLocalModels } from "@/lib/ai/gpu-policy";

/**
 * The generation model used by every pipeline, chosen by an administrator.
 * Choosing a local model clears the GPU of every other Ollama model first
 * (checked), then loads the chosen one; the answer reports what was freed.
 */

export const GET = apiHandler(async () => {
  await requireAdmin();
  return ok(await aiSettingsView());
});

export const PUT = apiHandler(async (req) => {
  const admin = await requireAdmin();
  const choice = await parseJsonBody(req, aiChoiceSchema);
  const env = getEnv();
  if (env.AI_PROVIDER === "mock") throw badRequest("AI_PROVIDER=mock (offline mode) cannot be changed from the admin page");
  if (choice.provider === "gemini" && !geminiConfigured(env)) {
    throw badRequest("Set GEMINI_API_KEY in the server environment before selecting Gemini");
  }
  if (choice.provider === "zai" && !zaiConfigured(env)) {
    throw badRequest("Set ZAI_API_KEY in the server environment before selecting GLM (Z.ai)");
  }
  const localModel = choice.provider === "local" ? (choice.model ?? env.LOCAL_AI_MODEL) : null;
  if (localModel) {
    const problem = await localModelProblem(localModel, env);
    if (problem) throw badRequest(problem);
  }
  const previous = await getStoredAiChoice();
  await saveAiChoice(choice, admin.user.id);
  const gpu = localModel ? await switchLocalModel(localModel, env) : null;
  // One model on the GPU: a local translator on another model moves to this one.
  const translatorFollowed = localModel ? await translatorFollowsAiModel(localModel, admin.user.id) : null;
  if (translatorFollowed) {
    await audit({
      userId: admin.user.id,
      action: "admin.translator_model",
      entityType: "app_setting",
      entityId: "translator",
      metadata: { from: { provider: "local", model: translatorFollowed.from }, to: { provider: "local", model: translatorFollowed.to }, reason: "follows the AI model" },
    });
  }
  await audit({
    userId: admin.user.id,
    action: "admin.ai_model",
    entityType: "app_setting",
    entityId: "ai",
    metadata: { from: previous, to: choice, ...(gpu ? { unloaded: gpu.unloaded.map((m) => m.name), loaded: gpu.loaded } : {}) },
  });
  // A cloud model: unload the local language models nothing uses any more.
  const gpuFreed = localModel ? null : await releaseUnusedLocalModels();
  return ok({ ...(await aiSettingsView()), gpu, translatorFollowed, gpuFreed });
});
