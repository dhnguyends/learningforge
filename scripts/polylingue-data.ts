/**
 * Back up or restore PolyLingue data only (courses, lessons, progress,
 * badges, leagues, classes, reminders, reports, lesson versions, voices),
 * without touching the rest of LearningForge.
 *
 *   npm run polylingue:backup                 → backups/polylingue-<stamp>.json.gz
 *   npm run polylingue:restore -- <file>      → adds what is missing (never overwrites)
 *
 * Restore matches accounts by id (e.g. a pod restored from this database):
 * rows of accounts, courses or lessons that do not exist there are skipped
 * and counted. Audio clips are files (storage polylingue/tts/), copied with the
 * storage backup, or generated again from Admin › PolyLingue.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { gunzipSync, gzipSync } from "node:zlib";
import path from "node:path";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

/** In dependency order (parents first). */
const TABLES = [
  "langCurriculum",
  "langPlacementBank",
  "languageCourse",
  "langLesson",
  "langPractice",
  "langLessonProgress",
  "langPracticeProgress",
  "langExerciseAttempt",
  "langCard",
  "langDailyActivity",
  "langAchievement",
  "langOfflineSync",
  "langLeague",
  "langLeagueMember",
  "langReminder",
  "pushSubscription",
  "langClass",
  "langClassMember",
  "langAssignment",
  "langReport",
] as const;
type Table = (typeof TABLES)[number];
type Row = Record<string, unknown>;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const model = (t: Table) => (prisma as any)[t] as { findMany: (a?: object) => Promise<Row[]>; createMany: (a: object) => Promise<{ count: number }> };

async function backup(dir: string) {
  const data: Record<string, Row[]> = {};
  for (const t of TABLES) data[t] = await model(t).findMany();
  data.lessonVersions = await prisma.artifactEdit.findMany({ where: { entityType: "lang_lesson" } });
  data.settings = await prisma.appSetting.findMany({ where: { key: "polylingue_voices" } });
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const file = path.join(dir, `polylingue-${new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)}.json.gz`);
  // Push subscriptions hold browser keys: the backup folder must stay private.
  writeFileSync(file, gzipSync(JSON.stringify({ version: 1, createdAt: new Date().toISOString(), data })), { mode: 0o600 });
  for (const [t, rows] of Object.entries(data)) console.log(`${t.padEnd(22)} ${rows.length}`);
  console.log(`Saved ${file}`);
}

async function restore(file: string) {
  const { data } = JSON.parse(gunzipSync(readFileSync(file)).toString("utf8")) as { data: Record<string, Row[]> };
  const users = new Set((await prisma.user.findMany({ select: { id: true } })).map((u) => u.id));
  const have = (t: Table) => model(t).findMany({ select: { id: true } }).then((r) => new Set(r.map((x) => String(x.id))));
  const known: Partial<Record<Table, Set<string>>> = {};
  const ids = async (t: Table) => (known[t] ??= await have(t));

  // A row is kept when every account / course / lesson … it points at exists.
  const parents: Partial<Record<Table, [string, Table | "user"][]>> = {
    languageCourse: [["userId", "user"], ["curriculumId", "langCurriculum"]],
    langLesson: [["curriculumId", "langCurriculum"], ["courseId", "languageCourse"]],
    langPractice: [["curriculumId", "langCurriculum"], ["courseId", "languageCourse"]],
    langLessonProgress: [["courseId", "languageCourse"], ["lessonId", "langLesson"]],
    langPracticeProgress: [["courseId", "languageCourse"], ["practiceId", "langPractice"]],
    langExerciseAttempt: [["courseId", "languageCourse"]],
    langCard: [["courseId", "languageCourse"]],
    langDailyActivity: [["courseId", "languageCourse"]],
    langAchievement: [["courseId", "languageCourse"]],
    langOfflineSync: [["courseId", "languageCourse"]],
    langLeague: [["createdById", "user"]],
    langLeagueMember: [["leagueId", "langLeague"], ["userId", "user"]],
    langReminder: [["userId", "user"]],
    pushSubscription: [["userId", "user"]],
    langClass: [["teacherId", "user"], ["curriculumId", "langCurriculum"]],
    langClassMember: [["classId", "langClass"], ["userId", "user"]],
    langAssignment: [["classId", "langClass"]],
    langReport: [["lessonId", "langLesson"], ["userId", "user"]],
  };

  for (const t of TABLES) {
    const rows = data[t] ?? [];
    const keep: Row[] = [];
    let skipped = 0;
    for (const row of rows) {
      let ok = true;
      for (const [field, parent] of parents[t] ?? []) {
        const v = row[field];
        if (v === null || v === undefined) continue;
        const set = parent === "user" ? users : await ids(parent);
        if (!set.has(String(v))) {
          ok = false;
          break;
        }
      }
      if (ok) keep.push(row);
      else skipped++;
    }
    const created = keep.length ? (await model(t).createMany({ data: keep, skipDuplicates: true })).count : 0;
    delete known[t]; // children see the rows just added
    console.log(`${t.padEnd(22)} +${created}${skipped ? ` (${skipped} skipped: account, course or lesson missing)` : ""}`);
  }
  const versions = (data.lessonVersions ?? []).filter((v) => users.has(String(v.editedById)));
  if (versions.length) console.log(`lessonVersions         +${(await prisma.artifactEdit.createMany({ data: versions as never, skipDuplicates: true })).count}`);
  for (const s of data.settings ?? []) {
    const exists = await prisma.appSetting.findUnique({ where: { key: String(s.key) } });
    if (!exists) await prisma.appSetting.create({ data: { key: String(s.key), value: s.value as object } });
  }
}

const [cmd, arg] = process.argv.slice(2);
(cmd === "backup" ? backup(arg ?? "backups") : cmd === "restore" && arg ? restore(arg) : Promise.reject(new Error("usage: backup [dir] | restore <file>")))
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
