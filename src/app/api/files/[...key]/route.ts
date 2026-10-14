import { NextRequest, NextResponse } from "next/server";
import { open, stat } from "node:fs/promises";
import path from "node:path";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getEnv } from "@/lib/env";

const MIME: Record<string, string> = {
  mp4: "video/mp4",
  webm: "video/webm",
  mov: "video/quicktime",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  m4a: "audio/mp4",
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  txt: "text/plain",
  md: "text/markdown",
};

/**
 * Local-storage file streaming with Range support (video seeking).
 * Authorization: the key embeds the workspace id — membership is verified
 * before any byte is served.
 */
export async function GET(req: NextRequest, { params }: { params: { key: string[] } }) {
  if (getEnv().STORAGE_DRIVER !== "local") {
    return NextResponse.json({ error: "Not available" }, { status: 404 });
  }
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

  const key = params.key.join("/");
  // workspaces/<workspaceId>/...
  const workspaceId = params.key[1];
  if (!workspaceId) return NextResponse.json({ error: "Invalid key" }, { status: 400 });

  const member = await prisma.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId, userId: session.user.id } },
  });
  if (!member) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const root = path.join(process.cwd(), ".data", "storage");
  const target = path.normalize(path.join(root, key));
  if (!target.startsWith(root)) return NextResponse.json({ error: "Invalid key" }, { status: 400 });

  let size: number;
  try {
    size = (await stat(target)).size;
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const ext = target.split(".").pop()?.toLowerCase() ?? "";
  const contentType = MIME[ext] ?? "application/octet-stream";
  const range = req.headers.get("range");

  if (range) {
    const match = range.match(/bytes=(\d*)-(\d*)/);
    const start = match?.[1] ? Number.parseInt(match[1], 10) : 0;
    const end = match?.[2] ? Math.min(Number.parseInt(match[2], 10), size - 1) : Math.min(start + 4 * 1024 * 1024, size - 1);
    if (start >= size) {
      return new NextResponse(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });
    }
    const handle = await open(target, "r");
    try {
      const length = end - start + 1;
      const buffer = Buffer.alloc(length);
      await handle.read(buffer, 0, length, start);
      return new NextResponse(new Uint8Array(buffer), {
        status: 206,
        headers: {
          "Content-Type": contentType,
          "Content-Length": String(length),
          "Content-Range": `bytes ${start}-${end}/${size}`,
          "Accept-Ranges": "bytes",
        },
      });
    } finally {
      await handle.close();
    }
  }

  const handle = await open(target, "r");
  try {
    const buffer = Buffer.alloc(size);
    await handle.read(buffer, 0, size, 0);
    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: { "Content-Type": contentType, "Content-Length": String(size), "Accept-Ranges": "bytes" },
    });
  } finally {
    await handle.close();
  }
}
