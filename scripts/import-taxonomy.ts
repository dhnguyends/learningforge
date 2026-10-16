/**
 * Adds the nodes of docs/COURSE-TAXONOMY.txt that the database does not have.
 *
 *   npm run taxonomy:import
 *
 * The database is the source of truth (admins edit the tree in Admin →
 * Courses Tree). This script only ADDS: it never renames, moves or deletes,
 * and lists the nodes found only in the database. After editing the tree in
 * the app, refresh the file with `npm run taxonomy:export` instead.
 */
import { readFile } from "node:fs/promises";
import { prisma } from "@/lib/db";
import { TAXONOMY_FILE, countLevels, importTaxonomy } from "@/lib/taxonomy/store";

async function main() {
  const text = await readFile(TAXONOMY_FILE, "utf8");
  const levels = countLevels(text);
  console.log(`${TAXONOMY_FILE}: ${levels[1]} disciplines, ${levels[2]} subjects, ${levels[3]} courses/modules, ${levels[4]} topics`);
  const r = await importTaxonomy(text);
  console.log(`added ${r.created} · already in the database ${r.matched}`);
  if (r.onlyInDatabase.length > 0) {
    console.log(`${r.onlyInDatabase.length} node(s) only in the database (left alone; run npm run taxonomy:export to write them to the file):`);
    for (const n of r.onlyInDatabase) console.log(`  ${n.code} ${n.name}`);
  }
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
