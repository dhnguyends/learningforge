import { apiHandler, ok, parseJsonBody, requireAdmin, badRequest } from "@/lib/api";
import { audit } from "@/lib/audit";
import { getEnv } from "@/lib/env";
import { aiChoiceSchema, aiSettingsView, geminiConfigured, getStoredAiChoice, saveAiChoice } from "@/lib/ai/settings";

/** The generation model used by every pipeline, chosen by an administrator. */

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
  const previous = await getStoredAiChoice();
  await saveAiChoice(choice, admin.user.id);
  await audit({
    userId: admin.user.id,
    action: "admin.ai_model",
    entityType: "app_setting",
    entityId: "ai",
    metadata: { from: previous, to: choice },
  });
  return ok(await aiSettingsView());
});
