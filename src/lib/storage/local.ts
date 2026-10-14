import { promises as fs } from "node:fs";
import path from "node:path";
import { getEnv } from "@/lib/env";
import type { StorageDriver, UploadTicket } from "@/lib/storage/types";

const ROOT = path.join(process.cwd(), ".data", "storage");

function resolve(key: string): string {
  const full = path.join(ROOT, key);
  // Defense in depth: no traversal outside the storage root.
  const normalized = path.normalize(full);
  if (!normalized.startsWith(ROOT)) throw new Error(`Invalid storage key: ${key}`);
  return normalized;
}

/**
 * Zero-dependency local storage for development and tests.
 * Uploads go through an authenticated API route (see /api/files and
 * /api/dev/uploads) that mirrors the S3 presigned-URL flow.
 */
export class LocalStorage implements StorageDriver {
  readonly name = "local";

  async createUpload(key: string, opts: { contentType: string; baseUrl?: string }): Promise<UploadTicket> {
    await fs.mkdir(path.dirname(resolve(key)), { recursive: true });
    // Prefer the requesting origin: a static APP_URL/default goes stale the
    // moment the dev server runs on another port (e.g. next to a second
    // project on 3000), and the client would PUT bytes at the wrong server.
    const base = opts.baseUrl ?? getEnv().APP_URL ?? "http://localhost:3000";
    return {
      uploadUrl: `${base}/api/dev/uploads/${key}`,
      headers: { "Content-Type": opts.contentType },
      key,
      method: "PUT",
    };
  }

  async put(key: string, body: Buffer | Uint8Array, opts: { contentType: string }): Promise<void> {
    const target = resolve(key);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, body);
    await fs.writeFile(`${target}.meta`, JSON.stringify({ contentType: opts.contentType, uploadedAt: Date.now() }), "utf8");
  }

  async readUrl(key: string, _expiresInSec?: number, baseUrl?: string): Promise<string> {
    // Same origin-first rule as createUpload — playback links must reach this
    // server regardless of which port it currently listens on.
    const base = baseUrl ?? getEnv().APP_URL ?? "http://localhost:3000";
    return `${base}/api/files/${key}`;
  }

  async read(key: string): Promise<Buffer> {
    return fs.readFile(resolve(key));
  }

  async delete(key: string): Promise<void> {
    await fs.rm(resolve(key), { force: true });
    await fs.rm(`${resolve(key)}.meta`, { force: true });
  }

  async deletePrefix(prefix: string): Promise<void> {
    const dir = resolve(prefix);
    await fs.rm(dir, { recursive: true, force: true });
  }
}
