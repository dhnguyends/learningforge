import { NextResponse } from "next/server";
import { apiHandler, ok, requireSession } from "@/lib/api";
import { deleteRecording, recordingAudio } from "@/lib/polylingue/recordings";

type Ctx = { params: { recordingId: string } };

/** A kept spoken answer, for its owner only (?download=1 saves it as a file). */
export const GET = apiHandler<Ctx>(async (req, { params }) => {
  const session = await requireSession();
  const { audio, mimeType, filename } = await recordingAudio(session.user.id, params.recordingId);
  const download = new URL(req.url).searchParams.get("download") === "1";
  return new NextResponse(new Uint8Array(audio), {
    headers: {
      "Content-Type": mimeType,
      "Content-Length": String(audio.length),
      "Cache-Control": "private, no-store",
      ...(download ? { "Content-Disposition": `attachment; filename="${filename}"` } : {}),
    },
  });
});

/** Deletes one kept recording (and its WAV file, unless the item's other slot uses it). */
export const DELETE = apiHandler<Ctx>(async (_req, { params }) => {
  const session = await requireSession();
  return ok(await deleteRecording(session.user.id, params.recordingId));
});
