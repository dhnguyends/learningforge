import { describe, it, expect } from "vitest";
import { extractJson, restoreLatexEscapes } from "@/lib/ai/shared";
import { extractInlineChunkIds } from "@/lib/pipelines/validation";

/**
 * Output quirks seen with local models (Gemma 4 via Ollama): single-backslash
 * LaTeX inside JSON ("\frac" decodes to form feed + "rac"), and chunk ids
 * written into the prose instead of the anchor fields.
 */
describe("restoreLatexEscapes / extractJson", () => {
  it("repairs \\frac and \\beta that JSON decoded as form feed / backspace", () => {
    // The raw model output contains the two-character escapes \f and \b.
    const raw = String.raw`{"content": "$\frac{1}{R} = \beta$"}`;
    expect((extractJson(raw) as { content: string }).content).toBe(String.raw`$\frac{1}{R} = \beta$`);
  });

  it("leaves properly escaped LaTeX and ordinary whitespace untouched", () => {
    const raw = String.raw`{"content": "$\\frac{a}{b}$\nline two\tcol"}`;
    expect((extractJson(raw) as { content: string }).content).toBe("$\\frac{a}{b}$\nline two\tcol");
  });

  it("walks nested arrays and objects", () => {
    expect(restoreLatexEscapes({ a: ["\u000crac"], b: { c: "\u0008eta" }, n: 1 })).toEqual({
      a: ["\\frac"],
      b: { c: "\\beta" },
      n: 1,
    });
  });
});

describe("extractInlineChunkIds", () => {
  const ids = ["cmv8bahit0000730qvqtg6sk2", "cmv8bahjl0003730qah9g2dm9"];

  it("moves bracketed known ids out of the prose", () => {
    const out = extractInlineChunkIds("Resistance is measured in ohms [cmv8bahit0000730qvqtg6sk2].", ids);
    expect(out.content).toBe("Resistance is measured in ohms.");
    expect(out.ids).toEqual(["cmv8bahit0000730qvqtg6sk2"]);
  });

  it("handles grouped ids and de-duplicates", () => {
    const out = extractInlineChunkIds(
      "A diode conducts one way [cmv8bahjl0003730qah9g2dm9, cmv8bahit0000730qvqtg6sk2]; see also [cmv8bahjl0003730qah9g2dm9].",
      ids,
    );
    expect(out.content).toBe("A diode conducts one way; see also.");
    expect(out.ids).toEqual(["cmv8bahjl0003730qah9g2dm9", "cmv8bahit0000730qvqtg6sk2"]);
  });

  it("leaves links, numeric references, intervals and ordinary math alone", () => {
    const text = "See [the docs](https://x.test), ref [1], interval [0, 1], and $5 \\text{ V}$ with $\\text{peak}$.";
    const out = extractInlineChunkIds(text, ids);
    expect(out.content).toBe(text);
    expect(out.ids).toEqual([]);
  });

  it("removes ids embedded in LaTeX as \\quad \\text{id}", () => {
    const out = extractInlineChunkIds("$$Z = i L \\omega \\quad \\text{cmv8bahjl0003730qah9g2dm9}$$", ids);
    expect(out.content).toBe("$$Z = i L \\omega$$");
    expect(out.ids).toEqual(["cmv8bahjl0003730qah9g2dm9"]);
  });

  it("drops garbled (unknown, cuid-shaped) ids from the text without trusting them as anchors", () => {
    const out = extractInlineChunkIds("Impedance applies to inductors [cmv8bahbahjl0002730qwnxc74lu].", ids);
    expect(out.content).toBe("Impedance applies to inductors.");
    expect(out.ids).toEqual([]);
  });
});
