import ffmpeg from "fluent-ffmpeg";
import ffmpegStatic from "ffmpeg-static";
import ffprobeStatic from "ffprobe-static";
import { spawn } from "node:child_process";
import { writeFileSync, rmSync } from "node:fs";
import { getStorage } from "@/lib/storage";
import type { Env } from "@/lib/env";
import { getEnv } from "@/lib/env";

if (ffmpegStatic) ffmpeg.setFfmpegPath(ffmpegStatic);
if (ffprobeStatic?.path) ffmpeg.setFfprobePath(ffprobeStatic.path);

export interface MediaProbe {
  durationSec: number;
  width?: number;
  height?: number;
  videoCodec?: string;
  audioCodec?: string;
  sizeBytes?: number;
}

export async function probeMedia(input: Buffer, filename: string): Promise<MediaProbe> {
  return new Promise((resolve, reject) => {
    const tmp = `${osTmp()}/lf-probe-${Date.now()}-${sanitize(filename)}`;
    writeFileSync(tmp, input);
    ffmpeg.ffprobe(tmp, (err, data) => {
      rmSync(tmp, { force: true });
      if (err) return reject(err);
      const video = data.streams?.find((s) => s.codec_type === "video");
      const audio = data.streams?.find((s) => s.codec_type === "audio");
      resolve({
        durationSec: data.format?.duration ?? 0,
        width: video?.width,
        height: video?.height,
        videoCodec: video?.codec_name,
        audioCodec: audio?.codec_name,
        sizeBytes: Number(data.format?.size ?? 0) || undefined,
      });
    });
  });
}

/**
 * Extract mono 16 kHz MP3 audio (the format every transcription provider wants)
 * and write it to object storage. Returns the storage key + duration.
 */
export async function extractAudio(
  input: Buffer,
  filename: string,
  outputKey: string,
): Promise<{ key: string; durationSec: number }> {
  const tmpIn = tmpPath(filename);
  const tmpOut = tmpPath(`${sanitize(filename)}.mp3`);
  const fs = await import("node:fs/promises");
  await fs.writeFile(tmpIn, input);

  try {
    const duration = await new Promise<number>((resolve, reject) => {
      ffmpeg.ffprobe(tmpIn, (err, data) => {
        if (err) reject(err);
        else resolve(data.format?.duration ?? 0);
      });
    });

    await new Promise<void>((resolve, reject) => {
      ffmpeg(tmpIn)
        .noVideo()
        .audioChannels(1)
        .audioFrequency(16000)
        .audioBitrate(64)
        .format("mp3")
        .on("error", (err) => reject(err))
        .on("end", () => resolve())
        .save(tmpOut);
    });

    const audio = await fs.readFile(tmpOut);
    await getStorage().put(outputKey, audio, { contentType: "audio/mpeg" });
    return { key: outputKey, durationSec: duration };
  } finally {
    await fs.rm(tmpIn, { force: true });
    await fs.rm(tmpOut, { force: true });
  }
}

/**
 * Download the best-audio stream of a YouTube video using yt-dlp when it is
 * available on PATH. Fails with an actionable error otherwise.
 */
export async function fetchYouTubeAudio(
  videoUrl: string,
  outputKey: string,
): Promise<{ key: string; durationSec: number; title: string }> {
  const hasYtDlp = await new Promise<boolean>((resolve) => {
    const proc = spawn("yt-dlp", ["--version"]);
    proc.on("error", () => resolve(false));
    proc.on("close", (code) => resolve(code === 0));
  });
  if (!hasYtDlp) {
    throw new Error(
      "YouTube ingestion requires yt-dlp on the server PATH (or set TRANSCRIPTION_PROVIDER=mock to simulate).",
    );
  }

  const tmpOut = tmpPath(`yt-${Date.now()}.mp3`);
  await new Promise<void>((resolve, reject) => {
    const proc = spawn("yt-dlp", ["-f", "bestaudio", "-x", "--audio-format", "mp3", "-o", tmpOut, videoUrl]);
    let stderr = "";
    proc.stderr.on("data", (d) => (stderr += d.toString()));
    proc.on("error", reject);
    proc.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`yt-dlp failed: ${stderr.slice(-400)}`))));
  });

  const fs = await import("node:fs/promises");
  try {
    const audio = await fs.readFile(tmpOut);
    const duration = await new Promise<number>((resolve) => {
      ffmpeg.ffprobe(tmpOut, (err, data) => resolve(err ? 0 : data.format?.duration ?? 0));
    });
    await getStorage().put(outputKey, audio, { contentType: "audio/mpeg" });
    const title = (await import("node:path")).basename(tmpOut).replace(/\.mp3$/, "");
    return { key: outputKey, durationSec: duration, title };
  } finally {
    await fs.rm(tmpOut, { force: true });
  }
}

/** YouTube oEmbed metadata without an API key. */
export async function fetchYouTubeMeta(videoUrl: string): Promise<{ title: string; author: string; thumbnail: string }> {
  const res = await fetch(
    `https://www.youtube.com/oembed?url=${encodeURIComponent(videoUrl)}&format=json`,
    { signal: AbortSignal.timeout(10_000) },
  );
  if (!res.ok) throw new Error("Could not load YouTube metadata — is the video public?");
  const json = (await res.json()) as { title: string; author_name: string; thumbnail_url: string };
  return { title: json.title, author: json.author_name, thumbnail: json.thumbnail_url };
}

export function parseYouTubeId(url: string): string | null {
  const m = url.match(
    /(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/,
  );
  return m?.[1] ?? null;
}

function tmpPath(name: string): string {
  return `${osTmp()}/lf-${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${sanitize(name)}`;
}

function osTmp(): string {
  return process.env.TEMP ?? process.env.TMP ?? "/tmp";
}

function sanitize(name: string): string {
  return name.replace(/[^A-Za-z0-9._-]/g, "_").slice(-60);
}

/** Reserved for future video normalization (thumbnails, HLS). */
export function ffmpegEnvNote(): Env {
  return getEnv();
}
