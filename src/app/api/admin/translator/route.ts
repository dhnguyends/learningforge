import { apiHandler, ok, parseJsonBody, requireAdmin, badRequest } from "@/lib/api";
import { audit } from "@/lib/audit";
import { getActiveTranslator, saveTranslatorChoice, speechSettingsView, translatorChoiceSchema, translatorConfigured } from "@/lib/speech/settings";

/** The model that translates French sources to English, chosen by an administrator. */

export const GET = apiHandler(async () => {
  await requireAdmin();
  return ok(await speechSettingsView());
});

export const PUT = apiHandler(async (req) => {
  const admin = await requireAdmin();
  const choice = await parseJsonBody(req, translatorChoiceSchema);
  if (!translatorConfigured(choice.provider)) {
    throw badRequest("Set AZURE_TRANSLATOR_KEY in the server environment before selecting Azure AI Translator");
  }
  const previous = await getActiveTranslator();
  await saveTranslatorChoice(choice, admin.user.id);
  await audit({
    userId: admin.user.id,
    action: "admin.translator_model",
    entityType: "app_setting",
    entityId: "translator",
    metadata: { from: previous.provider, to: choice.provider },
  });
  return ok(await speechSettingsView());
});
