import { apiHandler, ok, requireSession } from "@/lib/api";
import { listAchievements } from "@/lib/polylingue/habits-service";

/** Badges earned and to earn, and streak freezes, per language. */
export const GET = apiHandler(async () => {
  const session = await requireSession();
  return ok({ courses: await listAchievements(session.user.id) });
});
