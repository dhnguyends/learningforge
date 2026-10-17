import ffmpeg from "fluent-ffmpeg";
import ffmpegStatic from "ffmpeg-static";
import ffprobeStatic from "ffprobe-static";
import { spawn } from "node:child_process";
import { writeFileSync, rmSync } from "node:fs";
import { getStorage } from "@/lib/storage";
import type { Env } from "@/lib/env";
import { getEnv } from "@/lib/env";
import { parseYouTubeId, canonicalYouTubeUrl } from "@/lib/media/youtube";

export { parseYouTubeId, canonicalYouTubeUrl } from "@/lib/media/youtube";

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
 * YouTube changes its delivery often (SABR streaming, signed formats answering
 * 403) and only a current yt-dlp keeps up — the usual fix is an update.
 */
export function ytDlpHint(stderr: string): string {
  return /HTTP Error 403|SABR|older than \d+ days|Requested format is not available|Sign in to confirm/i.test(stderr)
    ? ' — update yt-dlp on the server (python -m pip install -U "yt-dlp[default]") and retry the import.'
    : "";
}

/** yt-dlp may run at most this long before it is killed. */
const YT_DLP_TIMEOUT_MS = 30 * 60 * 1000;

/**
 * Download the best-audio stream of a YouTube video using yt-dlp when it is
 * available on PATH. Fails with an actionable error otherwise.
 *
 * Only a canonical https://www.youtube.com/watch?v=<id> URL rebuilt from the
 * validated id ever reaches yt-dlp (never the stored/user-supplied string),
 * with playlists disabled, a size ceiling, a wall-clock timeout, and `--`
 * so the URL can never be read as an option.
 */
export async function fetchYouTubeAudio(
  videoUrl: string,
  outputKey: string,
): Promise<{ key: string; durationSec: number; title: string }> {
  const videoId = parseYouTubeId(videoUrl);
  if (!videoId) throw new Error("Not a valid YouTube video URL — only youtube.com / youtu.be links can be imported.");
  const canonicalUrl = canonicalYouTubeUrl(videoId);
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
    const proc = spawn("yt-dlp", [
      "--no-playlist",
      "--max-filesize", "500M",
      // YouTube now requires solving JS challenges; yt-dlp only looks for Deno
      // by default, so point it at the Node.js running this server.
      "--js-runtimes", `node:${process.execPath}`,
      // Convert with the bundled ffmpeg instead of whatever is on PATH.
      ...(ffmpegStatic ? ["--ffmpeg-location", ffmpegStatic] : []),
      "-f", "bestaudio",
      "-x", "--audio-format", "mp3",
      "-o", tmpOut,
      "--", canonicalUrl,
    ]);
    const timer = setTimeout(() => proc.kill("SIGKILL"), YT_DLP_TIMEOUT_MS);
    let stderr = "";
    proc.stderr.on("data", (d) => (stderr = (stderr + d.toString()).slice(-4000)));
    proc.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    proc.on("close", (code, signal) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else if (signal) reject(new Error(`yt-dlp timed out after ${YT_DLP_TIMEOUT_MS / 60000} min`));
      else reject(new Error(`yt-dlp failed: ${stderr.slice(-400)}${ytDlpHint(stderr)}`));
    });
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
  const videoId = parseYouTubeId(videoUrl);
  if (!videoId) throw new Error("Not a valid YouTube video URL");
  const res = await fetch(
    `https://www.youtube.com/oembed?url=${encodeURIComponent(canonicalYouTubeUrl(videoId))}&format=json`,
    { signal: AbortSignal.timeout(10_000) },
  );
  if (!res.ok) throw new Error("Could not load YouTube metadata — is the video public?");
  const json = (await res.json()) as { title: string; author_name: string; thumbnail_url: string };
  return { title: json.title, author: json.author_name, thumbnail: json.thumbnail_url };
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

/** A short recording as WAV (mono, 24 kHz, 16-bit), e.g. a learner's spoken answer. */
export async function toWav(input: Buffer, filename: string): Promise<Buffer> {
  const tmpIn = tmpPath(filename);
  const tmpOut = tmpPath(`${sanitize(filename)}.wav`);
  const fs = await import("node:fs/promises");
  await fs.writeFile(tmpIn, input);
  try {
    await new Promise<void>((resolve, reject) => {
      ffmpeg(tmpIn)
        .noVideo()
        .audioChannels(1)
        .audioFrequency(24000)
        .audioCodec("pcm_s16le")
        .format("wav")
        .on("error", (err) => reject(err))
        .on("end", () => resolve())
        .save(tmpOut);
    });
    return await fs.readFile(tmpOut);
  } finally {
    await fs.rm(tmpIn, { force: true });
    await fs.rm(tmpOut, { force: true });
  }
}
