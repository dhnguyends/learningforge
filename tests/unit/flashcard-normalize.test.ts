import { describe, it, expect } from "vitest";
import { normalizeFlashcard, extractInlineChunkIds, stripCitationLeaks } from "@/lib/pipelines/validation";
import { clozeAnswer, clozeBack, clozeFront, hasCloze } from "@/lib/cloze";
import type { FlashcardDraft } from "@/lib/pipelines/schemas";

/**
 * Regressions from Gemma 4 flashcard output:
 * - copied context headers in card text: "… $\Delta V = I R$ [CHUNK 1] (id=cmv8…, source="…", page 1)"
 * - cloze blanks written as "{{...}}" (answer elided)
 */
const ids = ["cmv8bahit0000730qvqtg6sk2", "cmv8bahjl0001730q079dmkrm", "cmv8bahjl0002730qwnxc74lu"];
const card = (over: Partial<FlashcardDraft>): FlashcardDraft => ({
  type: "basic",
  front: "State Ohm's law.",
  back: "V = IR",
  tags: [],
  chunkId: ids[0],
  supportingChunkIds: [],
  ...over,
});

describe("extractInlineChunkIds — copied context headers", () => {
  it("strips '[CHUNK n] (id=…, source=…, page n)' and keeps the id", () => {
    const out = extractInlineChunkIds(
      `At any instant, Ohm's law holds: $\\Delta V = I R$ [CHUNK 2] (id=${ids[1]}, source="Electronics_Review.pdf", page 1).`,
      ids,
    );
    expect(out.content).toBe("At any instant, Ohm's law holds: $\\Delta V = I R$.");
    expect(out.ids).toEqual([ids[1]]);
  });

  it("strips a bare '(id=…)' parenthetical and a lone '[CHUNK 3]' label", () => {
    expect(stripCitationLeaks(`Capacitors block DC (id=${ids[2]}, page 2).`, ids)).toBe("Capacitors block DC.");
    expect(stripCitationLeaks("Inductors pass DC [CHUNK 3].", ids)).toBe("Inductors pass DC.");
  });

  it("leaves ordinary parentheses alone", () => {
    const text = "The impedance (in ohms) of a resistor (ideal) is R.";
    expect(stripCitationLeaks(text, ids)).toBe(text);
  });
});

describe("normalizeFlashcard", () => {
  it("cleans leaked headers from both sides and records their chunks as support", () => {
    const { card: c, note } = normalizeFlashcard(
      card({ back: `Ohm's law: $\\Delta V = I R$ [CHUNK 2] (id=${ids[1]}, source="x.pdf", page 1)` }),
      ids,
    );
    expect(c.back).toBe("Ohm's law: $\\Delta V = I R$");
    expect(c.supportingChunkIds).toEqual([ids[1]]);
    expect(note).toBeUndefined();
  });

  it("turns a cloze card with elided '{{...}}' blanks into a basic card with gaps (production regression)", () => {
    const { card: c, note } = normalizeFlashcard(
      card({ type: "cloze", front: "The impedance of a capacitor is $Z = {{...}}$; for DC it tends to {{…}}.", back: "$Z = 1/(iC\\omega)$, and $Z \\to \\infty$." }),
      ids,
    );
    expect(c.type).toBe("basic");
    expect(c.front).toBe("The impedance of a capacitor is $Z = ____$; for DC it tends to ____.");
    expect(c.back).toBe("$Z = 1/(iC\\omega)$, and $Z \\to \\infty$.");
    expect(note).toMatch(/did not contain their answers/);
  });

  it("keeps a real cloze card", () => {
    const { card: c, note } = normalizeFlashcard(card({ type: "cloze", front: "A diode conducts in {{one direction}}." }), ids);
    expect(c.type).toBe("cloze");
    expect(c.front).toBe("A diode conducts in {{one direction}}.");
    expect(note).toBeUndefined();
  });

  it("downgrades a 'cloze' card that has no blanks", () => {
    const { card: c, note } = normalizeFlashcard(card({ type: "cloze", front: "What does a diode do?" }), ids);
    expect(c.type).toBe("basic");
    expect(note).toMatch(/no blanks/);
  });

  it("does not list the primary chunk as its own support", () => {
    const { card: c } = normalizeFlashcard(card({ back: `V = IR [CHUNK 1] (id=${ids[0]})` }), ids);
    expect(c.supportingChunkIds).toEqual([]);
  });
});

describe("cloze rendering", () => {
  it("parses plain, hinted and Anki-numbered blanks", () => {
    expect(clozeAnswer("one direction")).toBe("one direction");
    expect(clozeAnswer("ohm::unit of resistance")).toBe("ohm");
    expect(clozeAnswer("c1::farad::unit")).toBe("farad");
  });

  it("hides answers on the front (showing hints) and fills them on the back", () => {
    const text = "Resistance is measured in {{ohms::unit}} and capacitance in {{c2::farads}}.";
    expect(hasCloze(text)).toBe(true);
    expect(clozeFront(text)).toBe("Resistance is measured in **[ unit ]** and capacitance in **[ … ]**.");
    expect(clozeBack(text)).toBe("Resistance is measured in **ohms** and capacitance in **farads**.");
    expect(clozeFront(text)).not.toMatch(/ohms|farads/);
  });

  it("leaves text without blanks untouched", () => {
    expect(hasCloze("V = IR")).toBe(false);
    expect(clozeFront("V = IR")).toBe("V = IR");
  });
});
