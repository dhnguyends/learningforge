import type { SourceType } from "@prisma/client";
import { badRequest } from "@/lib/api";

export const MAX_VIDEO_BYTES = 2 * 1024 * 1024 * 1024; // 2 GB
export const MAX_AUDIO_BYTES = 500 * 1024 * 1024;
export const MAX_DOCUMENT_BYTES = 200 * 1024 * 1024;

const ALLOWED: Array<{ mime: string; sourceType: SourceType; maxBytes: number }> = [
  { mime: "video/mp4", sourceType: "VIDEO", maxBytes: MAX_VIDEO_BYTES },
  { mime: "video/webm", sourceType: "VIDEO", maxBytes: MAX_VIDEO_BYTES },
  { mime: "video/quicktime", sourceType: "VIDEO", maxBytes: MAX_VIDEO_BYTES },
  { mime: "audio/mpeg", sourceType: "AUDIO", maxBytes: MAX_AUDIO_BYTES },
  { mime: "audio/wav", sourceType: "AUDIO", maxBytes: MAX_AUDIO_BYTES },
  { mime: "audio/mp4", sourceType: "AUDIO", maxBytes: MAX_AUDIO_BYTES },
  { mime: "audio/webm", sourceType: "AUDIO", maxBytes: MAX_AUDIO_BYTES },
  { mime: "audio/x-m4a", sourceType: "AUDIO", maxBytes: MAX_AUDIO_BYTES },
  { mime: "application/pdf", sourceType: "PDF", maxBytes: MAX_DOCUMENT_BYTES },
  {
    mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    sourceType: "SLIDES",
    maxBytes: MAX_DOCUMENT_BYTES,
  },
  {
    mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    sourceType: "NOTE",
    maxBytes: MAX_DOCUMENT_BYTES,
  },
  { mime: "image/png", sourceType: "IMAGE", maxBytes: MAX_DOCUMENT_BYTES },
  { mime: "image/jpeg", sourceType: "IMAGE", maxBytes: MAX_DOCUMENT_BYTES },
  { mime: "text/plain", sourceType: "NOTE", maxBytes: MAX_DOCUMENT_BYTES },
  { mime: "text/markdown", sourceType: "NOTE", maxBytes: MAX_DOCUMENT_BYTES },
];

export function sourceTypeForMime(mime: string): SourceType | null {
  return ALLOWED.find((a) => a.mime === mime)?.sourceType ?? null;
}

/**
 * Validate an intended upload: type allowlist + size ceiling.
 * Called before an upload ticket is issued and again on completion.
 */
export function validateUploadIntent(mimeType: string, sizeBytes: number): { sourceType: SourceType } {
  const rule = ALLOWED.find((a) => a.mime === mimeType);
  if (!rule) throw badRequest(`Unsupported file type: ${mimeType}. Allowed: lecture video/audio, PDF, slides, documents, images, notes.`);
  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) throw badRequest("Invalid file size");
  if (sizeBytes > rule.maxBytes) {
    throw badRequest(`File exceeds the ${(rule.maxBytes / 1024 / 1024 / 1024).toFixed(1)} GB limit for ${rule.sourceType.toLowerCase()} uploads`);
  }
  return { sourceType: rule.sourceType };
}

export function isRecordingType(type: SourceType): boolean {
  return type === "VIDEO" || type === "AUDIO" || type === "YOUTUBE";
}

/** Rough processing-time estimate shown before the user commits (seconds). */
export function estimateProcessingSec(type: SourceType, sizeBytes?: number): number {
  switch (type) {
    case "VIDEO":
    case "YOUTUBE":
      return Math.round((sizeBytes ?? 500 * 1024 * 1024) / (2 * 1024 * 1024)) + 90; // ~2MB/s extract+transcribe
    case "AUDIO":
      return Math.round((sizeBytes ?? 50 * 1024 * 1024) / (1024 * 1024)) + 30;
    default:
      return 20;
  }
}
