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

export {
  assertSafeKey,
  parseTenantKey,
  sourceAssetKey,
  sourceDerivedKey,
  sourcePrefix,
  studySetPrefix,
  studySetRecapKey,
  UnsafeStorageKeyError,
} from "@/lib/storage/keys";
export type { StorageDriver, UploadTicket, CreateUploadOptions } from "@/lib/storage/types";
