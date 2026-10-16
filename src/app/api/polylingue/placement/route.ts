import { apiHandler, ok, requireSession, badRequest } from "@/lib/api";
import { BASE_LANGUAGES, TARGET_LANGUAGES } from "@/lib/polylingue/levels";
import { placementBank } from "@/lib/polylingue/placement-service";

/** Placement test questions (no answers) for a language: GET /api/polylingue/placement?target=es&base=en */
export const GET = apiHandler(async (req) => {
  await requireSession();
  const url = new URL(req.url);
  const target = url.searchParams.get("target") ?? "";
  const base = url.searchParams.get("base") ?? "";
  if (!TARGET_LANGUAGES.some((l) => l.code === target)) throw badRequest("Unsupported language");
  if (!BASE_LANGUAGES.some((l) => l.code === base) || base === target) throw badRequest("Choose another explanation language");
  return ok(await placementBank(target, base));
});
