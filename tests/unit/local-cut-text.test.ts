import { describe, it, expect, vi, afterEach } from "vitest";
import { z } from "zod";

vi.mock("@/lib/gpu", async (orig) => ({
  ...(await orig<typeof import("@/lib/gpu")>()),
  cpuTimeoutFactor: vi.fn(async () => 1),
}));

import { LocalGenerator, LOCAL_QUOTE_RULE, findCutText } from "@/lib/ai/local";
import { localModelLabel } from "@/lib/ai/ollama";
import { getEnv } from "@/lib/env";

/**
 * A bare double quote inside a text ends it under the JSON grammar of local
 * models (Gemma 4 12B: "…the value of this " then the next fields). Local
 * models are told to use single quotes, and a cut text is asked for once more.
 */
const MODEL = "gemma4:12b-it-q4_K_M";
const schema = z.object({ answer: z.string(), warnings: z.array(z.string()) });

/** A fake Ollama: the model is loaded; chat replies come from `replies` in order. */
function fakeOllama(replies: string[]) {
  const chats: { messages: { role: string; content: string }[] }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const path = new URL(url).pathname;
      if (path === "/api/ps") return new Response(JSON.stringify({ models: [{ name: MODEL, size: 1, size_vram: 1 }] }));
      const body = JSON.parse(String(init?.body));
      chats.push(body);
      const content = replies[Math.min(chats.length - 1, replies.length - 1)];
      return new Response(JSON.stringify({ message: { content }, done_reason: "stop", prompt_eval_count: 10, eval_count: 20 }));
    }),
  );
  return chats;
}

afterEach(() => vi.unstubAllGlobals());

describe("texts cut by a bare double quote", () => {
  it("finds a text that stops in the middle, anywhere in the result", () => {
    expect(findCutText({ answer: "the value of this ", warnings: [] })).toBe("the value of this ");
    expect(findCutText({ answer: "Fine.", items: [{ text: "cut here " }] })).toBe("cut here ");
    expect(findCutText({ answer: "Complete sentence.", warnings: ["Also fine."] })).toBeNull();
    expect(findCutText({ answer: "" })).toBeNull();
    expect(findCutText({ code: "line\n" })).toBeNull(); // a final newline is not a cut
  });

  it("tells local models to use single quotes", async () => {
    const chats = fakeOllama(['{"answer": "Whole.", "warnings": []}']);
    await new LocalGenerator(getEnv(), MODEL).generate({ system: "s", user: "u", schema });
    expect(chats[0].messages[0].content).toContain(LOCAL_QUOTE_RULE);
    expect(chats).toHaveLength(1); // nothing cut: no second call
  });

  it("asks once more for a cut text and keeps the whole answer", async () => {
    const chats = fakeOllama([
      '{"answer": "To price this, the company needs the value of this ", "warnings": ["the rest went here"]}',
      '{"answer": "To price this, the company needs the value of this \'power\' option.", "warnings": []}',
    ]);
    const out = await new LocalGenerator(getEnv(), MODEL).generate({ system: "s", user: "u", schema });
    expect(out.data.answer).toBe("To price this, the company needs the value of this 'power' option.");
    expect(chats).toHaveLength(2);
    expect(chats[1].messages.at(-1)?.content).toMatch(/stops in the middle .*bare double quote/);
    expect(out.usage).toEqual({ inputTokens: 20, outputTokens: 40 });
  });

  it("keeps the first answer when the retry is no better", async () => {
    const chats = fakeOllama(['{"answer": "A longer answer cut at this ", "warnings": []}', '{"answer": "Short ", "warnings": []}']);
    const out = await new LocalGenerator(getEnv(), MODEL).generate({ system: "s", user: "u", schema });
    expect(out.data.answer).toBe("A longer answer cut at this ");
    expect(chats).toHaveLength(2);
  });

  it("labels quantized tags plainly", () => {
    expect(localModelLabel("gemma4:12b-it-q4_K_M")).toBe("Gemma 4 12B Q4_K_M");
    expect(localModelLabel("gemma4:12b")).toBe("Gemma 4 12B");
    expect(localModelLabel("qwen3:8b")).toBe("Qwen 3 8B");
  });
});
