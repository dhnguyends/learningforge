import { apiHandler, ok, requireAdmin } from "@/lib/api";
import { audit } from "@/lib/audit";
import { rebuildVectorIndex, vectorIndexStatus } from "@/lib/vector-index";

/**
 * Create the semantic-search (HNSW) index when it is missing, or rebuild it.
 * Built CONCURRENTLY, so searches and imports keep running meanwhile.
 */
export const POST = apiHandler(async () => {
  const admin = await requireAdmin();
  const before = await vectorIndexStatus();
  const started = Date.now();
  const after = await rebuildVectorIndex();
  await audit({
    userId: admin.user.id,
    action: "admin.vector_index_rebuild",
    entityType: "vector_index",
    metadata: { wasPresent: before.present, wasValid: before.valid, sizeBytes: after.sizeBytes, ms: Date.now() - started },
  });
  return ok({ index: after, rebuilt: before.present && before.valid, created: !before.present || !before.valid, ms: Date.now() - started });
});
