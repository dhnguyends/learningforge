import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { flatten, formatTaxonomy, nameKey, parseTaxonomy, planImport, TaxonomyParseError, type ExistingNode, type ParsedNode } from "@/lib/taxonomy/parse";
import { buildTree, searchNodes, searchTopics, viewTree } from "@/lib/taxonomy/tree";

/**
 * Course taxonomy file (docs/COURSE-TAXONOMY.txt): parsing, numbering, and the
 * idempotent import plan that keeps courses attached when the file changes,
 * and the Explore tree built from it (counts, "Has courses", search).
 */
const FILE = readFileSync(path.join(__dirname, "../../docs/COURSE-TAXONOMY.txt"), "utf8");

const SMALL = `1. Science
   1.1 Physics
       1.1.1 Classical Mechanics
             - Kinematics
             - Newton’s laws
2. Engineering
   2.1 Mechanical Engineering
       2.1.1 Statics and Dynamics
             - Machine kinematics
`;

describe("parseTaxonomy", () => {
  it("reads the whole tree: 9 disciplines, 34 subjects, 107 courses/modules, 460 topics", () => {
    const all = flatten(parseTaxonomy(FILE));
    const count = (level: number) => all.filter((n) => n.level === level).length;
    expect([count(1), count(2), count(3), count(4)]).toEqual([9, 34, 107, 460]);
  });

  it("numbers topics by position under their course and keeps the file's numbers above", () => {
    const all = flatten(parseTaxonomy(FILE));
    const byCode = new Map(all.map((n) => [n.code, n]));
    expect(byCode.get("3.4.2")?.name).toBe("Deep Learning");
    expect(byCode.get("3.4.2.2")?.name).toBe("Backpropagation");
    expect(byCode.get("1.1.1.2")?.name).toBe("Newton’s laws");
    expect(byCode.get("9.3.2.4")?.name).toBe("Leadership skills");
  });

  it("has every name once in the whole tree (trimmed, case and accents ignored)", () => {
    const keys = flatten(parseTaxonomy(FILE)).map((n) => nameKey(n.name));
    expect(new Set(keys).size).toBe(keys.length);
    expect(nameKey("  Schrödinger   EQUATION ")).toBe(nameKey("schrodinger equation"));
  });

  it("accepts Windows line endings", () => {
    expect(flatten(parseTaxonomy(SMALL.replace(/\n/g, "\r\n")))).toHaveLength(9);
  });

  it("rejects a wrong number, an orphan topic and a name used twice anywhere", () => {
    expect(() => parseTaxonomy("1. A\n   1.2 B\n       1.2.1 C\n             - D\n")).toThrow(/Line 2: expected number 1.1/);
    expect(() => parseTaxonomy("1. A\n             - D\n")).toThrow(TaxonomyParseError);
    expect(() => parseTaxonomy("1. A\n   1.1 B\n       1.1.1 C\n             - D\n             - d\n")).toThrow(/already in the tree \(1\.1\.1\.1 A › B › C › D\)/);
    // In another branch, at another level, with other accents and case: still the same name.
    expect(() => parseTaxonomy("1. A\n   1.1 Énergie\n2. B\n   2.1 C\n       2.1.1 energie\n")).toThrow(
      /"energie" is already in the tree \(1\.1 A › Énergie\)/,
    );
  });

  it("accepts an empty branch (added in the app, not filled yet)", () => {
    expect(flatten(parseTaxonomy("1. A\n   1.1 B\n       1.1.1 C\n2. Empty discipline\n")).map((n) => n.code)).toEqual(["1", "1.1", "1.1.1", "2"]);
  });
});

describe("formatTaxonomy", () => {
  it("writes the file back exactly as it is", () => {
    expect(formatTaxonomy(parseTaxonomy(FILE))).toBe(FILE.replace(/\r\n/g, "\n"));
  });

  it("writes empty branches so they read back", () => {
    const text = "1. A\n   1.1 B\n2. C\n";
    expect(formatTaxonomy(parseTaxonomy(text))).toBe(text);
  });
});

