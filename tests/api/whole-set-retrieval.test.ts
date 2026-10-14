import { describe, it, expect, beforeAll, afterAll } from "vitest";
import "./helpers";
import { prisma, createTestUser, disposeTestUser, type TestUser } from "./helpers";
import { indexChunks, searchChunks } from "@/lib/retrieval";
import { generateGuideJob } from "@/lib/pipelines/guide";
import { generateQuizJob } from "@/lib/pipelines/quiz";

/**
 * Regression: a study set whose title/subject shares no vocabulary with its
 * sources (French metadata over an English PDF, offline mock embeddings) used
 * to fail every guide generation with "Retrieval matched none of the N indexed
 * chunk(s)". Whole-set artifacts must cover the indexed material regardless
 * of the metadata; only an explicit topic is allowed to come back empty.
 */

let me: TestUser;
let studySetId: string;

const PAGES = [
  "Review of Basic Electronics. Voltage is the potential difference between two points in a circuit, measured in volts. Current is the rate of flow of electric charge, measured in amperes, and resistance opposes that flow according to Ohm's law V = I R.",
  "Capacitors store energy in an electric field between two plates. For DC signals there is no current flow through a capacitor at steady state, while for AC signals the capacitive reactance decreases as frequency increases.",
  "Inductors store energy in a magnetic field. When two inductors are close enough that their magnetic fields interact with each other, there is an additional effect called mutual inductance between the coils.",
  "A diode allows current to flow in one direction but impedes the flow in the opposite direction. The forward voltage drop of a silicon diode is roughly 0.7 volts, and a Zener diode regulates voltage in reverse breakdown.",
  "If the transistor is being used to amplify DC current, the gain of the amplification is notated as hFE. A bipolar junction transistor has a base, a collector and an emitter, and small base currents control larger collector currents.",
];

const noopCtx = { updateStage: async () => undefined, log: () => undefined };

beforeAll(async () => {
  me = await createTestUser("Retrieval");
  const set = await prisma.studySet.create({
    data: {
      workspaceId: me.workspaceId,
      createdById: me.id,
      title: "Schémas électroniques",
      subject: "Electricité",
      outputTypes: ["GUIDE", "QUIZ"],
    },
  });
  studySetId = set.id;
  const source = await prisma.source.create({
    data: { studySetId, type: "PDF", title: "Electronics_Review.pdf", status: "READY" },
  });
  await indexChunks(
    source.id,
    PAGES.map((content, i) => ({ ordinal: i, kind: "DOCUMENT" as const, content, page: i + 1, tokenCount: 60 })),
  );
});

afterAll(async () => {
  await disposeTestUser(me.email);
  await prisma.$disconnect();
});

describe("whole-set generation does not depend on the set's metadata matching its sources", () => {
  it("precondition: the French title matches none of the English chunks", async () => {
    expect(await searchChunks(studySetId, "Schémas électroniques Electricité")).toHaveLength(0);
  });

  it("generates the study guide from representative chunks", async () => {
    const guide = await prisma.studyGuide.create({ data: { studySetId, title: "guide", status: "QUEUED" } });
    await generateGuideJob({ payload: { studySetId, guideId: guide.id }, ...noopCtx });

    const done = await prisma.studyGuide.findUniqueOrThrow({
      where: { id: guide.id },
      include: { sections: { include: { anchors: true } } },
    });
    expect(done.status).toBe("READY");
    expect(done.sections.length).toBeGreaterThan(0);
    // Grounding is preserved: sections still cite the indexed chunks.
    expect(done.sections.some((s) => s.anchors.length > 0)).toBe(true);
  });

  it("generates a quiz without a topic", async () => {
    const quiz = await prisma.quiz.create({ data: { studySetId, title: "quiz", config: { count: 3 } } });
    await generateQuizJob({ payload: { studySetId, quizId: quiz.id }, ...noopCtx });
    const done = await prisma.quiz.findUniqueOrThrow({ where: { id: quiz.id }, include: { questions: true } });
    expect(done.status).toBe("READY");
    expect(done.questions.length).toBeGreaterThan(0);
  });

  it("still fails truthfully for an explicit topic the sources do not cover", async () => {
    // Mock embeddings hash words into 1536 buckets, so an "unrelated" topic can
    // still collide with a chunk; pin one that verifiably matches nothing.
    const topic = "littérature médiévale";
    expect(await searchChunks(studySetId, topic)).toHaveLength(0);
    const quiz = await prisma.quiz.create({
      data: { studySetId, title: "topic quiz", config: { count: 3, topic } },
    });
    await expect(generateQuizJob({ payload: { studySetId, quizId: quiz.id }, ...noopCtx })).rejects.toThrow(
      /requested topic/,
    );
  });
});
