import { apiHandler, requireSession, badRequest } from "@/lib/api";
import { TARGET_LANGUAGES, BASE_LANGUAGES } from "@/lib/polylingue/levels";
import { speechClipResponse } from "@/lib/polylingue/audio";

/**
 * PolyLingue audio: a word or sentence read aloud in the target language with
 * the voice chosen for that language (see src/lib/speech/tts.ts). Clips are
 * shared by every learner and cached; slow playback is done by the browser
 * (playbackRate).
 *
 *   GET /api/polylingue/speech?lang=es&text=Buenos%20d%C3%ADas
 */
const LANGS = new Set<string>([...TARGET_LANGUAGES.map((l) => l.code), ...BASE_LANGUAGES.map((l) => l.code)]);

export const GET = apiHandler(async (req) => {
  const session = await requireSession();
  const url = new URL(req.url);
  const lang = url.searchParams.get("lang") ?? "";
  const text = (url.searchParams.get("text") ?? "").replace(/\s+/g, " ").trim();
  if (!LANGS.has(lang)) throw badRequest("Unsupported language");
  if (!text || text.length > 400) throw badRequest("text must be 1 to 400 characters");
  return speechClipResponse(lang, text, session.user.id);
});
