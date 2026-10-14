import { describe, it, expect } from "vitest";
import { citationAnchorSchema, anchorToJson, anchorLabel, makeExcerpt } from "@/lib/citations";
import type { CitationAnchor } from "@prisma/client";

const anchor = (over: Partial<CitationAnchor> = {}): CitationAnchor =>
  ({
    id: "anchor_1",
    sourceId: "src_1",
    chunkId: "chunk_1",
    sourceType: "VIDEO",
    startMs: 761_000,
    endMs: 798_000,
    page: null,
    excerpt: "The workhorse is the chain rule.",
    createdAt: new Date(),
    updatedAt: new Date(),
    ...over,
  }) as CitationAnchor;

describe("citationAnchorSchema", () => {
  it("accepts a well-formed A/V anchor and rejects a bad sourceType", () => {
    const parsed = citationAnchorSchema.safeParse({
      sourceId: "src_1",
      sourceType: "video",
      start: "00:12:41.000",
      end: "00:13:18.000",
      excerpt: "The workhorse is the chain rule.",
    });
    expect(parsed.success).toBe(true);

    const bad = citationAnchorSchema.safeParse({ sourceId: "src_1", sourceType: "hologram", excerpt: "x" });
    expect(bad.success).toBe(false);
  });
});

describe("anchorToJson", () => {
  it("serializes time ranges for A/V sources with millisecond timestamps", () => {
    const json = anchorToJson(anchor(), { id: "src_1", type: "VIDEO" });
    expect(json.sourceType).toBe("video");
    expect(json.start).toBe("00:12:41.000");
    expect(json.end).toBe("00:13:18.000");
    expect(json.anchorId).toBe("anchor_1");
    expect(json.chunkId).toBe("chunk_1");
    expect(json.page).toBeUndefined();
  });

  it("serializes page references for documents and omits time fields", () => {
    const json = anchorToJson(anchor({ sourceType: "SLIDES", startMs: null, endMs: null, page: 17 }), { id: "src_1", type: "SLIDES" });
    expect(json.sourceType).toBe("slide");
    expect(json.page).toBe(17);
    expect(json.start).toBeUndefined();
    expect(json.end).toBeUndefined();
  });

  it("maps YouTube sources to the video wire type", () => {
    const json = anchorToJson(anchor({ sourceType: "YOUTUBE" }), { id: "src_1", type: "YOUTUBE" });
    expect(json.sourceType).toBe("video");
  });
});

describe("anchorLabel", () => {
  it("renders a human time-range label with the source title", () => {
    expect(anchorLabel(anchor(), "Lecture 6")).toBe("12:41–13:18 · Lecture 6");
  });

  it("renders page labels for documents", () => {
    const label = anchorLabel(anchor({ sourceType: "NOTE", startMs: null, endMs: null, page: 3 }));
    expect(label).toBe("p. 3 · Notes");
  });

  it("falls back to the source type alone when no locator exists", () => {
    const label = anchorLabel(anchor({ sourceType: "PDF", startMs: null, endMs: null, page: null }));
    expect(label).toBe("PDF");
  });
});

describe("makeExcerpt", () => {
  it("returns short text unchanged (whitespace normalized)", () => {
    expect(makeExcerpt("  chain   rule  ")).toBe("chain rule");
  });

  it("cuts long text at a word boundary with an ellipsis", () => {
    const long = "gradient ".repeat(50).trim();
    const excerpt = makeExcerpt(long, 40);
    expect(excerpt.length).toBeLessThanOrEqual(40);
    expect(excerpt.endsWith("…")).toBe(true);
    expect(excerpt).not.toMatch(/\s…$/); // no dangling space before the ellipsis
  });
});
