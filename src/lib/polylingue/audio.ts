import { NextResponse } from "next/server";
import { rateLimited } from "@/lib/api";
import { getStorage } from "@/lib/storage";
import { rateLimit } from "@/lib/rate-limit";
import { clipKey, polylingueSpeaker } from "@/lib/polylingue/voices";

/**
 * A PolyLingue audio clip: `text` read aloud in `lang` with that language's
 * voice (the admin's choice, else the read-aloud model), cached for every
 * learner (polylingue/tts/<voice>/<lang>/<hash>); most clips were generated
 * ahead of time with the lesson.
 * Only new clips count against the learner's hourly limit.
 */
export async function speechClipResponse(lang: string, text: string, userId: string): Promise<NextResponse> {
  const speaker = await polylingueSpeaker(lang);
  if (!speaker) return NextResponse.json({ error: "No voice for this language", code: "no_voice" }, { status: 422 });
  const key = clipKey(speaker, lang, text);
  const storage = getStorage();
  let audio: Buffer | null = null;
  try {
    audio = await storage.read(key);
  } catch {
    audio = null;
  }
  if (!audio) {
    const limit = rateLimit(`polylingue-tts:${userId}`, 600);
    if (!limit.allowed) throw rateLimited(limit.retryAfterSec);
    try {
      const speech = await speaker.synthesize(text);
      audio = speech.audio;
      await storage.put(key, speech.audio, { contentType: speech.contentType });
    } catch (err) {
      return NextResponse.json({ error: err instanceof Error ? err.message : String(err), code: "tts_failed" }, { status: 502 });
    }
  }
  return new NextResponse(new Uint8Array(audio), {
    status: 200,
    headers: { "Content-Type": speaker.contentType, "Content-Length": String(audio.length), "Cache-Control": "private, max-age=604800" },
  });
}
