import { prisma } from "@/lib/db";
import { notFound } from "@/lib/api";
import { getStorage } from "@/lib/storage";
import { toWav } from "@/lib/media/ffmpeg";
import { ownCourse } from "@/lib/polylingue/service";

/**
 * The learner's spoken answers in speaking practice, kept to play back: per
 * item ("sentence-0", "question-1"…) the latest recording and the best one
 * (highest score). Audio is stored as WAV under
 * polylingue/recordings/<user>/<course>/…; only the learner can play it, and
 * it is deleted with the course or the account.
 */

export const recordingsPrefix = (userId: string, courseId?: string) => `polylingue/recordings/${userId}${courseId ? `/${courseId}` : ""}`;

/** An attempt becomes the best one when it scored at least as well (unscored attempts never do). */
export function isNewBest(best: number | null | undefined, score: number | null): boolean {
  if (score === null) return false;
  return best === null || best === undefined || score >= best;
}

/** Keeps a spoken answer as the item's latest recording, and as its best when it scored at least as well. */
export async function keepSpokenAnswer(
  userId: string,
  courseId: string,
  practiceId: string,
  item: string,
  audio: Buffer,
  filename: string,
  score: number | null,
  heard: string,
) {
  let data = audio;
  let mimeType = "audio/wav";
  try {
    data = await toWav(audio, filename);
  } catch {
    // Keep the original recording when it cannot be converted.
    mimeType = /ogg/.test(filename) ? "audio/ogg" : /m4a|mp4/.test(filename) ? "audio/mp4" : /wav/.test(filename) ? "audio/wav" : "audio/webm";
  }
  const ext = mimeType === "audio/wav" ? "wav" : mimeType.split("/")[1];
  const key = `${recordingsPrefix(userId, courseId)}/${practiceId}/${item}-${Date.now()}.${ext}`;
  await getStorage().put(key, data, { contentType: mimeType });

  const where = (slot: "latest" | "best") => ({ courseId_practiceId_item_slot: { courseId, practiceId, item, slot } });
  const [latest, best] = await Promise.all([prisma.langRecording.findUnique({ where: where("latest") }), prisma.langRecording.findUnique({ where: where("best") })]);
  const row = { storageKey: key, mimeType, sizeBytes: data.length, score, heard: heard.slice(0, 1000), createdAt: new Date() };
  await prisma.langRecording.upsert({ where: where("latest"), create: { courseId, practiceId, item, slot: "latest", ...row }, update: row });
  const newBest = isNewBest(best?.score, score);
  if (newBest) await prisma.langRecording.upsert({ where: where("best"), create: { courseId, practiceId, item, slot: "best", ...row }, update: row });

  // Files no longer used by either slot.
  for (const old of [latest?.storageKey, newBest ? best?.storageKey : undefined]) {
    if (old && old !== key && !(await prisma.langRecording.count({ where: { storageKey: old } }))) await getStorage().delete(old).catch(() => undefined);
  }
}

/** The kept recordings of a practice, by item: latest and best. */
export async function practiceRecordings(userId: string, courseId: string, practiceId: string) {
  await ownCourse(userId, courseId);
  const rows = await prisma.langRecording.findMany({ where: { courseId, practiceId }, orderBy: { item: "asc" } });
  const items: Record<string, { latest?: RecordingView; best?: RecordingView }> = {};
  for (const r of rows) {
    const view: RecordingView = { id: r.id, score: r.score, heard: r.heard, at: r.createdAt.toISOString(), sizeBytes: r.sizeBytes, sameFileAsOther: rows.some((o) => o.id !== r.id && o.item === r.item && o.storageKey === r.storageKey) };
    (items[r.item] ??= {})[r.slot as "latest" | "best"] = view;
  }
  return { items };
}

export interface RecordingView {
  id: string;
  score: number | null;
  heard: string | null;
  at: string;
  sizeBytes: number;
  /** The latest is also the best (one file). */
  sameFileAsOther: boolean;
}

/** One recording's audio, for its owner only. */
export async function recordingAudio(userId: string, recordingId: string) {
  const r = await prisma.langRecording.findUnique({ where: { id: recordingId }, include: { course: { select: { userId: true } } } });
  if (!r || r.course.userId !== userId) throw notFound("Recording");
  return { audio: await getStorage().read(r.storageKey), mimeType: r.mimeType, filename: `${r.item}-${r.slot}.${r.mimeType === "audio/wav" ? "wav" : r.mimeType.split("/")[1]}` };
}

/** Deletes the recordings of a practice (rows and files). */
export async function deletePracticeRecordings(userId: string, courseId: string, practiceId: string): Promise<number> {
  await ownCourse(userId, courseId);
  const rows = await prisma.langRecording.findMany({ where: { courseId, practiceId }, select: { storageKey: true } });
  await prisma.langRecording.deleteMany({ where: { courseId, practiceId } });
  for (const key of new Set(rows.map((r) => r.storageKey))) await getStorage().delete(key).catch(() => undefined);
  return rows.length;
}

/**
 * Deletes one kept recording (its owner only). Its file is deleted too unless
 * the item's other slot still uses it (the latest that is also the best).
 */
export async function deleteRecording(userId: string, recordingId: string): Promise<{ fileDeleted: boolean }> {
  const r = await prisma.langRecording.findUnique({ where: { id: recordingId }, include: { course: { select: { userId: true } } } });
  if (!r || r.course.userId !== userId) throw notFound("Recording");
  await prisma.langRecording.delete({ where: { id: r.id } });
  const stillUsed = await prisma.langRecording.count({ where: { storageKey: r.storageKey } });
  if (!stillUsed) await getStorage().delete(r.storageKey).catch(() => undefined);
  return { fileDeleted: !stillUsed };
}
