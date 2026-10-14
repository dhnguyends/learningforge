// Dev probe: run searchChunks against a study set to inspect real similarity scores.
// Usage: npx tsx scripts/probe-retrieval.mts "<title substring>"
process.env.DATABASE_URL ??= "postgresql://lectureforge:lectureforge@localhost:5433/lectureforge?schema=public";
process.env.EMBEDDINGS_PROVIDER ??= "mock";
process.env.NODE_ENV ??= "test";

const titleFilter = process.argv[2] ?? "Electronics";
const { prisma } = await import("../src/lib/db");
const { searchChunks } = await import("../src/lib/retrieval/index");

const set = await prisma.studySet.findFirst({
  where: titleFilter.startsWith("cmv") ? { id: titleFilter } : { title: { contains: titleFilter } },
});
if (!set) throw new Error(`No study set matching "${titleFilter}"`);
console.log("set:", set.id, JSON.stringify(set.title), "subject:", set.subject, "course:", set.course);

const query = `${set.title} ${set.subject ?? ""} ${set.course ?? ""}`;
const withMin = await searchChunks(set.id, query, { k: 24 });
console.log(`default minScore=0.05 hits: ${withMin.length}`, withMin.map((r) => r.score.toFixed(4)));
const noMin = await searchChunks(set.id, query, { k: 24, minScore: -1 });
console.log(`minScore=-1 hits: ${noMin.length}`, noMin.map((r) => r.score.toFixed(4)));

// Compare against the healthy seeded set for reference.
const ml = await prisma.studySet.findFirst({ where: { title: { contains: "Backpropagation" } } });
if (ml) {
  const mlQuery = `${ml.title} ${ml.subject ?? ""} ${ml.course ?? ""}`;
  const mlHits = await searchChunks(ml.id, mlQuery, { k: 24 });
  const mlAll = await searchChunks(ml.id, mlQuery, { k: 24, minScore: -1 });
  console.log(`seeded ML set default hits: ${mlHits.length}/${mlAll.length}`, mlAll.slice(0, 6).map((r) => r.score.toFixed(4)));
}

await prisma.$disconnect();
