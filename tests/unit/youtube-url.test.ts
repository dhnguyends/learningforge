import { describe, it, expect } from "vitest";
import { parseYouTubeId, canonicalYouTubeUrl } from "@/lib/media/youtube";

/**
 * REVIEW-REPORT.md S4: the old unanchored regex accepted any URL that merely
 * contained "youtube.com/watch?v=…", and the raw URL went to yt-dlp, which
 * fetches arbitrary hosts (SSRF).
 */
describe("parseYouTubeId", () => {
  it.each([
    ["https://www.youtube.com/watch?v=dQw4w9WgXcQ", "dQw4w9WgXcQ"],
    ["https://youtube.com/watch?v=dQw4w9WgXcQ&t=42s", "dQw4w9WgXcQ"],
    ["https://m.youtube.com/watch?v=dQw4w9WgXcQ", "dQw4w9WgXcQ"],
    ["https://youtu.be/dQw4w9WgXcQ", "dQw4w9WgXcQ"],
    ["https://youtu.be/dQw4w9WgXcQ?si=abc", "dQw4w9WgXcQ"],
    ["https://www.youtube.com/embed/dQw4w9WgXcQ", "dQw4w9WgXcQ"],
    ["https://www.youtube.com/shorts/dQw4w9WgXcQ", "dQw4w9WgXcQ"],
    ["https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ", "dQw4w9WgXcQ"],
  ])("accepts %s", (url, id) => {
    expect(parseYouTubeId(url)).toBe(id);
  });

  it.each([
    ["https://attacker.example/x?youtube.com/watch?v=AAAAAAAAAAA"],
    ["https://attacker.example/youtube.com/watch?v=AAAAAAAAAAA"],
    ["https://youtube.com.attacker.example/watch?v=AAAAAAAAAAA"],
    ["https://www.youtube.com@attacker.example/watch?v=AAAAAAAAAAA"],
    ["http://169.254.169.254/latest/meta-data?youtu.be/AAAAAAAAAAA"],
    ["https://www.youtube.com:8443/watch?v=AAAAAAAAAAA"],
    ["file:///etc/passwd#youtu.be/AAAAAAAAAAA"],
    ["https://www.youtube.com/watch?v=short"],
    ["https://www.youtube.com/watch?v=AAAAAAAAAAA%2F..%2F"],
    ["https://www.youtube.com/playlist?list=PL123"],
    ["not a url"],
  ])("rejects %s", (url) => {
    expect(parseYouTubeId(url)).toBeNull();
  });
});

describe("canonicalYouTubeUrl", () => {
  it("rebuilds a fixed-form URL from the id", () => {
    expect(canonicalYouTubeUrl("dQw4w9WgXcQ")).toBe("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
  });

  it("refuses anything that is not a video id", () => {
    expect(() => canonicalYouTubeUrl("--exec=rm")).toThrow();
  });
});
