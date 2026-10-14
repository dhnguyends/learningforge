import { describe, it, expect } from "vitest";
import { extractCitationsFromProse } from "@/lib/pipelines/tutor";
import { extractJson } from "@/lib/ai/shared";

/**
 * Regressions from running the tutor on Gemma 4: it cited inline
 * ("[CHUNK 1] (id=<garbled id>)") and left the structured citations empty,
 * so answers showed no citation chips; and "\tilde" arrived as TAB + "ilde".
 */
const ids = ["cmv8bahit0000730qvqtg6sk2", "cmv8bahjl0001730q079dmkrm", "cmv8bahjl0002730qwnxc74lu"];

describe("extractCitationsFromProse", () => {
  it("turns copied context headers into citations, resolving by position (rescues garbled ids)", () => {
    const text = "The impedance is $Z = 1/(iC\\omega)$ [CHUNK 3] (id=cmv8bahjl0002730qah9g2dm9). For DC, Z → ∞ [CHUNK 3] (id=cmv8bahjl0002730qah9g2dm9).";
    const out = extractCitationsFromProse(text, ids);
    expect(out.content).toBe("The impedance is $Z = 1/(iC\\omega)$. For DC, Z → ∞.");
    expect(out.ids).toEqual([ids[2]]);
  });

  it("handles headers with source/page details and (id=…) parentheticals", () => {
    const text = 'Ohm\'s law holds [CHUNK 1] (id=cmv8bahit0000730qvqtg6sk2, source="Electronics_Review.pdf", page 1) and inductors (id=cmv8bahjl0001730q079dmkrm) store energy.';
    const out = extractCitationsFromProse(text, ids);
    expect(out.content).toBe("Ohm's law holds and inductors store energy.");
    expect(out.ids).toEqual([ids[0], ids[1]]);
  });

  it("ignores positions and ids outside the retrieved set", () => {
    const out = extractCitationsFromProse("See [CHUNK 9] and (id=cmvNOPE0000000000000000000).", ids);
    expect(out.ids).toEqual([]);
  });

  it("leaves ordinary prose untouched", () => {
    const text = "Use (a) the chain rule and [1] the reference, then $f(x)$.";
    expect(extractCitationsFromProse(text, ids)).toEqual({ content: text, ids: [] });
  });
});

describe("restoreLatexEscapes for \\t / \\r / \\n", () => {
  it("repairs \\tilde, \\theta, \\rho, \\nabla decoded as whitespace", () => {
    // As Gemma emits it: \\omega correctly escaped, \tilde / \theta / \rho / \nabla not.
    const raw = String.raw`{"a": "$\tilde{\\omega}$, $\theta$, $\rho$, $\nabla f$"}`;
    expect((extractJson(raw) as { a: string }).a).toBe(String.raw`$\tilde{\omega}$, $\theta$, $\rho$, $\nabla f$`);
  });

  it("keeps real tabs and newlines in text and code", () => {
    const raw = String.raw`{"a": "line one\nline two\n\tif x:\n\t\treturn y"}`;
    expect((extractJson(raw) as { a: string }).a).toBe("line one\nline two\n\tif x:\n\t\treturn y");
  });
});
