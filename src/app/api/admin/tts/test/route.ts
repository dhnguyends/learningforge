import { NextResponse } from "next/server";
import { z } from "zod";
import { apiHandler, parseJsonBody, requireAdmin, badRequest } from "@/lib/api";
import { speakerFor } from "@/lib/speech/tts";
import { ttsChoiceSchema, ttsConfigured } from "@/lib/speech/settings";

/**
 * "Listen": speaks a fixed sample in the chosen language with the candidate
 * model and voice, and returns the audio. Timing comes back in a header.
 */
const SAMPLES = {
  fr: "Bonjour ! Voici un extrait de votre cours, lu à voix haute.",
  en: "Hello! Here is an excerpt from your course, read aloud.",
} as const;

const bodySchema = z.object({ choice: ttsChoiceSchema, lang: z.enum(["fr", "en"]) });

export const POST = apiHandler(async (req) => {
  await requireAdmin();
  const { choice, lang } = await parseJsonBody(req, bodySchema);
  if (!ttsConfigured(choice.provider)) throw badRequest(`${choice.provider === "azure" ? "AZURE_SPEECH_KEY" : "GEMINI_API_KEY"} is not set`);
  const started = Date.now();
  try {
    const speech = await speakerFor(choice).synthesize(SAMPLES[lang], lang);
    return new NextResponse(new Uint8Array(speech.audio), {
      status: 200,
      headers: {
        "Content-Type": speech.contentType,
        "Cache-Control": "no-store",
        "X-Latency-Ms": String(Date.now() - started),
      },
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err), code: "tts_failed" }, { status: 502 });
  }
});
