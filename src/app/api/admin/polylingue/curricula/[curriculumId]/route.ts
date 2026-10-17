import { apiHandler, ok, requireAdmin } from "@/lib/api";
import { curriculumLessons } from "@/lib/polylingue/review";

type Ctx = { params: { curriculumId: string } };

/** A shared course's lessons with their review state. */
export const GET = apiHandler<Ctx>(async (_req, { params }) => {
  await requireAdmin();
  return ok(await curriculumLessons(params.curriculumId));
});
