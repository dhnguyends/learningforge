import { apiHandler, ok, requireAdmin } from "@/lib/api";
import { polylingueAnalytics } from "@/lib/polylingue/analytics";

/** Retention, completion, time per lesson, hardest exercises, per course. */
export const GET = apiHandler(async () => {
  await requireAdmin();
  return ok(await polylingueAnalytics());
});
