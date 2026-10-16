import { apiHandler, requireSession, badRequest } from "@/lib/api";
import { listeningSentence } from "@/lib/polylingue/practice-service";
import { speechClipResponse } from "@/lib/polylingue/audio";

type Ctx = { params: { courseId: string; practiceId: string } };

/**
 * Listening practice audio: one dictation or passage sentence, by index. The
 * text itself is never sent before the learner answers.
 *
 *   GET …/audio?part=dictation&index=0
 */
export const GET = apiHandler<Ctx>(async (req, { params }) => {
  const session = await requireSession();
  const url = new URL(req.url);
  const part = url.searchParams.get("part");
  const index = Number(url.searchParams.get("index"));
  if (part !== "dictation" && part !== "passage") throw badRequest("part must be dictation or passage");
  if (!Number.isInteger(index) || index < 0) throw badRequest("index must be a non-negative integer");
  const { lang, text } = await listeningSentence(session.user.id, params.courseId, params.practiceId, part, index);
  return speechClipResponse(lang, text, session.user.id);
});
