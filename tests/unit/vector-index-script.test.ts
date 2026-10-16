import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { CREATE_VECTOR_INDEX_SQL } from "@/lib/vector-index";

/**
 * `prisma db push` drops the HNSW index (Prisma cannot declare it), so
 * `npm run db:push` runs scripts/ensure-vector-index.mjs afterwards. That
 * script must create exactly the index the server checks and rebuilds.
 */
describe("vector index script", () => {
  const root = path.resolve(__dirname, "../..");

  it("uses the same statement as the server", () => {
    const script = readFileSync(path.join(root, "scripts/ensure-vector-index.mjs"), "utf8");
    expect(script.replace(/\s+/g, " ")).toContain(CREATE_VECTOR_INDEX_SQL);
  });

  it("runs after every schema push", () => {
    const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")) as { scripts: Record<string, string> };
    expect(pkg.scripts["db:push"]).toMatch(/prisma db push && node scripts\/ensure-vector-index\.mjs/);
    expect(readFileSync(path.join(root, "scripts/db-setup.mjs"), "utf8")).toContain("ensureVectorIndex(");
  });
});
