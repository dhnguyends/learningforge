import { describe, it, expect } from "vitest";
import { sampleForCoverage } from "@/lib/retrieval";

const chunk = (sourceId: string, ordinal: number) => ({ id: `${sourceId}-${ordinal}`, sourceId, ordinal });
const range = (sourceId: string, n: number) => Array.from({ length: n }, (_, i) => chunk(sourceId, i));

describe("sampleForCoverage", () => {
  it("returns nothing for an empty input or a zero budget", () => {
    expect(sampleForCoverage([], 5)).toEqual([]);
    expect(sampleForCoverage(range("a", 3), 0)).toEqual([]);
  });

  it("returns every chunk when the budget exceeds the supply", () => {
    const out = sampleForCoverage([...range("a", 2), ...range("b", 1)], 10);
    expect(out.map((c) => c.id).sort()).toEqual(["a-0", "a-1", "b-0"]);
  });

  it("splits the budget across sources round-robin", () => {
    const out = sampleForCoverage([...range("a", 50), ...range("b", 50), ...range("c", 50)], 7);
    const perSource = (s: string) => out.filter((c) => c.sourceId === s).length;
    expect(out).toHaveLength(7);
    expect([perSource("a"), perSource("b"), perSource("c")]).toEqual([3, 2, 2]);
  });

  it("gives a short source's unused quota to the others", () => {
    const out = sampleForCoverage([...range("a", 1), ...range("b", 20)], 6);
    expect(out.filter((c) => c.sourceId === "a")).toHaveLength(1);
    expect(out.filter((c) => c.sourceId === "b")).toHaveLength(5);
  });

  it("spreads picks over a source's whole length, not just its beginning", () => {
    const out = sampleForCoverage(range("lecture", 100), 4);
    expect(out.map((c) => c.ordinal)).toEqual([12, 37, 62, 87]);
  });

  it("is order-independent with respect to the input", () => {
    const input = [...range("a", 9), ...range("b", 9)];
    const shuffled = [...input].reverse();
    expect(sampleForCoverage(shuffled, 6).map((c) => c.id)).toEqual(sampleForCoverage(input, 6).map((c) => c.id));
  });
});
