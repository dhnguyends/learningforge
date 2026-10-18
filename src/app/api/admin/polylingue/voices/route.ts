import { z } from "zod";
import { apiHandler, ok, parseJsonBody, requireAdmin, badRequest } from "@/lib/api";
import { audit } from "@/lib/audit";
import { readPolylingueVoices, savePolylingueVoices } from "@/lib/speech/settings";
import { LOCAL_VOICES, isLocalSpeaker, isLocalVoiceKey, polylingueSpeaker } from "@/lib/polylingue/voices";

/** The cloud provider of a voice in use, or null for a local (Speaches) voice. */
const cloudOf = (speakerId: string): string | null =>
  speakerId.startsWith("azure") ? "Microsoft Azure" : speakerId.startsWith("gemini") ? "Google" : "cloud";
import { TARGET_LANGUAGES } from "@/lib/polylingue/levels";

async function view() {
  const chosen = await readPolylingueVoices();
  return {
    languages: await Promise.all(
      TARGET_LANGUAGES.map(async (l) => {
        // The voice used now (the choice, or the read-aloud model).
        const speaker = await polylingueSpeaker(l.code);
        return {
          code: l.code,
          name: l.name,
          options: LOCAL_VOICES[l.code] ?? [],
          chosen: chosen[l.code] ?? null,
          current: speaker?.label ?? null,
          currentCloud: speaker && !isLocalSpeaker(speaker) ? cloudOf(speaker.id) : null,
        };
      }),
    ),
  };
}

/** Local voices per PolyLingue language, the choice, and the voice in use. */
export const GET = apiHandler(async () => {
  await requireAdmin();
  return ok(await view());
});

/** Sets (or clears, with null) the voice of each language. */
export const PUT = apiHandler(async (req) => {
  const session = await requireAdmin();
  const { voices } = await parseJsonBody(req, z.object({ voices: z.record(z.string().max(12), z.string().max(120).nullable()) }));
  const next = { ...(await readPolylingueVoices()) };
  for (const [lang, key] of Object.entries(voices)) {
    if (key === null) delete next[lang];
    else if (!isLocalVoiceKey(lang, key)) throw badRequest(`Not a local voice for ${lang}.`);
    else next[lang] = key;
  }
  await savePolylingueVoices(next, session.user.id);
  await audit({ userId: session.user.id, action: "polylingue.voices", entityType: "app_setting", entityId: "polylingue_voices", metadata: next });
  return ok(await view());
});
