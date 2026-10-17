import { apiHandler, ok, requireSession } from "@/lib/api";
import { myClasses } from "@/lib/polylingue/classes-service";

/** The student's classes, assignments and class leagues. */
export const GET = apiHandler(async () => {
  const session = await requireSession();
  return ok({ classes: await myClasses(session.user.id) });
});
