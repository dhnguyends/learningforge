import { readFile } from "node:fs/promises";
import path from "node:path";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { badRequest } from "@/lib/api";
import { flatten, formatTaxonomy, parseTaxonomy, pathKey, planImport, type ImportPlan, type TextNode } from "@/lib/taxonomy/parse";
import { findByName, placeAmongSiblings, renumber } from "@/lib/taxonomy/edit";

/**
 * The tree's text form. The DATABASE is the source of truth (admins edit the
 * tree in Admin → Courses Tree); this file seeds a new database, takes
 * additions made by hand (`npm run taxonomy:import`), and is refreshed from
 * the database with `npm run taxonomy:export`.
 */
export const TAXONOMY_FILE = path.join(process.cwd(), "docs", "COURSE-TAXONOMY.txt");

export interface ImportSummary {
  created: number;
  /** Nodes of the file already in the database (matched by path; the database's numbering and order win). */
  matched: number;
  /** Nodes only in the database (added, renamed or kept in the app): left alone, listed for information. */
  onlyInDatabase: { code: string; name: string }[];
}

/**
 * Adds the file's nodes that the database does not have yet, each at its
 * place in the file among its siblings, and refuses one whose name is
 * already used elsewhere in the tree. Never renames, moves or deletes:
 * after editing the tree in the app, export it rather than re-importing an
 * old file. Nodes are matched by path (names from the discipline down).
 */
export async function importTaxonomy(text?: string): Promise<ImportSummary> {
  const parsed = parseTaxonomy(text ?? (await readFile(TAXONOMY_FILE, "utf8")));
  const existing = await prisma.taxonomyNode.findMany({
    select: { id: true, parentId: true, level: true, code: true, name: true, position: true, _count: { select: { studySets: true } } },
  });
  const plan: ImportPlan = planImport(
    parsed,
    existing.map(({ _count, ...n }) => ({ ...n, courses: _count.studySets })),
  );

  if (plan.create.length > 0) {
    await prisma.$transaction(
      async (tx) => {
        // Node ids by path (the key the plan matched on), to give new nodes their parent.
        const byId = new Map(existing.map((n) => [n.id, n] as const));
        const pathOf = (id: string): string[] => {
          const n = byId.get(id)!;
          return [...(n.parentId ? pathOf(n.parentId) : []), n.name];
        };
        const idByKey = new Map(existing.map((n) => [pathKey(pathOf(n.id)), n.id] as const));

        for (const node of plan.create) {
          const parentId = node.path.length > 1 ? idByKey.get(pathKey(node.path.slice(0, -1))) : null;
          if (parentId === undefined) throw new Error(`Taxonomy import: no parent for ${node.code} ${node.name}`);
          // Names are unique across the whole tree: a new node may not repeat one stored elsewhere.
          const clash = await findByName(tx, node.name);
          if (clash) throw new Error(`Taxonomy import: "${node.name}" (${node.path.join(" › ")}) is already in the tree as ${clash.path}; rename one of them`);
          const created = await tx.taxonomyNode.create({
            data: { parentId, level: node.level, code: node.code, name: node.name, position: 0 },
            select: { id: true },
          });
          await placeAmongSiblings(tx, parentId, created.id, node.position);
          idByKey.set(pathKey(node.path), created.id);
        }
        await renumber(tx);
      },
      { timeout: 120_000 },
    );
  }

  return {
    created: plan.create.length,
    matched: plan.update.length + plan.unchanged,
    onlyInDatabase: [...plan.remove, ...plan.keep].sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true })).map((n) => ({ code: n.code, name: n.name })),
  };
}

/** The database's tree in the file's format. */
export async function exportTaxonomy(): Promise<string> {
  const nodes = await loadTaxonomyNodes();
  const byId = new Map<string, TextNode>(nodes.map((n) => [n.id, { code: n.code, name: n.name, children: [] }]));
  const roots: TextNode[] = [];
  for (const n of nodes) (n.parentId ? byId.get(n.parentId)!.children : roots).push(byId.get(n.id)!);
  return formatTaxonomy(roots);
}

let ensured: Promise<void> | null = null;

/** First use on a fresh database: load the tree from the file (once per process). */
export function ensureTaxonomy(): Promise<void> {
  ensured ??= (async () => {
    if ((await prisma.taxonomyNode.count()) === 0) await importTaxonomy();
  })().catch((err) => {
    ensured = null;
    throw err;
  });
  return ensured;
}

export interface TaxonomyNodeRow {
  id: string;
  parentId: string | null;
  level: number;
  code: string;
  name: string;
}

/** The whole tree, flat, siblings in file order. */
export async function loadTaxonomyNodes(): Promise<TaxonomyNodeRow[]> {
  await ensureTaxonomy();
  return prisma.taxonomyNode.findMany({
    orderBy: [{ level: "asc" }, { position: "asc" }],
    select: { id: true, parentId: true, level: true, code: true, name: true },
  });
}

/* ------------------------------ classification ----------------------------- */

export interface TaxonomyLabel {
  code: string;
  name: string;
}

/** A course's four attributes: its topic and the three levels above it. */
export interface Classification {
  topicId: string;
  discipline: TaxonomyLabel;
  subject: TaxonomyLabel;
  module: TaxonomyLabel;
  topic: TaxonomyLabel;
}

const label = { code: true, name: true } as const;

/** Prisma `select` for StudySet.topic that reaches the discipline. */
export const TOPIC_SELECT = {
  select: {
    id: true,
    ...label,
    parent: { select: { ...label, parent: { select: { ...label, parent: { select: label } } } } },
  },
} satisfies Prisma.StudySet$topicArgs;

type TopicRow = Prisma.TaxonomyNodeGetPayload<typeof TOPIC_SELECT>;

export function toClassification(topic: TopicRow | null | undefined): Classification | null {
  const course = topic?.parent;
  const subject = course?.parent;
  const discipline = subject?.parent;
  if (!topic || !course || !subject || !discipline) return null;
  const pick = (n: TaxonomyLabel) => ({ code: n.code, name: n.name });
  return { topicId: topic.id, discipline: pick(discipline), subject: pick(subject), module: pick(course), topic: pick(topic) };
}

/** Validates a topic id from a request body: null clears, anything else must be a level-4 node. */
export async function resolveTopicId(topicId: string | null): Promise<string | null> {
  if (topicId === null) return null;
  const node = await prisma.taxonomyNode.findUnique({ where: { id: topicId }, select: { level: true, name: true } });
  if (!node) throw badRequest("Unknown topic");
  if (node.level !== 4) throw badRequest(`"${node.name}" is not a topic: choose a topic (level 4) of the course tree`);
  return topicId;
}

/** Number of nodes per level in a parsed file, for the import report. */
export function countLevels(text: string): Record<1 | 2 | 3 | 4, number> {
  const counts = { 1: 0, 2: 0, 3: 0, 4: 0 };
  for (const n of flatten(parseTaxonomy(text))) counts[n.level]++;
  return counts;
}
