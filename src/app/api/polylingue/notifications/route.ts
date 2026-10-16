import { apiHandler, ok, requireSession } from "@/lib/api";
import { notifications } from "@/lib/polylingue/habits-service";

/** Badges not seen yet and the reminders due now, for the PolyLingue pages. */
export const GET = apiHandler(async () => {
  const session = await requireSession();
  return ok(await notifications(session.user.id));
});
