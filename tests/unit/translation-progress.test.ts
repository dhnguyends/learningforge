import { describe, it, expect, vi, afterEach } from "vitest";

vi.hoisted(() => {
  process.env.AZURE_TRANSLATOR_KEY = "test-azure-key-not-real";
  process.env.GPU_DETECTION = "off";
});

import { AzureTranslator, LocalTranslator } from "@/lib/translation";

/** Translators report progress after every batch, for the reader's progress bar. */
afterEach(() => vi.unstubAllGlobals());

describe("translation progress", () => {
  it("Azure reports after each batch of 25 items, up to the total", async () => {
    const fetchMock = vi.fn(async (_url: string, init: { body: string }) => {
      const items = JSON.parse(init.body) as { Text: string }[];
      return new Response(JSON.stringify(items.map((i) => ({ translations: [{ text: `es:${i.Text}` }] }))), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const steps: [number, number][] = [];
    const texts = Array.from({ length: 60 }, (_, i) => `segment ${i}`);
    const out = await new AzureTranslator().translate(texts, "en", "es", (done, total) => {
      steps.push([done, total]);
    });
    expect(out).toHaveLength(60);
    expect(out[59]).toBe("es:segment 59");
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(steps).toEqual([
      [25, 60],
      [50, 60],
      [60, 60],
    ]);
  });

  it("local Gemma reports after each batch", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: { body: string }) => {
        const body = JSON.parse(init.body) as { messages: { content: string }[] };
        const items = JSON.parse(body.messages[1].content) as string[];
        return new Response(JSON.stringify({ message: { content: JSON.stringify({ translations: items.map((t) => `es:${t}`) }) } }), { status: 200 });
      }),
    );
    const translator = new LocalTranslator();
    translator.batchChars = 30;
    const steps: number[] = [];
    const texts = ["one two three four", "five six seven", "eight nine ten eleven", "twelve"];
    const out = await translator.translate(texts, "en", "es", (done) => {
      steps.push(done);
    });
    expect(out).toEqual(texts.map((t) => `es:${t}`));
    expect(steps.at(-1)).toBe(4);
    expect(steps.length).toBeGreaterThan(1);
    expect([...steps].sort((a, b) => a - b)).toEqual(steps);
  });
});
