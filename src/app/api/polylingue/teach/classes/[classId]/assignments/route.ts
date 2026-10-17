import { z } from "zod";
import { apiHandler, ok, parseJsonBody, requireTeacher } from "@/lib/api";
import { createAssignment } from "@/lib/polylingue/classes-service";

type Ctx = { params: { classId: string } };

const schema = z
  .object({
    unitIndex: z.number().int().min(0).max(20).optional(),
    lessonId: z.string().min(1).max(64).optional(),
    dueAt: z.coerce.date(),
    note: z.string().trim().max(300).optional(),
  })
  .refine((b) => (b.unitIndex === undefined) !== (b.lessonId === undefined), { message: "Assign either a unit or a lesson" });

/** Assign a unit or a lesson of the class course, with a due date. */
export const POST = apiHandler<Ctx>(async (req, { params }) => {
  const session = await requireTeacher();
  const a = await createAssignment(session.user.id, params.classId, await parseJsonBody(req, schema));
  return ok({ id: a.id, title: a.title }, { status: 201 });
});
