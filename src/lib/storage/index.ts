import { getEnv } from "@/lib/env";
import type { StorageDriver } from "@/lib/storage/types";
import { LocalStorage } from "@/lib/storage/local";
import { S3Storage } from "@/lib/storage/s3";

let cached: StorageDriver | null = null;

export function getStorage(): StorageDriver {
  if (cached) return cached;
  const env = getEnv();
  cached = env.STORAGE_DRIVER === "s3" ? new S3Storage(env) : new LocalStorage();
  return cached;
}

export { sourceAssetKey } from "@/lib/storage/types";
export type { StorageDriver, UploadTicket } from "@/lib/storage/types";
