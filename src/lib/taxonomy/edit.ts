import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { ApiError, badRequest, notFound } from "@/lib/api";
import { nameKey } from "@/lib/taxonomy/parse";

/**
 * Maintaining the course tree from Admin → Courses Tree. The admin selects a
 * node and inserts either its FIRST CHILD (one level down; a topic, the
 * leaf, has none) or its NEXT NEIGHBOUR (same parent, same level, right
 * after it). Nothing is ever created above an existing node, every node has
 * exactly one parent (disciplines none), and names are unique across the
 * WHOLE tree, all levels (trimmed, case- and accent-insensitive). The database is the source of truth;
 * docs/COURSE-TAXONOMY.txt is refreshed from it with `npm run taxonomy:export`.
 */

type Tx = Prisma.TransactionClient;

export interface NodeView {
  id: string;
  parentId: string | null;
  level: number;
  code: string;
  name: string;
}

const NODE_SELECT = { id: true, parentId: true, level: true, code: true, name: true } as const;

export function cleanName(raw: string): string {
  const name = raw.replace(/\s+/g, " ").trim();
  if (!name) throw badRequest("A name is required");
  if (name.length > 120) throw badRequest("Names are at most 120 characters");
  return name;
}

/** Puts `nodeId` at `index` among its parent's children (end when omitted) and renumbers them 0..n-1. */
export async function placeAmongSiblings(tx: Tx, parentId: string | null, nodeId: string, index?: number) {
  const siblings = await tx.taxonomyNode.findMany({
    where: { parentId, id: { not: nodeId } },
    orderBy: [{ position: "asc" }, { createdAt: "asc" }],
    select: { id: true, position: true },
  });
  const at = index === undefined ? siblings.length : Math.max(0, Math.min(index, siblings.length));
  const ordered = [...siblings.slice(0, at).map((s) => s.id), nodeId, ...siblings.slice(at).map((s) => s.id)];
  for (const [position, id] of ordered.entries()) {
    const before = siblings.find((s) => s.id === id)?.position;
    if (before !== position) await tx.taxonomyNode.update({ where: { id }, data: { position } });
  }
}

/** Recomputes every node's number from the positions: "3", "3.4", "3.4.2", "3.4.2.1". */
export async function renumber(tx: Tx) {
  const nodes = await tx.taxonomyNode.findMany({
    orderBy: [{ position: "asc" }, { createdAt: "asc" }],
    select: { id: true, parentId: true, code: true },
  });
  const children = new Map<string | null, typeof nodes>();
  for (const n of nodes) children.set(n.parentId, [...(children.get(n.parentId) ?? []), n]);
  const updates: { id: string; code: string }[] = [];
  const walk = (parentId: string | null, prefix: string) => {
    (children.get(parentId) ?? []).forEach((n, i) => {
      const code = prefix ? `${prefix}.${i + 1}` : `${i + 1}`;
      if (n.code !== code) updates.push({ id: n.id, code });
      walk(n.id, code);
    });
  };
  walk(null, "");
  for (const u of updates) await tx.taxonomyNode.update({ where: { id: u.id }, data: { code: u.code } });
}

/** The node anywhere in the tree whose name is the same as `name` (see nameKey), with its path. */
export async function findByName(tx: Tx, name: string): Promise<{ id: string; name: string; path: string } | null> {
  const nodes = await tx.taxonomyNode.findMany({ select: { id: true, parentId: true, name: true } });
  const clash = nodes.find((n) => nameKey(n.name) === nameKey(name));
  if (!clash) return null;
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const path: string[] = [];
  for (let n: (typeof nodes)[number] | undefined = clash; n; n = n.parentId ? byId.get(n.parentId) : undefined) path.unshift(n.name);
  return { id: clash.id, name: clash.name, path: path.join(" › ") };
}

export type InsertMode = "child" | "neighbour";

/**
 * Inserts a node relative to the selected one: its first child, or its next
 * neighbour. `nodeId` null is only for the very first discipline of an empty tree.
 */
export async function insertNode(input: { nodeId: string | null; insert: InsertMode; name: string }): Promise<NodeView> {
  const name = cleanName(input.name);
  return prisma.$transaction(
    async (tx) => {
      let parentId: string | null;
      let level: number;
      let index: number;

      if (input.nodeId === null) {
        if ((await tx.taxonomyNode.count()) > 0) throw badRequest("Select a node first: the new one goes below it or right after it");
        [parentId, level, index] = [null, 1, 0];
      } else {
        const anchor = await tx.taxonomyNode.findUnique({
          where: { id: input.nodeId },
          select: { id: true, parentId: true, level: true, name: true, position: true },
        });
        if (!anchor) throw notFound("Selected node");
        if (input.insert === "child") {
          if (anchor.level >= 4) throw badRequest(`"${anchor.name}" is a topic, the lowest level: a topic has no children`);
          [parentId, level, index] = [anchor.id, anchor.level + 1, 0];
        } else {
          const before = await tx.taxonomyNode.count({
            where: { parentId: anchor.parentId, OR: [{ position: { lt: anchor.position } }, { position: anchor.position, id: { lt: anchor.id } }] },
          });
          [parentId, level, index] = [anchor.parentId, anchor.level, before + 1];
        }
      }

      const clash = await findByName(tx, name);
      if (clash) {
        throw new ApiError(409, `"${clash.name}" already exists in the tree (${clash.path}): every name must be unique`, "duplicate");
      }

      const node = await tx.taxonomyNode.create({
        // Position and number are set just below.
        data: { parentId, level, name, code: "", position: 0 },
        select: { id: true },
      });
      await placeAmongSiblings(tx, parentId, node.id, index);
      await renumber(tx);
      return tx.taxonomyNode.findUniqueOrThrow({ where: { id: node.id }, select: NODE_SELECT });
    },
    { timeout: 60_000 },
  );
}
