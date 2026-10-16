import { apiHandler, ok, requireSession } from "@/lib/api";
import { activeTranslatorProvider } from "@/lib/translation";
import { translationLanguages } from "@/lib/speech/languages";

/** Languages the active translator can translate a source into (for the reader's "Translate" button). */
export const GET = apiHandler(async () => {
  await requireSession();
  const translator = await activeTranslatorProvider();
  return ok({ translator, languages: await translationLanguages(translator) }, { headers: { "Cache-Control": "private, max-age=600" } });
});
