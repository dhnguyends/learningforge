import { describe, it, expect } from "vitest";
import { conversationToMarkdown, exportFileName, type ExportMessage } from "@/lib/tutor-export";

/** A tutor conversation exported as Markdown. */
const at = (s: number) => new Date(Date.UTC(2026, 9, 18, 4, 12, s));

const messages: ExportMessage[] = [
  { id: "q1", role: "USER", content: "Why is backprop 'cheap'?", mode: "answer", claimType: null, createdAt: at(0), metadata: {}, anchors: [] },
  {
    id: "a1",
    role: "ASSISTANT",
    content: "Cheap compared to *any* alternative: $J^\\top v$ costs one evaluation.",
    mode: "answer",
    claimType: "SOURCE_GROUNDED",
    createdAt: at(12),
    metadata: { model: "gemma4:latest", modelLabel: "Gemma 4 · local", displayedMs: 14_000 },
    anchors: [
      { startMs: 214_000, endMs: 402_000, page: null, excerpt: "  multiplying a Jacobian\nby a vector  ", source: { title: "Lecture 6 — Backprop" } },
      { startMs: null, endMs: null, page: 3, excerpt: "Reverse mode", source: { title: "lecture06-slides.pdf" } },
    ],
  },
  { id: "q2", role: "USER", content: "A hint on the chain rule", mode: "hint", claimType: null, createdAt: at(30), metadata: { sourceSearch: false }, anchors: [] },
  {
    id: "a2",
    role: "ASSISTANT",
    content: "Start from $f(g(x))$.",
    mode: "hint",
    claimType: "EXTERNAL",
    createdAt: at(95),
    metadata: { sourceSearch: false, provider: "local" }, // older answer: no model name, no browser time
    anchors: [],
  },
];

describe("tutor conversation export", () => {
  const md = conversationToMarkdown({ title: "Why is backprop cheap?", studySetTitle: "Backpropagation & Optimization", exportedAt: at(99), messages });

  it("has the title, the study set and the export date", () => {
    expect(md.startsWith("# Why is backprop cheap?\n\nTutor conversation · study set **Backpropagation & Optimization** · exported 2026-10-18 04:13 UTC")).toBe(true);
  });

  it("writes each question and answer in order, answers kept as Markdown", () => {
    expect(md).toContain("### You · 2026-10-18 04:12 UTC\n\nWhy is backprop 'cheap'?");
    expect(md).toContain("### Tutor · Gemma 4 · local · answered in 00:00:14 · Supported by your sources\n\nCheap compared to *any* alternative: $J^\\top v$ costs one evaluation.");
    expect(md.indexOf("### You · 2026-10-18 04:12")).toBeLessThan(md.indexOf("### You · 2026-10-18 04:12 UTC · Hint"));
  });

  it("lists the cited passages with their place in the source", () => {
    expect(md).toContain("**Sources cited**\n\n- Lecture 6 — Backprop (03:34–06:42): “multiplying a Jacobian by a vector”\n- lecture06-slides.pdf (p. 3): “Reverse mode”");
  });

  it("marks answers given without searching the sources, older answers timed by the server", () => {
    expect(md).toContain("### You · 2026-10-18 04:12 UTC · Hint · sources not searched");
    expect(md).toContain("### Tutor · answered in 00:01:05 · General knowledge · sources not searched\n\nStart from $f(g(x))$.");
  });

  it("names the file after the title and the day", () => {
    expect(exportFileName("Why is backprop 'cheap'?", at(0))).toBe("tutor-why-is-backprop-cheap-2026-10-18.md");
    expect(exportFileName("Théorie de la spéculation", at(0))).toBe("tutor-theorie-de-la-speculation-2026-10-18.md");
    expect(exportFileName("???", at(0))).toBe("tutor-conversation-2026-10-18.md");
  });
});
