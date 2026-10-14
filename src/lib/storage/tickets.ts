import { createHmac, timingSafeEqual } from "node:crypto";
import { getEnv } from "@/lib/env";

/**
 * Signed upload tickets for the local storage driver — the local equivalent of
 * an S3 presigned PUT. A ticket binds one key, content type, size ceiling and
 * user, and expires; /api/dev/uploads accepts a PUT only with a valid ticket.
 * (Without one, any signed-in user could write any key — including another
 * workspace's objects.)
 */

export interface UploadTicketClaims {
  /** Storage key the PUT may write. */
  k: string;
  /** Content type the client must send. */
  ct: string;
  /** Maximum body size in bytes. */
  max: number;
  /** User the ticket was issued to. */
  u: string;
  /** Expiry, epoch milliseconds. */
  exp: number;
}

export class InvalidUploadTicketError extends Error {
  constructor(reason: string) {
    super(`Invalid upload ticket: ${reason}`);
    this.name = "InvalidUploadTicketError";
  }
}

function secret(): string {
  // getEnv guarantees a value (dev default outside production).
  return `upload-ticket:${getEnv().NEXTAUTH_SECRET}`;
}

function sign(payload: string): string {
  return createHmac("sha256", secret()).update(payload).digest("base64url");
}

export function signUploadTicket(claims: UploadTicketClaims): string {
  const payload = Buffer.from(JSON.stringify(claims), "utf8").toString("base64url");
  return `${payload}.${sign(payload)}`;
}

/** Verify signature + expiry + key binding. Throws InvalidUploadTicketError. */
export function verifyUploadTicket(token: string | null | undefined, key: string, now = Date.now()): UploadTicketClaims {
  if (!token) throw new InvalidUploadTicketError("missing");
  const [payload, signature, extra] = token.split(".");
  if (!payload || !signature || extra !== undefined) throw new InvalidUploadTicketError("malformed");

  const expected = Buffer.from(sign(payload));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) {
    throw new InvalidUploadTicketError("bad signature");
  }

  let claims: UploadTicketClaims;
  try {
    claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as UploadTicketClaims;
  } catch {
    throw new InvalidUploadTicketError("malformed claims");
  }
  if (typeof claims.exp !== "number" || claims.exp < now) throw new InvalidUploadTicketError("expired");
  if (claims.k !== key) throw new InvalidUploadTicketError("issued for a different key");
  return claims;
}
