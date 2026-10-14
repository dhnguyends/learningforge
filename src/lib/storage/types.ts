export interface UploadTicket {
  /** URL the client PUTs the file to. */
  uploadUrl: string;
  /** Headers the client must send with the PUT. */
  headers: Record<string, string>;
  /** Storage key the asset was allocated. */
  key: string;
  /** Method is always PUT; kept explicit for client clarity. */
  method: "PUT";
}

export interface StorageDriver {
  readonly name: string;
  /**
   * Allocate an upload location for a new object. `baseUrl` is the origin of
   * the request asking for the ticket: the local driver embeds it in the
   * upload URL so tickets always point back at the server the client is
   * actually using (the S3 driver ignores it — presigned URLs are
   * provider-hosted).
   */
  createUpload(key: string, opts: { contentType: string; baseUrl?: string }): Promise<UploadTicket>;
  /** Store bytes directly (server-side writes, e.g. ffmpeg output). */
  put(key: string, body: Buffer | Uint8Array, opts: { contentType: string }): Promise<void>;
  /** Time-limited read URL (media streaming / downloads). `baseUrl` as above. */
  readUrl(key: string, expiresInSec?: number, baseUrl?: string): Promise<string>;
  /** Read full bytes (worker-side processing). */
  read(key: string): Promise<Buffer>;
  /** Permanently delete an object. */
  delete(key: string): Promise<void>;
  deletePrefix(prefix: string): Promise<void>;
}

export function sourceAssetKey(workspaceId: string, studySetId: string, sourceId: string, filename: string): string {
  return `workspaces/${workspaceId}/study-sets/${studySetId}/sources/${sourceId}/${filename}`;
}
