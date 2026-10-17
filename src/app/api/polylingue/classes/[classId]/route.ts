import { z } from "zod";
import { apiHandler, ok, parseJsonBody, requireSession } from "@/lib/api";
import { leaveClass, setClassLeague } from "@/lib/polylingue/classes-service";

type Ctx = { params: { classId: string } };

const schema = z.object({ inLeague: z.boolean(), nickname: z.string().trim().min(2).max(24).optional() });

/** Joins or leaves the class league (opt-in, under a nickname). */
export const PATCH = apiHandler<Ctx>(async (req, { params }) => {
  const session = await requireSession();
  const m = await setClassLeague(session.user.id, params.classId, await parseJsonBody(req, schema));
  return ok({ inLeague: m.inLeague, nickname: m.nickname });
});

/** Leaves the class (the course and its progress stay). */
export const DELETE = apiHandler<Ctx>(async (_req, { params }) => {
  const session = await requireSession();
  await leaveClass(session.user.id, params.classId);
  return ok({ ok: true });
});
