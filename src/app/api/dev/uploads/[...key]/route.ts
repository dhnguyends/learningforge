import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "node:fs";
import path from "node:path";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getEnv } from "@/lib/env";

/**
 * Local-storage upload endpoint (mirrors the S3 presigned PUT for dev/tests).
 * Only mounted when STORAGE_DRIVER=local.
 */
export async function PUT(req: NextRequest, { params }: { params: { key: string[] } }) {
  const env = getEnv();
  if (env.STORAGE_DRIVER !== "local") {
    return NextResponse.json({ error: "Not available" }, { status: 404 });
  }
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

  const key = params.key.join("/");
  const root = path.join(process.cwd(), ".data", "storage");
  const target = path.join(root, key);
  if (!path.normalize(target).startsWith(root)) {
    return NextResponse.json({ error: "Invalid key" }, { status: 400 });
  }

  await fs.mkdir(path.dirname(target), { recursive: true });
  const body = Buffer.from(await req.arrayBuffer());
  await fs.writeFile(target, body);
  const contentType = req.headers.get("content-type") ?? "application/octet-stream";
  await fs.writeFile(`${target}.meta`, JSON.stringify({ contentType, uploadedAt: Date.now() }), "utf8");
  return new NextResponse(null, { status: 200, headers: { ETag: `"${body.length}"` } });
}
