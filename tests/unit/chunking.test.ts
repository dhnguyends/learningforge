import { describe, it, expect } from "vitest";
import { chunkTranscript, chunkDocument, estimateTokens, type TranscriptSegmentInput } from "@/lib/retrieval/chunking";
import type { ParsedDocument } from "@/lib/documents/parse";

function seg(startSec: number, text: string, speaker?: string): TranscriptSegmentInput {
  return { startMs: startSec * 1000, endMs: (startSec + 8) * 1000, speaker, text };
}

/** A long run of same-speaker sentence-ended segments covering ~N tokens. */
function lecture(count: number): TranscriptSegmentInput[] {
  const out: TranscriptSegmentInput[] = [];
  for (let i = 0; i < count; i++) {
    out.push(seg(10 + i * 9, "The gradient flows backward through the computational graph one step at a time.", "Instructor"));
  }
  return out;
}

describe("estimateTokens", () => {
  it("approximates 1.35 tokens per word, rounded up", () => {
    const words = "one two three four".split(" ").length;
    expect(estimateTokens("one two three four")).toBe(Math.ceil(words * 1.35));
    expect(estimateTokens("")).toBe(0);
  });
});

describe("chunkTranscript", () => {
  it("emits contiguous ordinals and never-empty content", () => {
    const chunks = chunkTranscript(lecture(30));
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.map((c) => c.ordinal)).toEqual(chunks.map((_, i) => i));
    for (const c of chunks) {
      expect(c.content.trim().length).toBeGreaterThan(0);
      expect(c.kind).toBe("TRANSCRIPT");
      expect(c.tokenCount).toBeGreaterThan(0);
    }
  });

  it("respects the max-token ceiling for every chunk", () => {
    for (const c of chunkTranscript(lecture(60))) {
      expect(c.tokenCount).toBeLessThanOrEqual(480 + 40); // ceiling + one segment overshoot
    }
  });

  it("breaks on speaker change", () => {
    const chunks = chunkTranscript([
      seg(0, "Any questions on this part?", "Instructor"),
      seg(9, "Yes, what about memory cost?", "Student"),
      seg(18, "Memory is the real price of backpropagation.", "Instructor"),
    ]);
    expect(chunks.length).toBe(3);
    expect(chunks[0].speaker).toBe("Instructor");
    expect(chunks[1].speaker).toBe("Student");
  });

  it("breaks on long pauses but not short ones", () => {
    const text = "This sentence is long enough to stand alone as its own segment.";
    const shortGap = chunkTranscript([seg(0, text), seg(10, text)]); // 2s gap
    const longGap = chunkTranscript([seg(0, text), seg(60, text)]); // 52s gap
    expect(shortGap.length).toBe(1);
    expect(longGap.length).toBe(2);
  });

  it("closes chunks at sentence boundaries once past the target size", () => {
    const chunks = chunkTranscript(lecture(40));
    for (const c of chunks) {
      // Every chunk that isn't the last of a speaker run ends with sentence punctuation.
      expect(c.content).toMatch(/[.!?]"?\s*$/);
    }
  });

  it("keeps chunk time ranges monotonic and aligned to segment boundaries", () => {
    const segs = lecture(25);
    const chunks = chunkTranscript(segs);
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i]!;
      // Transcript chunks always carry time ranges (document chunks don't).
      expect(chunk.startMs, `chunk ${i} startMs`).toBeDefined();
      expect(chunk.endMs, `chunk ${i} endMs`).toBeDefined();
      expect(chunk.endMs!).toBeGreaterThan(chunk.startMs!);
      if (i > 0) expect(chunk.startMs!).toBeGreaterThanOrEqual(chunks[i - 1]!.endMs! - 1);
    }
    expect(chunks[0].startMs).toBe(segs[0].startMs);
  });

  it("skips empty segments", () => {
    const chunks = chunkTranscript([seg(0, "   "), seg(9, "Real content here.")]);
    expect(chunks.length).toBe(1);
    expect(chunks[0].content).toBe("Real content here.");
  });
});

describe("chunkDocument", () => {
  const doc: ParsedDocument = {
    kind: "SLIDE",
    pages: [
      { page: 1, heading: "Intro", text: "First paragraph.\n\nSecond paragraph." },
      {
        page: 2,
        heading: "Long page",
        text: Array.from({ length: 80 }, (_, i) => `Paragraph ${i} with some technical content about gradients.`).join("\n\n"),
      },
      { page: 3, text: "" }, // empty page is skipped entirely
    ],
  } as ParsedDocument;

  it("preserves page numbers on every chunk", () => {
    const chunks = chunkDocument(doc);
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) expect([1, 2]).toContain(c.page);
    expect(chunks.some((c) => c.page === 2 && c.heading === "Long page")).toBe(true);
  });

  it("splits long pages at paragraph boundaries and renumbers globally", () => {
    const chunks = chunkDocument(doc);
    const page2 = chunks.filter((c) => c.page === 2);
    expect(page2.length).toBeGreaterThan(1);
    expect(page2[0].content).toMatch(/^Paragraph 0/);
    expect(chunks.map((c) => c.ordinal)).toEqual(chunks.map((_, i) => i));
  });

  it("marks document chunks with the document kind", () => {
    for (const c of chunkDocument(doc)) expect(c.kind).toBe("SLIDE");
  });
});
