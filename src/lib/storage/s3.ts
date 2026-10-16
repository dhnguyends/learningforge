import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
  CopyObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { Env } from "@/lib/env";
import { assertSafeKey } from "@/lib/storage/keys";
import type { CreateUploadOptions, StorageDriver, UploadTicket } from "@/lib/storage/types";

/**
 * S3-compatible object storage (AWS S3, Cloudflare R2, MinIO).
 * Access control happens in the app layer (signed URLs are short-lived and
 * scoped to a single key); keys are still validated here so a `..` segment
 * can never reach a provider or proxy that normalizes paths.
 */
export class S3Storage implements StorageDriver {
  readonly name = "s3";
  private client: S3Client;
  private bucket: string;
  private ttl: number;

  constructor(env: Env) {
    this.bucket = env.S3_BUCKET;
    this.ttl = env.SIGNED_URL_TTL;
    this.client = new S3Client({
      region: env.S3_REGION,
      ...(env.S3_ENDPOINT ? { endpoint: env.S3_ENDPOINT, forcePathStyle: true } : {}),
      ...(env.S3_ACCESS_KEY_ID && env.S3_SECRET_ACCESS_KEY
        ? { credentials: { accessKeyId: env.S3_ACCESS_KEY_ID, secretAccessKey: env.S3_SECRET_ACCESS_KEY } }
        : {}),
    });
  }

  private objectName(key: string) {
    return { Bucket: this.bucket, Key: assertSafeKey(key) };
  }

  async createUpload(key: string, opts: CreateUploadOptions): Promise<UploadTicket> {
    const url = await getSignedUrl(
      this.client,
      new PutObjectCommand({ ...this.objectName(key), ContentType: opts.contentType }),
      { expiresIn: this.ttl },
    );
    return { uploadUrl: url, headers: { "Content-Type": opts.contentType }, key, method: "PUT" };
  }

  async put(key: string, body: Buffer | Uint8Array, opts: { contentType: string }): Promise<void> {
    await this.client.send(
      new PutObjectCommand({ ...this.objectName(key), Body: body, ContentType: opts.contentType }),
    );
  }

  async readUrl(key: string, expiresInSec?: number): Promise<string> {
    return getSignedUrl(this.client, new GetObjectCommand(this.objectName(key)), {
      expiresIn: expiresInSec ?? this.ttl,
    });
  }

  async read(key: string): Promise<Buffer> {
    const res = await this.client.send(new GetObjectCommand(this.objectName(key)));
    const bytes = await res.Body?.transformToByteArray();
    if (!bytes) throw new Error(`Empty object at ${key}`);
    return Buffer.from(bytes);
  }

  async delete(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand(this.objectName(key)));
  }

  async deletePrefix(prefix: string): Promise<void> {
    let token: string | undefined;
    do {
      const listed = await this.client.send(
        new ListObjectsV2Command({ Bucket: this.bucket, Prefix: `${assertSafeKey(prefix)}/`, ContinuationToken: token }),
      );
      for (const obj of listed.Contents ?? []) {
        // Listed keys come from the bucket itself — delete them verbatim, even
        // legacy ones that would no longer pass assertSafeKey.
        if (obj.Key) await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: obj.Key }));
      }
      token = listed.IsTruncated ? listed.NextContinuationToken : undefined;
    } while (token);
  }

  async list(prefix: string): Promise<string[]> {
    const keys: string[] = [];
    let token: string | undefined;
    do {
      const listed = await this.client.send(
        new ListObjectsV2Command({ Bucket: this.bucket, Prefix: `${assertSafeKey(prefix)}/`, ContinuationToken: token }),
      );
      for (const obj of listed.Contents ?? []) if (obj.Key) keys.push(obj.Key);
      token = listed.IsTruncated ? listed.NextContinuationToken : undefined;
    } while (token);
    return keys.sort();
  }

  async usage(prefix: string): Promise<{ objects: number; bytes: number }> {
    let objects = 0;
    let bytes = 0;
    let token: string | undefined;
    do {
      const listed = await this.client.send(
        new ListObjectsV2Command({ Bucket: this.bucket, Prefix: `${assertSafeKey(prefix)}/`, ContinuationToken: token }),
      );
      for (const obj of listed.Contents ?? []) {
        objects++;
        bytes += obj.Size ?? 0;
      }
      token = listed.IsTruncated ? listed.NextContinuationToken : undefined;
    } while (token);
    return { objects, bytes };
  }

  async copy(fromKey: string, toKey: string): Promise<void> {
    // CopySource is "<bucket>/<key>", URL-encoded per path segment.
    const source = `${this.bucket}/${assertSafeKey(fromKey).split("/").map(encodeURIComponent).join("/")}`;
    await this.client.send(new CopyObjectCommand({ ...this.objectName(toKey), CopySource: source }));
  }
}
