import { describe, it, expect } from "vitest";
import { microphoneProblem } from "@/components/polylingue/mic-settings";

/** The advice given when recording cannot start (outside a window that forbids the microphone). */
const err = (name: string) => Object.assign(new Error(name), { name });

describe("microphone problems", () => {
  it("tells the learner what to do for each browser error", () => {
    expect(microphoneProblem(err("NotAllowedError"))).toMatch(/blocked for this site: allow it in the browser's site settings/);
    expect(microphoneProblem(err("SecurityError"))).toMatch(/blocked for this site/);
    expect(microphoneProblem(err("NotFoundError"))).toMatch(/No microphone was found/);
    expect(microphoneProblem(err("OverconstrainedError"))).toMatch(/choose another in Micro settings/);
    expect(microphoneProblem(err("NotReadableError"))).toMatch(/used by another app/);
    expect(microphoneProblem(err("NotSupportedError"))).toMatch(/could not be opened/);
    expect(microphoneProblem(undefined)).toMatch(/could not be opened/);
  });
});