/** Turns a parsed tree into stored rows (ids = codes), with courses on some nodes. */
function stored(tree: ParsedNode[], courses: Record<string, number> = {}): ExistingNode[] {
  const rows: ExistingNode[] = [];
  const walk = (nodes: ParsedNode[], parentId: string | null) => {
    for (const n of nodes) {
      rows.push({ id: n.code, parentId, level: n.level, code: n.code, name: n.name, position: n.position, courses: courses[n.code] ?? 0 });
      walk(n.children, n.code);
    }
  };
  walk(tree, null);
  return rows;
}

describe("planImport", () => {
  it("creates everything on an empty database, then finds nothing to do", () => {
    const tree = parseTaxonomy(SMALL);
    expect(planImport(tree, []).create).toHaveLength(9);
    const again = planImport(tree, stored(tree));
    expect(again).toMatchObject({ create: [], update: [], remove: [], keep: [], unchanged: 9 });
  });

  it("renumbers in place when a topic is inserted, so courses stay on the same node", () => {
    const before = stored(parseTaxonomy(SMALL), { "1.1.1.1": 2 });
    const after = parseTaxonomy(SMALL.replace("             - Kinematics\n             - Newton", "             - Units\n             - Kinematics\n             - Newton"));
    const plan = planImport(after, before);
    expect(plan.create.map((n) => n.code)).toEqual(["1.1.1.1"]);
    expect(plan.update).toContainEqual({ id: "1.1.1.1", node: expect.objectContaining({ name: "Kinematics", code: "1.1.1.2" }) });
    expect(plan.remove).toEqual([]);
  });

  it("deletes a removed node only when no course is filed below it", () => {
    const before = stored(parseTaxonomy(SMALL), { "2.1.1.1": 1 });
    const plan = planImport(parseTaxonomy("1. Science\n   1.1 Physics\n       1.1.1 Classical Mechanics\n             - Kinematics\n"), before);
    expect(plan.remove.map((n) => n.code)).toEqual(["1.1.1.2"]);
    // Engineering's topic has a course: the topic and everything above it are kept.
    expect(plan.keep.map((n) => [n.code, n.coursesBelow])).toEqual([
      ["2.1.1.1", 1],
      ["2.1.1", 1],
      ["2.1", 1],
      ["2", 1],
    ]);
  });
});

/** The parsed file as /api/taxonomy nodes (ids = codes). */
function flatNodes(text: string) {
  return flatten(parseTaxonomy(text)).map((n) => ({
    id: n.code,
    parentId: n.level === 1 ? null : n.code.split(".").slice(0, -1).join("."),
    level: n.level,
    code: n.code,
    name: n.name,
  }));
}

