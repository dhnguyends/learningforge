import { describe, it, expect } from "vitest";
import { ytDlpHint } from "@/lib/media/ffmpeg";

/**
 * YouTube imports failed with "HTTP Error 403: Forbidden" after YouTube forced
 * SABR streaming; an outdated yt-dlp (2025.12) cannot download any more. The
 * error must tell the operator to update yt-dlp rather than look like an app bug.
 */
describe("yt-dlp failure hint", () => {
  it("points to a yt-dlp update for YouTube delivery changes", () => {
    const stderr =
      "WARNING: [youtube] 2pJJO9G_Xyw: YouTube is forcing SABR streaming for this client.\nERROR: unable to download video data: HTTP Error 403: Forbidden";
    expect(ytDlpHint(stderr)).toMatch(/update yt-dlp on the server \(python -m pip install -U "yt-dlp\[default\]"\)/);
    expect(ytDlpHint("WARNING: Your yt-dlp version (2025.12.08) is older than 90 days!")).not.toBe("");
  });

  it("adds nothing for unrelated failures", () => {
    expect(ytDlpHint("ERROR: [youtube] abc: Video unavailable. This video is private")).toBe("");
  });
});
