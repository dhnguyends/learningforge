import { apiHandler, requireAdmin } from "@/lib/api";
import { exportTaxonomy } from "@/lib/taxonomy/store";

/** The tree as text, in the docs/COURSE-TAXONOMY.txt format (Admin → Courses Tree → Download). */
export const GET = apiHandler(async () => {
  await requireAdmin();
  return new Response(await exportTaxonomy(), {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Content-Disposition": 'attachment; filename="COURSE-TAXONOMY.txt"',
      "Cache-Control": "no-store",
    },
  });
});
