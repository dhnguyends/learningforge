import { apiHandler, ok, requireSession } from "@/lib/api";
import { assertStudySetAccess } from "@/lib/access";
import { getIndexingReadiness } from "@/lib/retrieval/readiness";

type Ctx = { params: { studySetId: string } };

/** Whether every source is imported (vectorized + indexed), which generation waits for. */
export const GET = apiHandler<Ctx>(async (_req, { params }) => {
  const session = await requireSession();
  const studySet = await assertStudySetAccess(session.user.id, params.studySetId);
  return ok(await getIndexingReadiness(studySet.id));
});
