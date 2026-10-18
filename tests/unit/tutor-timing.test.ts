import { describe, it, expect } from "vitest";
import { serverAnswerTimes } from "@/lib/tutor-timing";
import { formatTimestamp } from "@/lib/utils";

/** The tutor's time to answer, shown as HH:MM:SS. */
describe("tutor answer times", () => {
  it("pairs each answer with the question before it", () => {
    const at = (s: number) => new Date(Date.UTC(2026, 9, 18, 10, 0, s)).toISOString();
    expect(
      serverAnswerTimes([
        { id: "q1", role: "USER", createdAt: at(0) },
        { id: "a1", role: "ASSISTANT", createdAt: at(12) },
        { id: "q2", role: "USER", createdAt: at(30) },
        { id: "a2", role: "ASSISTANT", createdAt: at(95) },
        { id: "a3", role: "ASSISTANT", createdAt: at(99) }, // no question of its own
      ]),
    ).toEqual({ a1: 12_000, a2: 65_000 });
  });

  it("formats as HH:MM:SS, hours included", () => {
    expect(formatTimestamp(0, true)).toBe("00:00:00");
    expect(formatTimestamp(7_400, true)).toBe("00:00:07");
    expect(formatTimestamp(65_000, true)).toBe("00:01:05");
    expect(formatTimestamp(3_725_000, true)).toBe("01:02:05");
  });
});
