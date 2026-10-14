import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "node:fs";
import path from "node:path";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getEnv } from "@/lib/env";
import { localStoragePath } from "@/lib/storage/local";
import { InvalidUploadTicketError, verifyUploadTicket } from "@/lib/storage/tickets";

/**
 * Local-storage upload endpoint (mirrors the S3 presigned PUT for dev/tests).
 * Only mounted when STORAGE_DRIVER=local.
 *
 * A PUT is accepted only with a valid signed ticket (see storage/tickets.ts)
 * issued to the signed-in user for exactly this key, and only while the
 * owning source is still waiting for its upload — so no user can write
 * another tenant's objects, or overwrite a file after it was verified.
 * The body is streamed to disk and cut off at the ticket's size ceiling.
 */
export async function PUT(req: NextRequest, { params }: { params: { key: string[] } }) {
  const env = getEnv();
  if (env.STORAGE_DRIVER !== "local") {
    return NextResponse.json({ error: "Not available" }, { status: 404 });
  }
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

  const key = params.key.join("/");
  let target: string;
  try {
    target = localStoragePath(key);
  } catch {
    return NextResponse.json({ error: "Invalid key" }, { status: 400 });
  }

  let claims;
  try {
    claims = verifyUploadTicket(req.nextUrl.searchParams.get("ticket"), key);
  } catch (err) {
    const reason = err instanceof InvalidUploadTicketError ? err.message : "Invalid upload ticket";
    return NextResponse.json({ error: reason }, { status: 403 });
  }
  if (claims.u !== session.user.id) {
    return NextResponse.json({ error: "Invalid upload ticket: issued to another user" }, { status: 403 });
  }

  const asset = await prisma.sourceAsset.findFirst({
    where: { storageKey: key, kind: "ORIGINAL" },
    select: { source: { select: { status: true } } },
  });
  if (!asset) return NextResponse.json({ error: "No pending upload for this key" }, { status: 404 });
  if (asset.source.status !== "PENDING_UPLOAD") {
    return NextResponse.json({ error: "This upload was already completed" }, { status: 409 });
  }

  const contentType = mediaType(req.headers.get("content-type")) ?? "application/octet-stream";
  if (contentType !== mediaType(claims.ct)) {
    return NextResponse.json({ error: `Content-Type must be ${claims.ct}` }, { status: 415 });
  }
  const declared = Number(req.headers.get("content-length") ?? NaN);
  if (Number.isFinite(declared) && declared > claims.max) {
    return NextResponse.json({ error: "Upload exceeds the size allowed for this file" }, { status: 413 });
  }

  await fs.mkdir(path.dirname(target), { recursive: true });
  const partial = `${target}.part`;
  const written = await streamToFile(req, partial, claims.max);
  if (written === "too-large") {
    await fs.rm(partial, { force: true });
    return NextResponse.json({ error: "Upload exceeds the size allowed for this file" }, { status: 413 });
  }
  await fs.rename(partial, target);
  await fs.writeFile(`${target}.meta`, JSON.stringify({ contentType, uploadedAt: Date.now() }), "utf8");
  return new NextResponse(null, { status: 200, headers: { ETag: `"${written}"` } });
}

/** Stream the request body to `file`, stopping once more than `maxBytes` arrive. */
async function streamToFile(req: NextRequest, file: string, maxBytes: number): Promise<number | "too-large"> {
  const handle = await fs.open(file, "w");
  let total = 0;
  try {
    if (!req.body) return 0;
    const reader = req.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined);
        return "too-large";
      }
      await handle.write(value);
    }
    return total;
  } finally {
    await handle.close();
  }
}

function mediaType(header: string | null): string | null {
  return header ? header.split(";")[0].trim().toLowerCase() : null;
}
