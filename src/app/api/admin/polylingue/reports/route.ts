import { apiHandler, ok, requireAdmin } from "@/lib/api";
import { reportQueue } from "@/lib/polylingue/review";

/** Open learner reports, grouped by exercise. */
export const GET = apiHandler(async () => {
  await requireAdmin();
  return ok({ reports: await reportQueue() });
});
