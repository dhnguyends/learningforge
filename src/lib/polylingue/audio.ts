import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { rateLimited } from "@/lib/api";
import { getStorage } from "@/lib/storage";
import { rateLimit } from "@/lib/rate-limit";
import { speakerForLanguage } from "@/lib/speech/tts";

/**
 * A PolyLingue audio clip: `text` read aloud in `lang` with that language's
 * voice, cached for every learner (polylingue/tts/<voice>/<lang>/<hash>).
 * Only new clips count against the learner's hourly limit.
 */
export async function speechClipResponse(lang: string, text: string, userId: string): Promise<NextResponse> {
  const speaker = await speakerForLanguage(lang);
  if (!speaker) return NextResponse.json({ error: "No voice for this language", code: "no_voice" }, { status: 422 });
  const hash = createHash("sha256").update(text).digest("hex").slice(0, 24);
  const safe = (s: string) => s.replace(/[^a-zA-Z0-9._-]/g, "_");
  const key = `polylingue/tts/${safe(speaker.id)}/${lang}/${hash}.${speaker.ext}`;
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
