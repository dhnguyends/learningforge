import { describe, it, expect } from "vitest";
import { isNewBest, recordingsPrefix } from "@/lib/polylingue/recordings";

/** Speaking practice: which spoken answer is kept as the best one, and where recordings live. */

describe("the best recording", () => {
  it("is the attempt that scored at least as well", () => {
    expect(isNewBest(undefined, 40)).toBe(true); // first scored attempt
    expect(isNewBest(null, 10)).toBe(true);
    expect(isNewBest(40, 70)).toBe(true);
    expect(isNewBest(70, 70)).toBe(true); // a tie: the newer one
    expect(isNewBest(70, 50)).toBe(false); // a worse attempt only replaces the latest
  });

  it("never comes from an attempt that could not be scored", () => {
    expect(isNewBest(undefined, null)).toBe(false);
    expect(isNewBest(60, null)).toBe(false);
  });

  it("is stored under the learner and the course, so deleting either removes it", () => {
    expect(recordingsPrefix("u1")).toBe("polylingue/recordings/u1");
    expect(recordingsPrefix("u1", "c1")).toBe("polylingue/recordings/u1/c1");
  });
});
