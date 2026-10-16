import { z } from "zod";
import { apiHandler, ok, parseJsonBody, requireSession } from "@/lib/api";
import { markBadgesSeen } from "@/lib/polylingue/habits-service";

const schema = z.object({ ids: z.array(z.string().min(1).max(64)).min(1).max(50) });

/** The learner was shown these badges. */
export const POST = apiHandler(async (req) => {
  const session = await requireSession();
  const { ids } = await parseJsonBody(req, schema);
  await markBadgesSeen(session.user.id, ids);
  return ok({ ok: true });
});
