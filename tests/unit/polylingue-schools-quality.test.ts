import { describe, it, expect } from "vitest";
import { adminRuleViolation, canTeach, effectiveRole } from "@/lib/admin";
import { activitiesSchema, assignmentState, behindReasons, mockActivities, toCsv } from "@/lib/polylingue/classes";
import { retention } from "@/lib/polylingue/analytics";
import { clipKey, isLocalSpeaker, isLocalVoiceKey, lessonAudioTexts, LOCAL_VOICES, speechPath } from "@/lib/polylingue/voices";
import { checkExercise } from "@/lib/polylingue/review";
import type { Exercise, LessonContent } from "@/lib/polylingue/content";
import type { Speaker } from "@/lib/speech/tts";

/** Phase 4 (schools) and Phase 5 (quality) rules, without a database. */

const ex = (over: Partial<Exercise>): Exercise => ({
  type: "choice",
  prompt: "What does hola mean?",
  text: "",
  answer: "hello",
  accepted: [],
  options: ["hello", "bye", "thanks"],
  pairs: [],
  explanation: "",
  audio: "hola",
  ...over,
});

describe("Phase 4 · roles", () => {
  it("makes Teacher and Admin effective only on Human accounts", () => {
    expect(effectiveRole("TEACHER", "HUMAN")).toBe("TEACHER");
    expect(effectiveRole("ADMIN", "HUMAN")).toBe("ADMIN");
    expect(effectiveRole("TEACHER", "BOT")).toBe("USER");
    expect(effectiveRole("ADMIN", "BOT")).toBe("USER");
    expect(effectiveRole("USER", "HUMAN")).toBe("USER");
  });

  it("lets teachers and admins teach, nobody else", () => {
    expect([canTeach("TEACHER"), canTeach("ADMIN"), canTeach("USER"), canTeach(undefined), canTeach(null)]).toEqual([true, true, false, false, false]);
  });

  it("explains why a role cannot be given to a Bot", () => {
    expect(adminRuleViolation({ role: "TEACHER", nature: "BOT" })).toMatch(/made Teachers/);
    expect(adminRuleViolation({ role: "ADMIN", nature: "BOT" })).toMatch(/promoted to Admin/);
    expect(adminRuleViolation({ role: "TEACHER", nature: "BOT" }, { role: "TEACHER", nature: "HUMAN" })).toMatch(/A Teacher must be Human/);
    expect(adminRuleViolation({ role: "ADMIN", nature: "BOT" }, { role: "ADMIN", nature: "HUMAN" })).toMatch(/An Admin must be Human/);
    expect(adminRuleViolation({ role: "USER", nature: "BOT" })).toBeNull();
  });
});

describe("Phase 4 · assignments and falling behind", () => {
  const due = new Date("2026-10-20T18:00:00Z");
  const done = new Map([
    ["a", new Date("2026-10-19T10:00:00Z")],
    ["b", new Date("2026-10-21T10:00:00Z")],
  ]);

  it("dates an assignment: done, late, to do, overdue", () => {
    expect(assignmentState(["a"], done, due, new Date("2026-10-22"))).toMatchObject({ state: "done", done: 1, total: 1 });
    expect(assignmentState(["a", "b"], done, due, new Date("2026-10-22"))).toMatchObject({ state: "late", done: 2 });
    expect(assignmentState(["a", "c"], done, due, new Date("2026-10-19")).state).toBe("todo");
    expect(assignmentState(["c"], done, due, new Date("2026-10-21")).state).toBe("overdue");
    expect(assignmentState([], done, due, new Date("2026-10-19")).state).toBe("todo"); // an empty unit is never "done"
    expect(assignmentState(["a", "b"], done, due, new Date("2026-10-22")).finishedAt?.toISOString()).toBe("2026-10-21T10:00:00.000Z");
  });

  it("gives every reason a student falls behind, or none", () => {
    expect(behindReasons({ inactiveDays: 2, minutes7: 60, weeklyMinutes: 60, overdue: 0 })).toEqual([]);
    expect(behindReasons({ inactiveDays: null, minutes7: 0, weeklyMinutes: 30, overdue: 0 })).toEqual(["Has not practised yet", "0 of 30 min this week"]);
    expect(behindReasons({ inactiveDays: 3, minutes7: 45, weeklyMinutes: 30, overdue: 1 })).toEqual(["Inactive for 3 days", "1 overdue assignment"]);
  });
});

describe("Phase 4 · CSV export and suggested activities", () => {
  it("quotes CSV cells and neutralises spreadsheet formulas", () => {
    const csv = toCsv(["Student", "Note"], [["=HYPERLINK(1)", "a, b"], ["+1", 'say "hi"'], ["-2", null], ["@x", 5]]);
    expect(csv.split("\r\n")).toEqual(["Student,Note", `'=HYPERLINK(1),"a, b"`, `'+1,"say ""hi"""`, "'-2,", "'@x,5", ""]);
  });

  it("keeps the offline activities valid for the schema", () => {
    expect(activitiesSchema.safeParse(mockActivities(["ciao", "grazie"], ["Greetings"])).success).toBe(true);
    expect(activitiesSchema.safeParse(mockActivities([], [])).success).toBe(true);
  });
});

