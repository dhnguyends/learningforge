import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

/**
 * Placeholder ("mock") transcription must never pass for a real lecture:
 * outside tests and explicit demos the mock transcriber refuses to run, and a
 * course that still holds a placeholder transcript is not ready to generate
 * from. This file simulates a non-test deployment (mocks not allowed).
 */
vi.mock("@/lib/env", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/env")>();
  return { ...actual, mockProvidersAllowed: () => false };
});

const { prisma, createTestUser, disposeTestUser } = await import("./helpers");
const { getIndexingReadiness } = await import("@/lib/retrieval/readiness");
const { getTranscriber } = await import("@/lib/transcription");
const { mockProvidersAllowed: realAllowed } = await vi.importActual<typeof import("@/lib/env")>("@/lib/env");
const { indexChunks } = await import("@/lib/retrieval");

let me: Awaited<ReturnType<typeof createTestUser>>;
let studySetId: string;

beforeAll(async () => {
  me = await createTestUser("Placeholder guard");
  studySetId = (await prisma.studySet.create({ data: { workspaceId: me.workspaceId, createdById: me.id, title: "Lecture" } })).id;
});

afterAll(async () => {
  await disposeTestUser(me.email);
  await prisma.$disconnect();
});

describe("mock transcription guard", () => {
  it("is allowed only in tests or with ALLOW_MOCK_PROVIDERS=true", () => {
    const env = (over: object) => ({ NODE_ENV: "development", ALLOW_MOCK_PROVIDERS: false, ...over }) as never;
    expect(realAllowed(env({}))).toBe(false);
    expect(realAllowed(env({ NODE_ENV: "test" }))).toBe(true);
    expect(realAllowed(env({ ALLOW_MOCK_PROVIDERS: true }))).toBe(true);
  });

  it("refuses to write placeholder text outside tests and demos", async () => {
    // TRANSCRIPTION_PROVIDER is "mock" in the test environment.
    await expect(getTranscriber().transcribe(Buffer.from("audio"), "a.mp3", {})).rejects.toThrow(
      /Transcription is not configured .*TRANSCRIPTION_PROVIDER="whisper"/,
    );
  });

  it("keeps a course with a placeholder transcript from generating", async () => {
    const source = await prisma.source.create({ data: { studySetId, type: "AUDIO", title: "lecture.m4a", status: "READY" } });
    await prisma.transcript.create({ data: { sourceId: source.id, language: "en", provider: "mock", status: "READY" } });
    await indexChunks(source.id, [
      { ordinal: 0, kind: "TRANSCRIPT", content: "[mock transcription 1] Lecture audio segment covering minute 0.", startMs: 0, endMs: 12_000, tokenCount: 20 },
    ]);
    const readiness = await getIndexingReadiness(studySetId);
    expect(readiness).toMatchObject({ ready: false, placeholderSources: 1 });
    expect(readiness.reason).toMatch(/placeholder transcript .*Import again/);
  });
});
