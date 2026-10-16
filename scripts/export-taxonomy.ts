/**
 * Writes the database's course tree to docs/COURSE-TAXONOMY.txt.
 *
 *   npm run taxonomy:export
 *
 * The database is the source of truth once admins edit the tree in Admin →
 * Courses Tree; run this to keep the file (and git) in step with it.
 */
import { readFile, writeFile } from "node:fs/promises";
import { prisma } from "@/lib/db";
import { TAXONOMY_FILE, countLevels, exportTaxonomy } from "@/lib/taxonomy/store";

async function main() {
  const text = await exportTaxonomy();
  const before = await readFile(TAXONOMY_FILE, "utf8").catch(() => "");
  if (before.replace(/\r\n/g, "\n") === text) {
    console.log(`${TAXONOMY_FILE} is already up to date`);
    return;
  }
  await writeFile(TAXONOMY_FILE, text, "utf8");
  const levels = countLevels(text);
  console.log(`wrote ${TAXONOMY_FILE}: ${levels[1]} disciplines, ${levels[2]} subjects, ${levels[3]} courses/modules, ${levels[4]} topics`);
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
