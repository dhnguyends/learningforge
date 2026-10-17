import { apiHandler, ok, requireSession, badRequest } from "@/lib/api";
import { submitSpeaking } from "@/lib/polylingue/practice-service";

type Ctx = { params: { courseId: string; practiceId: string } };

const MAX_BYTES = 5 * 1024 * 1024;

/**
 * Speaking: multipart form with `kind` (sentence | question), `index` and the
 * `audio` recording (webm / ogg / mp4 / wav, up to 5 MB). The recording is
 * transcribed locally by Whisper, then kept as WAV for the learner to play
 * back (the item's latest and best recordings).
 */
export const POST = apiHandler<Ctx>(async (req, { params }) => {
  const session = await requireSession();
  const form = await req.formData().catch(() => null);
  if (!form) throw badRequest("Send the recording as multipart form data");
  const kind = form.get("kind");
  const index = Number(form.get("index"));
  const audio = form.get("audio");
  if (kind !== "sentence" && kind !== "question") throw badRequest("kind must be sentence or question");
  if (!Number.isInteger(index) || index < 0 || index > 20) throw badRequest("Invalid index");
  if (!(audio instanceof Blob) || audio.size === 0) throw badRequest("Missing recording");
  if (audio.size > MAX_BYTES) throw badRequest("Recording too long");
  if (audio.type && !/^audio\//.test(audio.type.split(";")[0])) throw badRequest("Not an audio recording");
  const ext = /ogg/.test(audio.type) ? "ogg" : /mp4|m4a|aac/.test(audio.type) ? "m4a" : /wav/.test(audio.type) ? "wav" : "webm";
  return ok(
    await submitSpeaking(session.user.id, params.courseId, params.practiceId, {
      kind,
      index,
      audio: Buffer.from(await audio.arrayBuffer()),
      filename: `speech.${ext}`,
    }),
  );
});
