import { promises as fs } from "node:fs";
import path from "node:path";
import { getEnv } from "@/lib/env";
import { assertSafeKey } from "@/lib/storage/keys";
import { signUploadTicket } from "@/lib/storage/tickets";
import type { CreateUploadOptions, StorageDriver, UploadTicket } from "@/lib/storage/types";

export const LOCAL_STORAGE_ROOT = path.join(process.cwd(), ".data", "storage");

/**
 * Filesystem path of a storage key. Keys are validated first (no `..`,
 * backslashes, drive letters…) and the normalized result must stay strictly
 * inside the root — `startsWith(root)` alone would also accept a sibling
 * directory such as `.data/storage-evil`.
 */
export function localStoragePath(key: string): string {
  assertSafeKey(key);
  const normalized = path.normalize(path.join(LOCAL_STORAGE_ROOT, key));
  if (!normalized.startsWith(LOCAL_STORAGE_ROOT + path.sep)) throw new Error(`Invalid storage key: ${key}`);
  return normalized;
}

/**
 * Zero-dependency local storage for development and tests.
 * Uploads go through an authenticated API route (see /api/files and
 * /api/dev/uploads) that mirrors the S3 presigned-URL flow: the upload URL
 * carries a signed, expiring ticket bound to one key, user and size ceiling.
 */
export class LocalStorage implements StorageDriver {
  readonly name = "local";

  async createUpload(key: string, opts: CreateUploadOptions): Promise<UploadTicket> {
    await fs.mkdir(path.dirname(localStoragePath(key)), { recursive: true });
    const env = getEnv();
    const ticket = signUploadTicket({
      k: key,
      ct: opts.contentType,
      max: opts.maxBytes,
      u: opts.userId,
      exp: Date.now() + env.SIGNED_URL_TTL * 1000,
    });
    // Prefer the requesting origin: a static APP_URL/default goes stale the
    // moment the dev server runs on another port (e.g. next to a second
    // project on 3000), and the client would PUT bytes at the wrong server.
    const base = opts.baseUrl ?? env.APP_URL ?? "http://localhost:3000";
    return {
      uploadUrl: `${base}/api/dev/uploads/${key}?ticket=${ticket}`,
      headers: { "Content-Type": opts.contentType },
      key,
      method: "PUT",
    };
  }

  async put(key: string, body: Buffer | Uint8Array, opts: { contentType: string }): Promise<void> {
    const target = localStoragePath(key);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, body);
    await fs.writeFile(`${target}.meta`, JSON.stringify({ contentType: opts.contentType, uploadedAt: Date.now() }), "utf8");
  }

  async readUrl(key: string, _expiresInSec?: number, baseUrl?: string): Promise<string> {
    // Same origin-first rule as createUpload — playback links must reach this
    // server regardless of which port it currently listens on.
    const base = baseUrl ?? getEnv().APP_URL ?? "http://localhost:3000";
    return `${base}/api/files/${assertSafeKey(key)}`;
  }

  async read(key: string): Promise<Buffer> {
    return fs.readFile(localStoragePath(key));
  }

  async delete(key: string): Promise<void> {
    const target = localStoragePath(key);
    await fs.rm(target, { force: true });
    await fs.rm(`${target}.meta`, { force: true });
  }

  async deletePrefix(prefix: string): Promise<void> {
    await fs.rm(localStoragePath(prefix), { recursive: true, force: true });
  }

  async list(prefix: string): Promise<string[]> {
    const dir = localStoragePath(prefix);
    let entries: import("node:fs").Dirent[];
    try {
      entries = await fs.readdir(dir, { recursive: true, withFileTypes: true });
    } catch {
      return []; // nothing stored under this prefix
    }
    return entries
      .filter((e) => e.isFile() && !e.name.endsWith(".meta")) // .meta = content-type sidecar
      .map((e) => path.relative(LOCAL_STORAGE_ROOT, path.join(e.parentPath, e.name)).split(path.sep).join("/"))
      .sort();
  }

  async copy(fromKey: string, toKey: string): Promise<void> {
    const from = localStoragePath(fromKey);
    const to = localStoragePath(toKey);
    await fs.mkdir(path.dirname(to), { recursive: true });
    await fs.copyFile(from, to);
    await fs.copyFile(`${from}.meta`, `${to}.meta`).catch(() => undefined); // older objects may have none
  }
}
