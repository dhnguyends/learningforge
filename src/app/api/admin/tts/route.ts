import { apiHandler, ok, parseJsonBody, requireAdmin, badRequest } from "@/lib/api";
import { audit } from "@/lib/audit";
import { getActiveTts, saveTtsChoice, speechSettingsView, ttsChoiceSchema, ttsConfigured, TTS_PROVIDERS } from "@/lib/speech/settings";

/** The read-aloud (text-to-speech) model and its voices, chosen by an administrator. */

export const GET = apiHandler(async () => {
  await requireAdmin();
  return ok(await speechSettingsView());
});

export const PUT = apiHandler(async (req) => {
  const admin = await requireAdmin();
  const choice = await parseJsonBody(req, ttsChoiceSchema);
  if (!ttsConfigured(choice.provider)) {
    const key = choice.provider === "azure" ? "AZURE_SPEECH_KEY" : "GEMINI_API_KEY";
    throw badRequest(`Set ${key} in the server environment before selecting ${TTS_PROVIDERS[choice.provider].label}`);
  }
  const previous = await getActiveTts();
  await saveTtsChoice(choice, admin.user.id);
  await audit({
    userId: admin.user.id,
    action: "admin.tts_model",
    entityType: "app_setting",
    entityId: "tts",
    metadata: { from: { provider: previous.provider, voices: previous.voices }, to: choice },
  });
  return ok(await speechSettingsView());
});
