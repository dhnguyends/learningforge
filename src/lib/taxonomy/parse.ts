/**
 * Course taxonomy: Discipline (1) › Subject (2) › Course / Module (3) › Topic (4).
 *
 * The tree is written by hand in docs/COURSE-TAXONOMY.txt:
 *
 *   1. Science
 *      1.1 Physics
 *          1.1.1 Classical Mechanics
 *                - Kinematics
 *
 * Levels 1–3 carry their number in the file; topics are numbered by position
 * under their course ("1.1.1.1"). Names are unique across the whole tree
 * (see nameKey); the import still matches nodes by their path of names.
 * Pure module: no database, safe to unit-test and to import anywhere.
 */

export type TaxonomyLevel = 1 | 2 | 3 | 4;

export const LEVEL_LABELS: Record<TaxonomyLevel, string> = {
  1: "Discipline",
  2: "Subject",
  3: "Course / Module",
  4: "Topic",
};

export interface ParsedNode {
  level: TaxonomyLevel;
  code: string;
  name: string;
  /** 0-based order among its siblings. */
  position: number;
  /** Names from the discipline down to this node: the node's identity. */
  path: string[];
  children: ParsedNode[];
}

const PATTERNS: { level: TaxonomyLevel; re: RegExp }[] = [
  { level: 1, re: /^(\d+)\.\s+(\S.*)$/ },
  { level: 2, re: /^\s+(\d+\.\d+)\s+(\S.*)$/ },
  { level: 3, re: /^\s+(\d+\.\d+\.\d+)\s+(\S.*)$/ },
  { level: 4, re: /^\s+-\s+(\S.*)$/ },
];

export class TaxonomyParseError extends Error {}

/**
 * What makes two names "the same" anywhere in the tree: trimmed, spaces
 * collapsed, case and accents ignored ("Schrödinger" = "schrodinger ").
 */
