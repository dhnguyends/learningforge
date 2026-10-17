import { z } from "zod";
import { apiHandler, ok, parseJsonBody, requireTeacher } from "@/lib/api";
import { audit } from "@/lib/audit";
import { createClass, listTeacherClasses } from "@/lib/polylingue/classes-service";
import { BASE_LANGUAGES, CEFR_LEVELS, TARGET_LANGUAGES } from "@/lib/polylingue/levels";

const schema = z.object({
  name: z.string().trim().min(2).max(60),
  targetLang: z.enum(TARGET_LANGUAGES.map((l) => l.code) as [string, ...string[]]),
  baseLang: z.enum(BASE_LANGUAGES.map((l) => l.code) as [string, ...string[]]),
  level: z.enum(CEFR_LEVELS),
  weeklyMinutes: z.number().int().min(10).max(600).default(60),
});

/** The teacher's classes. */
export const GET = apiHandler(async () => {
  const session = await requireTeacher();
  return ok({ classes: await listTeacherClasses(session.user.id) });
});

/** A new class (its course is written by the AI model if nobody has started it yet). */
export const POST = apiHandler(async (req) => {
  const session = await requireTeacher();
  const c = await createClass(session.user.id, await parseJsonBody(req, schema));
  await audit({ userId: session.user.id, action: "polylingue.class_create", entityType: "lang_class", entityId: c.id, metadata: { targetLang: c.targetLang, level: c.level } });
  return ok({ id: c.id, code: c.code }, { status: 201 });
});
