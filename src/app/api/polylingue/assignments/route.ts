import { apiHandler, ok, requireSession } from "@/lib/api";
import { openAssignments } from "@/lib/polylingue/classes-service";

/** The student's open assignments, soonest first (PolyLingue home). */
export const GET = apiHandler(async () => {
  const session = await requireSession();
  return ok({ assignments: await openAssignments(session.user.id) });
});
