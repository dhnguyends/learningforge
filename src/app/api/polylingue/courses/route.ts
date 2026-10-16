import { z } from "zod";
import { apiHandler, ok, parseJsonBody, requireSession } from "@/lib/api";
import { CEFR_LEVELS, DAILY_GOALS, TARGET_LANGUAGES, BASE_LANGUAGES } from "@/lib/polylingue/levels";
import { isValidTimeZone } from "@/lib/polylingue/progress";
import { listCourses, startCourse } from "@/lib/polylingue/service";

/** The learner's PolyLingue languages, and starting a new one (level first). */

const startSchema = z.object({
  level: z.enum(CEFR_LEVELS),
  targetLang: z.enum(TARGET_LANGUAGES.map((l) => l.code) as [string, ...string[]]),
  baseLang: z.enum(BASE_LANGUAGES.map((l) => l.code) as [string, ...string[]]),
  dailyGoalMinutes: z.number().int().refine((n) => (DAILY_GOALS as readonly number[]).includes(n), "Daily goal must be 5, 10, 15 or 20 minutes"),
  timeZone: z.string().max(64).refine(isValidTimeZone, "Unknown time zone"),
});

export const GET = apiHandler(async () => {
  const session = await requireSession();
  return ok({ courses: await listCourses(session.user.id) });
});

export const POST = apiHandler(async (req) => {
  const session = await requireSession();
  const input = await parseJsonBody(req, startSchema);
  return ok({ course: await startCourse(session.user.id, input) }, { status: 201 });
});
