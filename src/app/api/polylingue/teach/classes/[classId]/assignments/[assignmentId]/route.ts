import { apiHandler, ok, requireTeacher } from "@/lib/api";
import { deleteAssignment } from "@/lib/polylingue/classes-service";

type Ctx = { params: { classId: string; assignmentId: string } };

export const DELETE = apiHandler<Ctx>(async (_req, { params }) => {
  const session = await requireTeacher();
  await deleteAssignment(session.user.id, params.classId, params.assignmentId);
  return ok({ ok: true });
});
