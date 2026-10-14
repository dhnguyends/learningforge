/**
 * Storage key layout + validation. Every object lives under its tenant:
 *
 *   workspaces/<workspaceId>/study-sets/<studySetId>/sources/<sourceId>/<name>
 *   workspaces/<workspaceId>/study-sets/<studySetId>/recaps/<name>
 *
 * Keys are built ONLY from server-generated ids and fixed names — never from
 * request input (a client filename like "../../<otherWorkspace>/…" used to
 * resolve into another tenant's objects). Deletion relies on this layout too:
 * removing a source / study set / workspace purges its prefix, so anything
 * stored outside it would survive "permanent" deletion.
 */

export class UnsafeStorageKeyError extends Error {
  constructor(key: string, reason: string) {
    super(`Unsafe storage key (${reason}): ${key.slice(0, 200)}`);
    this.name = "UnsafeStorageKeyError";
  }
}

/**
 * Reject keys that could escape their prefix once a filesystem (or any path
 * normalizer) interprets them: `.`/`..`/empty segments, backslashes, drive
 * letters, control characters. Throws UnsafeStorageKeyError.
 */
export function assertSafeKey(key: string): string {
  if (typeof key !== "string" || key.length === 0) throw new UnsafeStorageKeyError(String(key), "empty");
  if (key.length > 1024) throw new UnsafeStorageKeyError(key, "too long");
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1f\x7f]/.test(key)) throw new UnsafeStorageKeyError(key, "control character");
  if (key.includes("\\")) throw new UnsafeStorageKeyError(key, "backslash");
  if (key.includes(":")) throw new UnsafeStorageKeyError(key, "colon");
  for (const segment of key.split("/")) {
    if (segment === "") throw new UnsafeStorageKeyError(key, "empty segment");
    if (segment === "." || segment === "..") throw new UnsafeStorageKeyError(key, "relative segment");
  }
  return key;
}

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

function id(value: string, what: string): string {
  if (!ID_RE.test(value)) throw new UnsafeStorageKeyError(value, `invalid ${what} id`);
  return value;
}

const EXT_BY_MIME: Record<string, string> = {
  "video/mp4": "mp4",
  "video/webm": "webm",
  "video/quicktime": "mov",
  "audio/mpeg": "mp3",
  "audio/wav": "wav",
  "audio/mp4": "m4a",
  "audio/x-m4a": "m4a",
  "audio/webm": "webm",
  "application/pdf": "pdf",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "image/png": "png",
  "image/jpeg": "jpg",
  "text/plain": "txt",
  "text/markdown": "md",
};

export function sourcePrefix(workspaceId: string, studySetId: string, sourceId: string): string {
  return `${studySetPrefix(workspaceId, studySetId)}/sources/${id(sourceId, "source")}`;
}

export function studySetPrefix(workspaceId: string, studySetId: string): string {
  return `workspaces/${id(workspaceId, "workspace")}/study-sets/${id(studySetId, "study set")}`;
}

/**
 * Key of an uploaded original. The user's filename is display metadata only
 * (kept on SourceAsset.filename); the key uses a fixed name plus an extension
 * derived from the validated MIME type, which file serving uses for
 * Content-Type.
 */
export function sourceAssetKey(workspaceId: string, studySetId: string, sourceId: string, mimeType: string): string {
  const ext = EXT_BY_MIME[mimeType] ?? "bin";
  return `${sourcePrefix(workspaceId, studySetId, sourceId)}/original.${ext}`;
}

/** Key of a server-derived artifact of a source (extracted audio, OCR, thumbnails). */
export function sourceDerivedKey(workspaceId: string, studySetId: string, sourceId: string, name: "audio.mp3"): string {
  return `${sourcePrefix(workspaceId, studySetId, sourceId)}/${name}`;
}

/** Key of a study-set level artifact (audio recaps). */
export function studySetRecapKey(workspaceId: string, studySetId: string, guideId: string, timestamp: number): string {
  return `${studySetPrefix(workspaceId, studySetId)}/recaps/${id(guideId, "guide")}-${timestamp}.mp3`;
}

/**
 * Parse a key in the tenant layout. Returns null when the key is unsafe or not
 * under `workspaces/<ws>/study-sets/<set>/…` — callers authorize on the result.
 */
export function parseTenantKey(key: string): { workspaceId: string; studySetId: string } | null {
  try {
    assertSafeKey(key);
  } catch {
    return null;
  }
  const parts = key.split("/");
  if (parts.length < 5 || parts[0] !== "workspaces" || parts[2] !== "study-sets") return null;
  if (!ID_RE.test(parts[1]) || !ID_RE.test(parts[3])) return null;
  return { workspaceId: parts[1], studySetId: parts[3] };
}
