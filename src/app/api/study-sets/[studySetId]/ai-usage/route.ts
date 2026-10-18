import { apiHandler, ok, requireSession } from "@/lib/api";
import { assertStudySetAccess } from "@/lib/access";
import { courseAiCost } from "@/lib/ai/usage";

type Ctx = { params: { studySetId: string } };

/** What this course's AI calls cost so far: tokens, Azure characters, estimated Z.ai credits. */
export const GET = apiHandler<Ctx>(async (_req, { params }) => {
  const session = await requireSession();
  await assertStudySetAccess(session.user.id, params.studySetId);
  return ok(await courseAiCost(params.studySetId));
});