export function nameKey(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[’‘`]/g, "'")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** Parses the taxonomy text; throws TaxonomyParseError (with the line number) on any inconsistency. */
export function parseTaxonomy(text: string): ParsedNode[] {
  const roots: ParsedNode[] = [];
  // stack[i] = the open node of level i + 1
  const stack: ParsedNode[] = [];
  // Names are unique across the whole tree (all levels).
  const seen = new Map<string, ParsedNode>();

  text.split(/\r?\n/).forEach((raw, i) => {
    const line = raw.replace(/\s+$/, "");
    if (!line.trim()) return;
    const fail = (why: string): never => {
      throw new TaxonomyParseError(`Line ${i + 1}: ${why} — "${line.trim()}"`);
    };

    const match = PATTERNS.map((p) => ({ level: p.level, m: line.match(p.re) })).find((x) => x.m);
    if (!match?.m) fail("not a discipline, subject, course or topic line");
    const { level, m } = match as { level: TaxonomyLevel; m: RegExpMatchArray };

    const parent = level === 1 ? undefined : stack[level - 2];
    if (level > 1 && !parent) fail(`a ${LEVEL_LABELS[level].toLowerCase()} must follow its ${LEVEL_LABELS[(level - 1) as TaxonomyLevel].toLowerCase()}`);
    const siblings = parent ? parent.children : roots;

    const name = (level === 4 ? m[1] : m[2]).trim();
    let code: string;
    if (level === 4) {
      code = `${parent!.code}.${siblings.length + 1}`;
    } else {
      code = m[1];
      const expected = level === 1 ? `${siblings.length + 1}` : `${parent!.code}.${siblings.length + 1}`;
      if (code !== expected) fail(`expected number ${expected}`);
    }
    const twin = seen.get(nameKey(name));
    if (twin) fail(`"${name}" is already in the tree (${twin.code} ${twin.path.join(" › ")}): every name must be unique`);

    const node: ParsedNode = { level, code, name, position: siblings.length, path: [...(parent?.path ?? []), name], children: [] };
    seen.set(nameKey(name), node);
    siblings.push(node);
    stack[level - 1] = node;
    stack.length = level;
  });

  // A branch may be empty (just added in Admin → Courses Tree, not filled yet).
  return roots;
}

/** Writes a tree back in the file's format; parseTaxonomy(formatTaxonomy(t)) gives t again. */
export function formatTaxonomy(roots: TextNode[]): string {
  const INDENT = ["", "   ", "       ", "             "];
  const lines: string[] = [];
  const walk = (nodes: TextNode[], depth: number) => {
    for (const n of nodes) {
      lines.push(depth === 0 ? `${n.code}. ${n.name}` : depth === 3 ? `${INDENT[3]}- ${n.name}` : `${INDENT[depth]}${n.code} ${n.name}`);
      if (depth < 3) walk(n.children, depth + 1);
    }
  };
  walk(roots, 0);
  return lines.join("\n") + "\n";
}

export interface TextNode {
  code: string;
  name: string;
  children: TextNode[];
}

/** Depth-first, parents before children. */
export function flatten(nodes: ParsedNode[]): ParsedNode[] {
  return nodes.flatMap((n) => [n, ...flatten(n.children)]);
}

/** Stable key for a node: its names from the root, case-insensitive. */
export const pathKey = (path: string[]) => path.map((p) => p.toLowerCase()).join("\u0000");

export interface ExistingNode {
  id: string;
  parentId: string | null;
  level: number;
  code: string;
  name: string;
  position: number;
  /** Courses attached to this node itself. */
  courses: number;
}

export interface ImportPlan {
  /** New nodes, parents before children. */
  create: ParsedNode[];
  /** Existing nodes whose number, position or spelling changed. */
  update: { id: string; node: ParsedNode }[];
  unchanged: number;
  /** Nodes no longer in the file and with no course below them: deleted, children first. */
  remove: ExistingNode[];
  /** Nodes no longer in the file but with courses below them: kept until those courses move. */
  keep: (ExistingNode & { coursesBelow: number })[];
}

/**
 * Compares the file with the stored tree. Nodes are matched by path (names
 * from the root), so re-running after renumbering or reordering keeps every
 * course attached; a renamed node is a new node, and the old one is kept
 * while courses still hang under it.
 */
export function planImport(parsed: ParsedNode[], existing: ExistingNode[]): ImportPlan {
  const byId = new Map(existing.map((n) => [n.id, n]));
  const pathOf = new Map<string, string[]>();
  const resolvePath = (n: ExistingNode): string[] => {
    const cached = pathOf.get(n.id);
    if (cached) return cached;
    const parent = n.parentId ? byId.get(n.parentId) : undefined;
    const path = [...(parent ? resolvePath(parent) : []), n.name];
    pathOf.set(n.id, path);
    return path;
  };
  const existingByKey = new Map(existing.map((n) => [pathKey(resolvePath(n)), n]));

  const plan: ImportPlan = { create: [], update: [], unchanged: 0, remove: [], keep: [] };
  const seen = new Set<string>();
  for (const node of flatten(parsed)) {
    const found = existingByKey.get(pathKey(node.path));
    if (!found) {
      plan.create.push(node);
      continue;
    }
    seen.add(found.id);
    if (found.code !== node.code || found.position !== node.position || found.name !== node.name || found.level !== node.level) {
      plan.update.push({ id: found.id, node });
    } else {
      plan.unchanged++;
    }
  }

  const gone = existing.filter((n) => !seen.has(n.id));
  const childrenOf = new Map<string, ExistingNode[]>();
  for (const n of existing) if (n.parentId) childrenOf.set(n.parentId, [...(childrenOf.get(n.parentId) ?? []), n]);
  const coursesBelow = (n: ExistingNode): number => n.courses + (childrenOf.get(n.id) ?? []).reduce((s, c) => s + coursesBelow(c), 0);

  for (const n of gone.sort((a, b) => b.level - a.level)) {
    const below = coursesBelow(n);
    if (below > 0) plan.keep.push({ ...n, coursesBelow: below });
    else plan.remove.push(n);
  }
  return plan;
}
