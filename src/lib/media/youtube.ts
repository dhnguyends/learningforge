/**
 * YouTube URL handling (REVIEW-REPORT.md S4).
 *
 * The old check was an unanchored regex: any URL that merely CONTAINED
 * "youtube.com/watch?v=<11 chars>" — e.g. "https://attacker.example/x?youtube.com/watch?v=AAAAAAAAAAA" —
 * was accepted, and the ORIGINAL URL was handed to yt-dlp, whose generic
 * extractor fetches arbitrary hosts (internal services, cloud metadata
 * endpoints) from the server. Now the URL is parsed, the host must be a
 * YouTube host, and only a canonical URL rebuilt from the video id ever
 * leaves this module.
 */

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const WATCH_HOSTS = new Set(["youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com"]);
const PATH_ID_HOSTS = new Set([...WATCH_HOSTS, "youtube-nocookie.com", "www.youtube-nocookie.com"]);

/** Video id of a genuine YouTube URL, or null. Pure. */
export function parseYouTubeId(input: string): string | null {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (url.username || url.password || (url.port && url.port !== "443" && url.port !== "80")) return null;
  const host = url.hostname.toLowerCase();
  const segments = url.pathname.split("/").filter(Boolean);

  let id: string | null | undefined = null;
  if (host === "youtu.be") {
    id = segments.length === 1 ? segments[0] : null;
  } else if (WATCH_HOSTS.has(host) && url.pathname === "/watch") {
    id = url.searchParams.get("v");
  } else if (PATH_ID_HOSTS.has(host) && segments.length === 2 && ["embed", "shorts", "live", "v"].includes(segments[0])) {
    id = segments[1];
  }
  return id && VIDEO_ID.test(id) ? id : null;
}

/** The only URL form ever passed to yt-dlp or stored: rebuilt from the id. */
export function canonicalYouTubeUrl(videoId: string): string {
  if (!VIDEO_ID.test(videoId)) throw new Error(`Invalid YouTube video id: ${videoId}`);
  return `https://www.youtube.com/watch?v=${videoId}`;
}