describe("Phase 5 · retention", () => {
  const c = (start: string, today: string, days: string[]) => ({ start, today, days: new Set(days) });
  it("counts only learners old enough, on the exact day", () => {
    const list = [c("2026-10-01", "2026-10-17", ["2026-10-02", "2026-10-08"]), c("2026-10-01", "2026-10-17", ["2026-10-03"]), c("2026-10-16", "2026-10-17", [])];
    expect(retention(list, 1)).toEqual({ eligible: 3, retained: 1, rate: 33 });
    expect(retention(list, 7)).toEqual({ eligible: 2, retained: 1, rate: 50 });
    expect(retention(list, 30)).toEqual({ eligible: 0, retained: 0, rate: null });
    expect(retention([], 1).rate).toBeNull();
  });
});

describe("Phase 5 · voices and lesson audio", () => {
  it("offers local voices for every PolyLingue language and accepts only those", () => {
    for (const lang of ["es", "en", "fr", "de", "it", "pt"]) expect(LOCAL_VOICES[lang]?.length).toBeGreaterThan(0);
    expect(isLocalVoiceKey("es", "kokoro:ef_dora")).toBe(true);
    expect(isLocalVoiceKey("de", "kokoro:ef_dora")).toBe(false);
    expect(isLocalVoiceKey("fr", "azure:fr-FR-DeniseNeural")).toBe(false);
  });

  it("lists each text a lesson plays once, trimmed, within the speech limit", () => {
    const content = {
      intro: "",
      words: [
        { term: " ciao ", translation: "hello", example: "", exampleTranslation: "", partOfSpeech: "" },
        { term: "grazie", translation: "thanks", example: "", exampleTranslation: "", partOfSpeech: "" },
      ],
      exercises: [ex({ audio: "ciao" }), ex({ type: "match", audio: "", pairs: [{ left: "sì", right: "yes" }, { left: "grazie", right: "thanks" }] }), ex({ audio: "x".repeat(401) })],
    } as LessonContent;
    expect(lessonAudioTexts(content)).toEqual(["ciao", "grazie", "sì"]);
  });

  it("keys clips by voice, language and text, and only calls local voices free", () => {
    const speaker = (id: string): Speaker => ({ id, label: id, ext: "mp3", contentType: "audio/mpeg", synthesize: async () => ({ audio: Buffer.alloc(0), contentType: "audio/mpeg", ext: "mp3" }) });
    const k1 = clipKey(speaker("kokoro-Kokoro-82M-ef_dora"), "es", "hola");
    expect(k1).toMatch(/^polylingue\/tts\/kokoro-Kokoro-82M-ef_dora\/es\/[0-9a-f]{24}\.mp3$/);
    expect(clipKey(speaker("kokoro-Kokoro-82M-ef_dora"), "es", "hola")).toBe(k1);
    expect(clipKey(speaker("piper-es_ES-davefx-medium"), "es", "hola")).not.toBe(k1);
    expect(clipKey(speaker("azure-es-ES/Elvira"), "es", "hola")).toMatch(/azure-es-ES_Elvira/); // no path separator from a voice name
    expect([isLocalSpeaker(speaker("kokoro-x")), isLocalSpeaker(speaker("piper-x")), isLocalSpeaker(speaker("mock")), isLocalSpeaker(speaker("azure-x"))]).toEqual([true, true, true, false]);
    expect(speechPath("pt", "olá, tudo bem?")).toBe("/api/polylingue/speech?lang=pt&text=ol%C3%A1%2C%20tudo%20bem%3F");
  });
});

describe("Phase 5 · hand-edited exercises stay playable", () => {
  it("accepts a valid edit and explains what is wrong otherwise", () => {
    expect(() => checkExercise(ex({}), 0)).not.toThrow();
    expect(() => checkExercise(ex({ answer: "salut" }), 0)).toThrow(/Exercise 1: the answer must be one of the options/);
    expect(() => checkExercise(ex({ options: ["hello"] }), 1)).toThrow(/Exercise 2: give at least 2 options/);
    expect(() => checkExercise(ex({ type: "match", pairs: [{ left: "a", right: "b" }] }), 2)).toThrow(/give at least 2 pairs/);
    expect(() => checkExercise(ex({ type: "cloze", text: "No blank here", answer: "x", options: [] }), 3)).toThrow(/needs a \{\{blank\}\}/);
    expect(() => checkExercise(ex({ type: "translate", answer: " ", options: [] }), 4)).toThrow(/the answer is empty/);
    expect(() => checkExercise(ex({ type: "cloze", text: "Je {{suis}} là", answer: "suis", options: [] }), 5)).not.toThrow();
  });
});
