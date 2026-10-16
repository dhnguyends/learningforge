import { apiHandler, ok, requireAdmin } from "@/lib/api";
import { getDatabaseStats, type DatabaseStats } from "@/lib/db-stats";

/** Short cache: the figures come from several catalog queries and a storage walk. */
const CACHE_MS = 30_000;
let cached: { stats: DatabaseStats; at: number } | null = null;

/**
 * Database monitoring for administrators: database and file sizes,
 * segmentation into passages, embedding features and vector-index health.
 * Read-only; `?refresh=1` bypasses the cache.
 */
export const GET = apiHandler(async (req) => {
  await requireAdmin();
  const refresh = new URL(req.url).searchParams.get("refresh") === "1";
  if (refresh || !cached || Date.now() - cached.at > CACHE_MS) {
    cached = { stats: await getDatabaseStats(), at: Date.now() };
  }
  return ok(cached.stats);
});
