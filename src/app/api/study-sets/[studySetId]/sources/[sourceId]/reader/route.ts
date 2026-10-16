import { prisma } from "@/lib/db";
import { apiHandler, ok, requireSession, notFound } from "@/lib/api";
import { assertStudySetAccess } from "@/lib/access";
import { loadSourceReader } from "@/lib/speech/reader";
import { voicesForLanguages } from "@/lib/speech/tts";
import { editedLanguages } from "@/lib/documents/source-text";

type Ctx = { params: { studySetId: string; sourceId: string } };

/** The source's text in its original language and every language it was translated into, with the voice for each. */
export const GET = apiHandler<Ctx>(async (_req, { params }) => {
  const session = await requireSession();
  const studySet = await assertStudySetAccess(session.user.id, params.studySetId, "read");
  const source = await prisma.source.findFirst({ where: { id: params.sourceId, studySetId: studySet.id }, select: { id: true } });
  if (!source) throw notFound("Source");
  const reader = await loadSourceReader(source.id);
  const edited = await editedLanguages(reader.items.map((i) => i.id));
  const items = reader.items.map((i) => (edited.has(i.id) ? { ...i, edited: edited.get(i.id) } : i));
  // Which of its languages can be read aloud, and by which voice.
  return ok({ ...reader, items, voices: await voicesForLanguages(reader.languages) });
});
