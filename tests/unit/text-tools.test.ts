import { describe, it, expect } from "vitest";
import { changeCase, cleanUpText, countWords, findMatches, joinBrokenLines, joinBrokenWords, replaceAll, tidySpaces } from "@/lib/text-tools";

describe("text editor tools", () => {
  it("changes case in the text's language", () => {
    expect(changeCase("the gods OF private equity. they know", "sentence")).toBe("The gods of private equity. They know");
    expect(changeCase("l'école de la vie", "title", "fr")).toBe("L'école De La Vie");
    expect(changeCase("don't stop", "title")).toBe("Don't Stop");
    expect(changeCase("istanbul", "upper", "tr")).toBe("İSTANBUL");
  });

  it("cleans OCR and transcription artefacts", () => {
    expect(joinBrokenWords("remov- ing and remov-\ning, but well-known and pre- and post-war")).toBe(
      "removing and removing, but well-known and pre- and post-war",
    );
    expect(joinBrokenLines("A sentence broken\nin the middle.\nNext one.\n\nNew paragraph")).toBe("A sentence broken in the middle.\nNext one.\n\nNew paragraph");
    expect(tidySpaces("Hello  ,  world ( yes ) !")).toBe("Hello, world (yes)!");
    expect(tidySpaces("Bonjour  ! Ça va ?", "fr")).toBe("Bonjour ! Ça va ?");
    expect(cleanUpText("VIEW  the remov- ing\nof costs .")).toBe("VIEW the removing of costs.");
    expect(countWords("Ohm's law — U = R × I, 2 times")).toBe(7);
  });

  it("finds and replaces literal text", () => {
    expect(findMatches("Cat cat CAT concat", "cat")).toEqual([0, 4, 8, 15]);
    expect(findMatches("Cat cat CAT concat", "cat", { matchCase: true, wholeWord: true })).toEqual([4]);
    expect(findMatches("a.b axb", "a.b")).toEqual([0]);
    expect(findMatches("anything", "")).toEqual([]);
    expect(replaceAll("cost $5, cost $6", "cost", "price $&")).toEqual({ text: "price $& $5, price $& $6", count: 2 });
  });
});
