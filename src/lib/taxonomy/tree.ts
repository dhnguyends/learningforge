/**
 * Client-side course tree: builds Discipline › Subject › Course / Module › Topic
 * from the flat /api/taxonomy payload, counts the courses below every node,
 * and filters it for Explore ("Has courses", search). Pure: no React, no fetch.
 */

export interface FlatNode {
  id: string;
  parentId: string | null;
  level: number;
  code: string;
  name: string;
}

export interface TreeNode<C> extends FlatNode {
  children: TreeNode<C>[];
  /** Courses filed on this node itself, as their main topic (topics only). */
  courses: C[];
  /** Courses for which this topic is a related ("connexe") topic, not their main one. */
  related: C[];
  /** Courses filed anywhere below (and on) this node: main topics only, each course counted once. */
  total: number;
  /** Related links anywhere below (and on) this node (not in `total`). */
  relatedTotal: number;
  /** Names from the discipline down to this node. */
  path: string[];
}

export interface CourseTree<C> {
  roots: TreeNode<C>[];
  byId: Map<string, TreeNode<C>>;
  /** Courses without a topic, or whose topic is unknown. */
  unclassified: C[];
}

export function buildTree<C extends { topicId: string | null; relatedTopicIds?: string[] }>(nodes: FlatNode[], courses: C[]): CourseTree<C> {
  const byId = new Map<string, TreeNode<C>>(
    nodes.map((n) => [n.id, { ...n, children: [], courses: [], related: [], total: 0, relatedTotal: 0, path: [] }]),
  );
  const roots: TreeNode<C>[] = [];
  for (const n of nodes) {
    const node = byId.get(n.id)!;
    const parent = n.parentId ? byId.get(n.parentId) : undefined;
    (parent ? parent.children : roots).push(node);
  }
  const unclassified: C[] = [];
  for (const c of courses) {
    const topic = c.topicId ? byId.get(c.topicId) : undefined;
    if (topic) topic.courses.push(c);
    else unclassified.push(c);
    for (const id of c.relatedTopicIds ?? []) byId.get(id)?.related.push(c);
  }
  const finish = (node: TreeNode<C>, parentPath: string[]) => {
    node.path = [...parentPath, node.name];
    for (const child of node.children) finish(child, node.path);
    node.total = node.courses.length + node.children.reduce((sum, child) => sum + child.total, 0);
    node.relatedTotal = node.related.length + node.children.reduce((sum, child) => sum + child.relatedTotal, 0);
  };
  for (const r of roots) finish(r, []);
  return { roots, byId, unclassified };
}

const normalize = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[’']/g, "'")
    .toLowerCase();

export interface TreeView {
  /** Node ids to show. */
  visible: Set<string>;
  /** Nodes opened by the search (ancestors of a match). */
  opened: Set<string>;
  /** Nodes whose own name, or one of whose courses, matched the search. */
  matches: Set<string>;
}

/**
 * Which nodes Explore shows. "Has courses" keeps only branches with at least
 * one course below them. A search keeps the nodes whose name or course titles
 * match, every node above them (opened, so the match is in view) and every
 * node below a matching name.
 */
export function viewTree<C extends { title: string }>(
  roots: TreeNode<C>[],
  { hasCourses, query }: { hasCourses: boolean; query: string },
): TreeView {
  const q = normalize(query.trim());
  const visible = new Set<string>();
  const opened = new Set<string>();
  const matches = new Set<string>();

  // "Has courses": a main or a related course anywhere below.
  const empty = (node: TreeNode<C>) => node.total + node.relatedTotal === 0;
  const showAll = (node: TreeNode<C>) => {
    if (hasCourses && empty(node)) return;
    visible.add(node.id);
    node.children.forEach(showAll);
  };

  // Returns whether this node is shown.
  const walk = (node: TreeNode<C>): boolean => {
    if (hasCourses && empty(node)) return false;
    if (!q) {
      visible.add(node.id);
      node.children.forEach(walk);
      return true;
    }
    const titleMatch = [...node.courses, ...node.related].some((c) => normalize(c.title).includes(q));
    const selfMatch = normalize(node.name).includes(q) || titleMatch;
    if (selfMatch) {
      matches.add(node.id);
      showAll(node);
      // A course title matched: open the topic so the course is in view.
      if (titleMatch) opened.add(node.id);
      return true;
    }
    let below = false;
    for (const child of node.children) below = walk(child) || below;
    if (below) {
      visible.add(node.id);
      opened.add(node.id);
    }
    return below;
  };
  roots.forEach(walk);
  return { visible, opened, matches };
}

/** Topics (level 4) whose name or path matches every word of the query, for the topic picker. */
export function searchTopics<C>(byId: Map<string, TreeNode<C>>, query: string, limit = 50): TreeNode<C>[] {
  const words = normalize(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const scored: { node: TreeNode<C>; score: number }[] = [];
  for (const node of byId.values()) {
    if (node.level !== 4) continue;
    const name = normalize(node.name);
    const path = normalize(node.path.join(" "));
    if (!words.every((w) => path.includes(w))) continue;
    // Topic-name hits first, then hits on the course/subject above it.
    const score = (name.startsWith(words[0]) ? 0 : name.includes(words[0]) ? 1 : 2) + (words.every((w) => name.includes(w)) ? 0 : 1);
    scored.push({ node, score });
  }
  return scored
    .sort((a, b) => a.score - b.score || a.node.code.localeCompare(b.node.code, undefined, { numeric: true }))
    .slice(0, limit)
    .map((s) => s.node);
}

export interface NodeMatch<C> {
  node: TreeNode<C>;
  /** Where the query matched in node.name: [start, end) in the original string, for highlighting. */
  start: number;
  end: number;
}

/**
 * Folds a name for searching (lower case, accents removed) and keeps, for
 * every folded character, the index of the original character it came from.
 */
function fold(name: string): { text: string; origin: number[] } {
  let text = "";
  const origin: number[] = [];
  for (let i = 0; i < name.length; i++) {
    const folded = name[i].normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[’‘`]/g, "'").toLowerCase();
    for (const ch of folded) {
      text += ch;
      origin.push(i);
    }
  }
  return { text, origin };
}

/**
 * Every node, at any level, whose name contains `query` — case and accents
 * ignored — in tree order from top to bottom (discipline, then its subjects,
 * their courses / modules and topics, then the next discipline).
 */
export function searchNodes<C>(roots: TreeNode<C>[], query: string): NodeMatch<C>[] {
  const q = fold(query.trim()).text;
  if (!q) return [];
  const matches: NodeMatch<C>[] = [];
  const walk = (nodes: TreeNode<C>[]) => {
    for (const node of nodes) {
      const { text, origin } = fold(node.name);
      const at = text.indexOf(q);
      if (at >= 0) matches.push({ node, start: origin[at], end: origin[at + q.length - 1] + 1 });
      walk(node.children);
    }
  };
  walk(roots);
  return matches;
}
