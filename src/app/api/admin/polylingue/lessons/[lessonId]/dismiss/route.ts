import { z } from "zod";
import { apiHandler, ok, parseJsonBody, requireAdmin } from "@/lib/api";
import { audit } from "@/lib/audit";
import { dismissReports } from "@/lib/polylingue/review";

type Ctx = { params: { lessonId: string } };

/** Closes an exercise's reports without changing it, and shows it again. */
export const POST = apiHandler<Ctx>(async (req, { params }) => {
  const session = await requireAdmin();
  const { index } = await parseJsonBody(req, z.object({ index: z.number().int().min(0).max(50) }));
  await dismissReports(params.lessonId, index);
  await audit({ userId: session.user.id, action: "polylingue.reports_dismiss", entityType: "lang_lesson", entityId: params.lessonId, metadata: { index } });
  return ok({ ok: true });
});
