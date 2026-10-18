import { apiHandler, ok, parseJsonBody, requireAdmin, badRequest } from "@/lib/api";
import { audit } from "@/lib/audit";
import { getActiveTranslator, saveTranslatorChoice, speechSettingsView, translatorChoiceProblem, translatorChoiceSchema } from "@/lib/speech/settings";
import { releaseUnusedLocalModels } from "@/lib/ai/gpu-policy";

/**
 * The model that translates sources, chosen by an administrator: Azure, or a
 * local Ollama model — the AI model's own while the AI model is local.
 */

export const GET = apiHandler(async () => {
  await requireAdmin();
  return ok(await speechSettingsView());
});

export const PUT = apiHandler(async (req) => {
  const admin = await requireAdmin();
  const choice = await parseJsonBody(req, translatorChoiceSchema);
  const { problem, model } = await translatorChoiceProblem(choice);
  if (problem) throw badRequest(problem);
  const previous = await getActiveTranslator();
  const next = choice.provider === "local" ? { provider: "local" as const, model: model! } : { provider: "azure" as const };
  await saveTranslatorChoice(next, admin.user.id);
  await audit({
    userId: admin.user.id,
    action: "admin.translator_model",
    entityType: "app_setting",
    entityId: "translator",
    metadata: { from: { provider: previous.provider, model: previous.model }, to: next },
  });
  // With a cloud AI model, the translator decides which local model (if any) stays loaded.
  const gpuFreed = await releaseUnusedLocalModels();
  return ok({ ...(await speechSettingsView()), gpuFreed });
});
