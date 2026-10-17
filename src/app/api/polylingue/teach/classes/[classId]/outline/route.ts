import { apiHandler, ok, requireTeacher } from "@/lib/api";
import { classOutline } from "@/lib/polylingue/classes-service";

type Ctx = { params: { classId: string } };

/** The class course's units and lessons, to choose what to assign. */
export const GET = apiHandler<Ctx>(async (_req, { params }) => {
  const session = await requireTeacher();
  return ok(await classOutline(session.user.id, params.classId));
});
