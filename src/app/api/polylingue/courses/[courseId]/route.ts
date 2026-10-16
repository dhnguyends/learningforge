import { z } from "zod";
import { apiHandler, ok, parseJsonBody, requireSession } from "@/lib/api";
import { BASE_LANGUAGES, CEFR_LEVELS, DAILY_GOALS } from "@/lib/polylingue/levels";
import { isValidTimeZone } from "@/lib/polylingue/progress";
import { courseDetail, deleteCourse, updateCourse } from "@/lib/polylingue/service";

type Ctx = { params: { courseId: string } };

const patchSchema = z.object({
  level: z.enum(CEFR_LEVELS).optional(),
  baseLang: z.enum(BASE_LANGUAGES.map((l) => l.code) as [string, ...string[]]).optional(),
  dailyGoalMinutes: z
    .number()
    .int()
    .refine((n) => (DAILY_GOALS as readonly number[]).includes(n), "Daily goal must be 5, 10, 15 or 20 minutes")
    .optional(),
  timeZone: z.string().max(64).refine(isValidTimeZone, "Unknown time zone").optional(),
});

export const GET = apiHandler<Ctx>(async (_req, { params }) => {
  const session = await requireSession();
  return ok(await courseDetail(session.user.id, params.courseId));
});

export const PATCH = apiHandler<Ctx>(async (req, { params }) => {
  const session = await requireSession();
  const input = await parseJsonBody(req, patchSchema);
  return ok({ course: await updateCourse(session.user.id, params.courseId, input) });
});

export const DELETE = apiHandler<Ctx>(async (_req, { params }) => {
  const session = await requireSession();
  await deleteCourse(session.user.id, params.courseId);
  return ok({ deleted: true });
});
