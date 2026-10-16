import { z } from "zod";
import { apiHandler, ok, parseJsonBody, requireAdmin } from "@/lib/api";
import { audit } from "@/lib/audit";
import { insertNode } from "@/lib/taxonomy/edit";

const insertSchema = z.object({
  /** The selected node; null only for the first discipline of an empty tree. */
  nodeId: z.string().min(1).nullable(),
  /** "child": first child of the selected node · "neighbour": right after it, same parent. */
  insert: z.enum(["child", "neighbour"]),
  name: z.string().min(1).max(200),
});

/**
 * Admin → Courses Tree: insert a node next to the selected one — its first
 * child (not under a topic) or its next neighbour. Names are unique across
 * the whole tree (409 otherwise).
 */
export const POST = apiHandler(async (req) => {
  const admin = await requireAdmin();
  const body = await parseJsonBody(req, insertSchema);
  const node = await insertNode(body);
  await audit({
    userId: admin.user.id,
    action: "admin.taxonomy_insert",
    entityType: "taxonomy_node",
    entityId: node.id,
    metadata: { insert: body.insert, relativeTo: body.nodeId, code: node.code, name: node.name, level: node.level, parentId: node.parentId },
  });
  return ok({ node }, { status: 201 });
});
