import { z } from "zod";
import { apiHandler, ok, parseJsonBody, requireTeacher } from "@/lib/api";
import { audit } from "@/lib/audit";
import { classDashboard, deleteClass, updateClass } from "@/lib/polylingue/classes-service";

type Ctx = { params: { classId: string } };

const schema = z
  .object({ name: z.string().trim().min(2).max(60).optional(), weeklyMinutes: z.number().int().min(10).max(600).optional(), newCode: z.boolean().optional() })
  .refine((b) => Object.values(b).some((v) => v !== undefined), { message: "Nothing to update" });

/** The class dashboard: students, their activity and assignments. */
export const GET = apiHandler<Ctx>(async (_req, { params }) => {
  const session = await requireTeacher();
  return ok(await classDashboard(session.user.id, params.classId));
});

export const PATCH = apiHandler<Ctx>(async (req, { params }) => {
  const session = await requireTeacher();
  const c = await updateClass(session.user.id, params.classId, await parseJsonBody(req, schema));
  return ok({ id: c.id, name: c.name, code: c.code, weeklyMinutes: c.weeklyMinutes });
});

/** Deletes the class and its assignments; students keep their courses and progress. */
export const DELETE = apiHandler<Ctx>(async (_req, { params }) => {
  const session = await requireTeacher();
  await deleteClass(session.user.id, params.classId);
  await audit({ userId: session.user.id, action: "polylingue.class_delete", entityType: "lang_class", entityId: params.classId });
  return ok({ ok: true });
});
