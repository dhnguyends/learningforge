import { apiHandler, ok, requireTeacher } from "@/lib/api";
import { audit } from "@/lib/audit";
import { removeStudent } from "@/lib/polylingue/classes-service";

type Ctx = { params: { classId: string; userId: string } };

/** Removes a student from the class (their own course and progress stay theirs). */
export const DELETE = apiHandler<Ctx>(async (_req, { params }) => {
  const session = await requireTeacher();
  await removeStudent(session.user.id, params.classId, params.userId);
  await audit({ userId: session.user.id, action: "polylingue.class_remove_student", entityType: "lang_class", entityId: params.classId, metadata: { student: params.userId } });
  return ok({ ok: true });
});
