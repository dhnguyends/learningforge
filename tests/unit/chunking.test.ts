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

describe("chunkDocument oversized paragraphs", () => {
  const norm = (s: string) => s.replace(/\s+/g, " ").trim();
  const pdf = (pages: ParsedDocument["pages"]): ParsedDocument => ({ kind: "DOCUMENT", pages, pageCount: pages.length, metadata: {} });
  const sentence = (i: number) => `Sentence ${i} explains how charge carriers drift across the junction under bias.`;

  /** One page, one paragraph, ~1,500 words — how pdfjs-dist delivers PDF pages. */
  const pdfPage = Array.from({ length: 125 }, (_, i) => sentence(i)).join(" ");
  const pdfDoc = pdf([{ page: 7, heading: "Diodes", text: pdfPage }]);

  it("keeps every chunk under the 480-token cap on the same page", () => {
    expect(pdfPage.split(/\s+/).length).toBe(1500);
    const chunks = chunkDocument(pdfDoc);
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) {
      expect(c.tokenCount).toBeLessThanOrEqual(480);
      expect(estimateTokens(c.content)).toBe(c.tokenCount);
      expect(c.page).toBe(7);
      expect(c.heading).toBe("Diodes");
    }
    expect(chunks.map((c) => c.ordinal)).toEqual(chunks.map((_, i) => i));
  });

  it("loses no text and splits at sentence boundaries", () => {
    const chunks = chunkDocument(pdfDoc);
    expect(norm(chunks.map((c) => c.content).join(" "))).toBe(norm(pdfPage));
    for (const c of chunks) expect(c.content).toMatch(/\.$/);
  });

  it("aims for the ~320-token target rather than the cap", () => {
    const chunks = chunkDocument(pdfDoc);
    for (const c of chunks.slice(0, -1)) expect(c.tokenCount).toBeGreaterThanOrEqual(320);
  });

  it("falls back to word boundaries for a sentence longer than the cap", () => {
    const runOn = Array.from({ length: 900 }, (_, i) => `word${i}`).join(" ");
    const chunks = chunkDocument(pdf([{ page: 1, text: runOn }]));
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) expect(c.tokenCount).toBeLessThanOrEqual(480);
    expect(norm(chunks.map((c) => c.content).join(" "))).toBe(norm(runOn));
  });

  it("never merges text across pages", () => {
    const chunks = chunkDocument(
      pdf([
        { page: 1, text: pdfPage },
        { page: 2, text: "A short closing page." },
      ]),
    );
    const page2 = chunks.filter((c) => c.page === 2);
    expect(page2.map((c) => c.content)).toEqual(["A short closing page."]);
    for (const c of chunks.filter((c) => c.page === 1)) expect(c.content).not.toContain("closing page");
  });
});
