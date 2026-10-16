import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { apiHandler, requireSession, notFound, badRequest, rateLimited } from "@/lib/api";
import { assertStudySetAccess } from "@/lib/access";
import { getStorage, sourcePrefix } from "@/lib/storage";
import { rateLimit } from "@/lib/rate-limit";
import { normalizeLanguage } from "@/lib/language";
import { getSpeaker } from "@/lib/speech/tts";
import { loadSourceReader, speechCacheKey } from "@/lib/speech/reader";

type Ctx = { params: { studySetId: string; sourceId: string } };

/**
 * Read-aloud of one reader item (a transcript segment or a passage) in the
 * requested language, with the TTS model chosen at /admin. Generated on first
 * request and cached under the source's storage prefix (deleted with it).
 *
 *   GET …/speech?lang=en&index=12
 */
export const GET = apiHandler<Ctx>(async (req, { params }) => {
  const session = await requireSession();
  const studySet = await assertStudySetAccess(session.user.id, params.studySetId, "read");
  const source = await prisma.source.findFirst({ where: { id: params.sourceId, studySetId: studySet.id }, select: { id: true } });
  if (!source) throw notFound("Source");

  const url = new URL(req.url);
  const lang = normalizeLanguage(url.searchParams.get("lang"));
  const index = Number(url.searchParams.get("index"));
  if (!lang) throw badRequest("lang must be fr or en");
  if (!Number.isInteger(index) || index < 0) throw badRequest("index must be a non-negative integer");

  const reader = await loadSourceReader(source.id);
  const text = reader.items[index]?.text[lang]?.trim();
  if (!text) throw notFound(index >= reader.items.length ? "Item" : `Text in ${lang}`);

  const speaker = await getSpeaker();
  const storage = getStorage();
  const key = speechCacheKey(sourcePrefix(studySet.workspaceId, studySet.id, source.id), speaker.id, lang, reader.kind, index, text, speaker.ext);
  let audio: Buffer | null = null;
  try {
    audio = await storage.read(key);
  } catch {
    audio = null;
  }
  if (!audio) {
    // Only new clips count: replaying cached audio is free.
    const limit = rateLimit(`tts:${session.user.id}`, 600);
    if (!limit.allowed) throw rateLimited(limit.retryAfterSec);
    try {
      const speech = await speaker.synthesize(text, lang);
      audio = speech.audio;
      await storage.put(key, speech.audio, { contentType: speech.contentType });
    } catch (err) {
      return NextResponse.json({ error: err instanceof Error ? err.message : String(err), code: "tts_failed" }, { status: 502 });
    }
  }
  return new NextResponse(new Uint8Array(audio), {
    status: 200,
    headers: { "Content-Type": speaker.contentType, "Content-Length": String(audio.length), "Cache-Control": "private, max-age=86400" },
  });
});