describe("Explore tree", () => {
  const courses = [
    { id: "a", title: "Backprop lecture", topicId: "3.4.2.2" },
    { id: "b", title: "Deep nets recap", topicId: "3.4.2.2" },
    { id: "c", title: "Markov chains", topicId: null },
  ];
  const { roots, byId, unclassified } = buildTree(flatNodes(FILE), courses);

  it("counts courses on every branch above their topic", () => {
    expect(byId.get("3.4.2.2")?.courses.map((c) => c.id)).toEqual(["a", "b"]);
    expect(["3.4.2", "3.4", "3"].map((id) => byId.get(id)?.total)).toEqual([2, 2, 2]);
    expect(byId.get("1")?.total).toBe(0);
    expect(unclassified.map((c) => c.id)).toEqual(["c"]);
  });

  it("'Has courses' hides every branch without a course below it", () => {
    const { visible } = viewTree(roots, { hasCourses: true, query: "" });
    expect([...visible].sort()).toEqual(["3", "3.4", "3.4.2", "3.4.2.2"]);
    expect(viewTree(roots, { hasCourses: false, query: "" }).visible.size).toBe(610);
  });

  it("search shows matches with their branch opened, ignoring accents and apostrophes", () => {
    const view = viewTree(roots, { hasCourses: false, query: "schrodinger" });
    expect(view.matches).toEqual(new Set(["1.1.4.2"]));
    expect([...view.opened].sort()).toEqual(["1", "1.1", "1.1.4"]);
    expect(viewTree(roots, { hasCourses: false, query: "newton's" }).matches).toEqual(new Set(["1.1.1.2"]));
    // A course title opens its topic.
    expect(viewTree(roots, { hasCourses: true, query: "recap" }).opened.has("3.4.2.2")).toBe(true);
  });

  it("topic search ranks topic-name hits first and can narrow by the path", () => {
    expect(searchTopics(byId, "kinematics").map((n) => n.code)).toEqual(["1.1.1.1", "4.1.1.3"]);
    expect(searchTopics(byId, "kinematics statics").map((n) => n.code)).toEqual(["4.1.1.3"]);
    expect(searchTopics(byId, "")).toEqual([]);
  });
});

describe("Go to a node (searchNodes)", () => {
  const { roots } = buildTree(flatNodes(FILE), []);
  const find = (q: string) => searchNodes(roots, q).map((m) => [m.node.code, m.node.name.slice(m.start, m.end)]);

  it("matches part of a name at any level, ignoring case, from top to bottom", () => {
    expect(find("PHYSIOLOGY")).toEqual([
      ["1.3.5", "physiology"], // Animal physiology (course / module)
      ["5.1.2", "physiology"], // Human physiology (course / module)
      ["5.1.2.1", "physiology"], // Cardiovascular physiology (topic)
      ["5.1.2.2", "physiology"],
      ["5.1.2.3", "physiology"],
      ["5.1.2.4", "physiology"], // Neurophysiology: inside a word
    ]);
    expect(find("kinemat")).toEqual([
      ["1.1.1.1", "Kinemat"],
      ["4.1.1.3", "kinemat"],
    ]);
  });

  it("ignores accents and keeps the original letters for highlighting", () => {
    expect(find("schrodinger")).toEqual([["1.1.4.2", "Schrödinger"]]);
    expect(find("  Science ")[0]).toEqual(["1", "Science"]); // a discipline, trimmed query
  });

  it("finds nothing for an empty or unknown string", () => {
    expect(find("")).toEqual([]);
    expect(find("   ")).toEqual([]);
    expect(find("zzz no such node")).toEqual([]);
  });
});

describe("related (connexe) courses in the tree", () => {
  // Main topic Backpropagation (3.4.2.2); related to Gradient descent (2.5.3.3) and Transformers (3.4.2.5).
  const course = { id: "r", title: "Backprop & optimizers", topicId: "3.4.2.2", relatedTopicIds: ["2.5.3.3", "3.4.2.5"] };
  const { roots, byId } = buildTree(flatNodes(FILE), [course]);

  it("lists the course under its related topics, counted apart from main placements", () => {
    expect(byId.get("2.5.3.3")?.related.map((c) => c.id)).toEqual(["r"]);
    expect(byId.get("2.5.3.3")?.courses).toEqual([]);
    // Mathematics: no course filed there, one related link.
    expect([byId.get("2")?.total, byId.get("2")?.relatedTotal]).toEqual([0, 1]);
    // Deep Learning: the course once as main, once as related (Transformers).
    expect([byId.get("3.4.2")?.total, byId.get("3.4.2")?.relatedTotal]).toEqual([1, 1]);
  });

  it("keeps branches with only related courses under \"Has courses\"", () => {
    const { visible } = viewTree(roots, { hasCourses: true, query: "" });
    expect(["2", "2.5", "2.5.3", "2.5.3.3"].every((id) => visible.has(id))).toBe(true);
    expect(visible.has("1")).toBe(false);
  });
});
