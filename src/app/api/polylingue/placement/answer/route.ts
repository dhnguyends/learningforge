import { z } from "zod";
import { apiHandler, ok, parseJsonBody, requireSession } from "@/lib/api";
import { checkPlacement } from "@/lib/polylingue/placement-service";

const schema = z.object({ target: z.string().min(2).max(8), base: z.string().min(2).max(8), id: z.number().int().min(0).max(100), answer: z.string().max(300) });

/** Checks one placement answer (right or wrong, with the answer and a one-line explanation). */
export const POST = apiHandler(async (req) => {
  await requireSession();
  const { target, base, id, answer } = await parseJsonBody(req, schema);
  return ok(await checkPlacement(target, base, id, answer));
});
