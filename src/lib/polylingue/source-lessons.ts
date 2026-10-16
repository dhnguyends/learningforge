import { prisma } from "@/lib/db";
import { ApiError, notFound, rateLimited } from "@/lib/api";
import { rateLimit } from "@/lib/rate-limit";
import { detectLanguage, normalizeLanguage } from "@/lib/language";
import { loadSourceReader } from "@/lib/speech/reader";
import type { TranslationStatus } from "@/lib/pipelines/translate";
import type { Cefr } from "@/lib/polylingue/levels";
import { ownCourse } from "@/lib/polylingue/service";
import { prepareLesson } from "@/lib/polylingue/curriculum";

/**
 * Learn from your own material: a LearningForge source (transcript or
 * document) that exists in the language being learned — originally, or through
 * its translation — becomes a personal lesson at the learner's level, part by
 * part. Its words go into review when the lesson is finished.
 */

/** Characters of source text per lesson, by level (shorter at lower levels). */
const PART_CHARS: Record<Cefr, number> = { A1: 900, A2: 1200, B1: 1800, B2: 2400, C1: 3000, C2: 3500 };

async function sourceLanguage(source: { id: string; language: string | null }): Promise<string | null> {
  const known = normalizeLanguage(source.language);
  if (known) return known;
  const sample = await prisma.extractedChunk.findMany({ where: { sourceId: source.id, translationOfId: null }, orderBy: { ordinal: "asc" }, take: 8, select: { content: true } });
  return detectLanguage(sample.map((c) => c.content).join(" "));
}

/** The learner's READY sources available in the course's target language. */
export async function eligibleSources(userId: string, courseId: string) {
  const course = await ownCourse(userId, courseId);
  const sources = await prisma.source.findMany({
    where: { status: "READY", studySet: { workspace: { members: { some: { userId } } } } },
    select: { id: true, title: true, type: true, language: true, metadata: true, studySet: { select: { id: true, title: true } } },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  const out: { id: string; title: string; type: string; studySetId: string; studySetTitle: string; via: "original" | "translation" }[] = [];
  for (const s of sources) {
    const meta = (s.metadata as { translation?: TranslationStatus; readingTranslations?: Record<string, TranslationStatus> } | null) ?? {};
    const translated =
      (meta.translation?.status === "done" && meta.translation.to === course.targetLang) || meta.readingTranslations?.[course.targetLang]?.status === "done";
    const original = (await sourceLanguage(s)) === course.targetLang;
    if (original || translated) {
      out.push({ id: s.id, title: s.title, type: s.type, studySetId: s.studySet.id, studySetTitle: s.studySet.title, via: original ? "original" : "translation" });
    }
  }
  return out;
}

/** The source's text in the target language, split into lesson-sized parts. */
async function sourceParts(sourceId: string, targetLang: string, level: Cefr): Promise<string[]> {
  const reader = await loadSourceReader(sourceId);
  const texts = reader.items.map((i) => i.text[targetLang]?.trim()).filter((t): t is string => Boolean(t));
  const size = PART_CHARS[level];
  const parts: string[] = [];
  let current = "";
  for (const t of texts) {
    if (current && current.length + t.length > size) {
      parts.push(current);
      current = "";
    }
    current = current ? `${current} ${t}` : t;
  }
  if (current.trim().length >= 80) parts.push(current);
  return parts.map((p) => p.slice(0, size + 400));
}

/** How many lesson parts a source offers (for the picker). */
export async function sourceLessonParts(userId: string, courseId: string, sourceId: string) {
  const course = await ownCourse(userId, courseId);
  if (!(await eligibleSources(userId, courseId)).some((s) => s.id === sourceId)) throw notFound("Source");
  const parts = await sourceParts(sourceId, course.targetLang, course.level as Cefr);
  const made = await prisma.langLesson.findMany({ where: { courseId, sourceId }, select: { title: true } });
  return { parts: parts.length, preview: parts.map((p) => p.slice(0, 140)), made: made.map((m) => m.title) };
}

/** Creates the personal lesson for one part of a source; it is written in the background. */
export async function createSourceLesson(userId: string, courseId: string, input: { sourceId: string; part: number }) {
  const course = await ownCourse(userId, courseId);
  const curriculum = await prisma.langCurriculum.findUniqueOrThrow({ where: { id: course.curriculumId } });
  if (curriculum.status !== "READY") throw new ApiError(409, "Your course is still being written", "not_ready");
  const source = (await eligibleSources(userId, courseId)).find((s) => s.id === input.sourceId);
  if (!source) throw notFound("Source");
  const parts = await sourceParts(source.id, course.targetLang, course.level as Cefr);
  const excerpt = parts[input.part];
  if (!excerpt) throw new ApiError(400, "This part does not exist", "bad_request");
  const limit = rateLimit(`polylingue-source-lesson:${userId}`, 20);
  if (!limit.allowed) throw rateLimited(limit.retryAfterSec);
  const title = parts.length > 1 ? `${source.title} · part ${input.part + 1} of ${parts.length}` : source.title;
  const lesson = await prisma.langLesson.create({
    data: {
      curriculumId: course.curriculumId,
      courseId: course.id,
      sourceId: source.id,
      unitTitle: source.title.slice(0, 200),
      title: title.slice(0, 200),
      focus: `Words and ideas from "${source.title}" (${source.studySetTitle})`.slice(0, 300),
      sourceExcerpt: excerpt,
    },
  });
  void prepareLesson(lesson.id).catch(() => undefined);
  return { id: lesson.id };
}
