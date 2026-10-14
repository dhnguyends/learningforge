import { PrismaClient } from "@prisma/client";
import { Client } from "pg";

const prisma = new PrismaClient();
const pg = new Client({ connectionString: process.env.DATABASE_URL ?? "postgresql://lectureforge:lectureforge@localhost:5433/lectureforge" });
await pg.connect();

const counts = {
  users: await prisma.user.count(),
  studySets: await prisma.studySet.count(),
  sources: await prisma.source.count(),
  segments: await prisma.transcriptSegment.count(),
  chunks: await prisma.extractedChunk.count(),
  anchors: await prisma.citationAnchor.count(),
  guideSections: await prisma.studyGuideSection.count(),
  cards: await prisma.flashcard.count(),
  questions: await prisma.quizQuestion.count(),
  exercises: await prisma.exercise.count(),
  attempts: await prisma.attempt.count(),
  metrics: await prisma.progressMetric.count(),
  sessions: await prisma.studySession.count(),
  jobs: await prisma.generationJob.count(),
};

const embedded = await pg.query(`select count(*)::int as n from "extracted_chunks" where embedding is not null`);
const due = await prisma.flashcard.count({ where: { dueAt: { lte: new Date() } } });
const running = await prisma.generationJob.count({ where: { status: "RUNNING" } });

console.log(JSON.stringify(counts, null, 1));
console.log("chunks with embedding:", embedded.rows[0].n, "/", counts.chunks);
console.log("cards due now:", due, "| running jobs:", running);

await prisma.$disconnect();
await pg.end();
