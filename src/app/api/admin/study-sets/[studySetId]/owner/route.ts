import { z } from "zod";
import { apiHandler, ok, parseJsonBody, requireAdmin } from "@/lib/api";
import { transferStudySet } from "@/lib/study-set-transfer";

type Ctx = { params: { studySetId: string } };

const bodySchema = z.object({ userId: z.string().min(1) });

/** Give a study set to another account (with its files and learning history). */
export const PUT = apiHandler<Ctx>(async (req, { params }) => {
  const admin = await requireAdmin();
  const { userId } = await parseJsonBody(req, bodySchema);
  const result = await transferStudySet({ studySetId: params.studySetId, toUserId: userId, actorId: admin.user.id });
  return ok(result);
});
