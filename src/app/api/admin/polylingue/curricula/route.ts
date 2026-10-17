import { apiHandler, ok, requireAdmin } from "@/lib/api";
import { listCurricula } from "@/lib/polylingue/review";

/** Every shared PolyLingue course, with learners, lessons, audio and open reports. */
export const GET = apiHandler(async () => {
  await requireAdmin();
  return ok({ curricula: await listCurricula() });
});
