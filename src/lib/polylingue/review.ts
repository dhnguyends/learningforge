import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { badRequest, notFound } from "@/lib/api";
import { prepareLesson } from "@/lib/polylingue/curriculum";
import { exerciseSchema, lessonContentSchema, type Exercise, type LessonContent } from "@/lib/polylingue/content";
import { ownCourse } from "@/lib/polylingue/service";
import { pregenerateLessonAudio } from "@/lib/polylingue/voices";

/**
 * Content review (admins): learners report problems with an exercise; an
 * exercise reported by HIDE_AFTER different learners is skipped until it is
 * reviewed. Admins preview, edit, regenerate, retire or restore lessons; every
 * change keeps the previous version (ArtifactEdit "lang_lesson").
 */
export const HIDE_AFTER = 3;
export const REPORT_REASONS = ["wrong_answer", "unclear", "audio", "typo", "other"] as const;
export const LESSON_VERSION = "lang_lesson";

// ------------------------------------------------------------ learners

export async function reportExercise(
  userId: string,
  courseId: string,
  lessonId: string,
  input: { index: number; reason: (typeof REPORT_REASONS)[number]; comment?: string },
) {
  const course = await ownCourse(userId, courseId);
  const lesson = await prisma.langLesson.findFirst({
    where: { id: lessonId, curriculumId: course.curriculumId, OR: [{ courseId: null }, { courseId }] },
    select: { id: true, content: true, hiddenExercises: true },
  });
  if (!lesson) throw notFound("Lesson");
  const exercises = (lesson.content as LessonContent | null)?.exercises ?? [];
  if (!exercises[input.index]) throw notFound("Exercise");
  await prisma.langReport.upsert({
    where: { lessonId_exerciseIndex_userId: { lessonId, exerciseIndex: input.index, userId } },
    create: { lessonId, exerciseIndex: input.index, userId, reason: input.reason, comment: input.comment || null },
    update: { reason: input.reason, comment: input.comment || null, resolvedAt: null, resolution: null, createdAt: new Date() },
  });
  const open = await prisma.langReport.count({ where: { lessonId, exerciseIndex: input.index, resolvedAt: null } });
  const hidden = open >= HIDE_AFTER && !lesson.hiddenExercises.includes(input.index);
  if (hidden) await prisma.langLesson.update({ where: { id: lessonId }, data: { hiddenExercises: { push: input.index } } });
  return { reports: open, hidden: hidden || lesson.hiddenExercises.includes(input.index) };
}

// --------------------------------------------------------------- admin

/** Every shared course with its size, learners and what waits for review. */
export async function listCurricula() {
  const [curricula, reports] = await Promise.all([
    prisma.langCurriculum.findMany({
      orderBy: [{ targetLang: "asc" }, { level: "asc" }, { baseLang: "asc" }],
      include: {
        _count: { select: { courses: true, classes: true } },
        lessons: { where: { courseId: null }, select: { status: true, retiredAt: true, audioAt: true, hiddenExercises: true } },
      },
    }),
    prisma.langReport.groupBy({ by: ["lessonId"], where: { resolvedAt: null }, _count: true }),
  ]);
  const lessonCurriculum = new Map(
    (await prisma.langLesson.findMany({ where: { id: { in: reports.map((r) => r.lessonId) } }, select: { id: true, curriculumId: true } })).map((l) => [l.id, l.curriculumId]),
  );
  const openBy = new Map<string, number>();
  for (const r of reports) {
    const c = lessonCurriculum.get(r.lessonId);
    if (c) openBy.set(c, (openBy.get(c) ?? 0) + r._count);
  }
  return curricula.map((c) => ({
    id: c.id,
    targetLang: c.targetLang,
    baseLang: c.baseLang,
    level: c.level,
    status: c.status,
    learners: c._count.courses,
    classes: c._count.classes,
    lessons: c.lessons.length,
    ready: c.lessons.filter((l) => l.status === "READY" && !l.retiredAt).length,
    retired: c.lessons.filter((l) => l.retiredAt).length,
    withAudio: c.lessons.filter((l) => l.audioAt).length,
    hiddenExercises: c.lessons.reduce((n, l) => n + l.hiddenExercises.length, 0),
    openReports: openBy.get(c.id) ?? 0,
  }));
}

/** A shared course's lessons, unit by unit, with their review state. */
export async function curriculumLessons(curriculumId: string) {
  const c = await prisma.langCurriculum.findUnique({ where: { id: curriculumId } });
  if (!c) throw notFound("Course");
  const [lessons, reports] = await Promise.all([
    prisma.langLesson.findMany({
      where: { curriculumId, courseId: null },
      orderBy: { ordinal: "asc" },
      select: { id: true, ordinal: true, unitIndex: true, unitTitle: true, title: true, status: true, retiredAt: true, audioAt: true, editedAt: true, hiddenExercises: true, model: true },
    }),
    prisma.langReport.groupBy({ by: ["lessonId"], where: { resolvedAt: null, lesson: { curriculumId } }, _count: true }),
  ]);
  const reportsBy = new Map(reports.map((r) => [r.lessonId, r._count]));
  const versionCounts = await prisma.artifactEdit.groupBy({ by: ["entityId"], where: { entityType: LESSON_VERSION, entityId: { in: lessons.map((l) => l.id) } }, _count: true });
  const versionsBy = new Map(versionCounts.map((v) => [v.entityId, v._count]));
  return {
    curriculum: { id: c.id, targetLang: c.targetLang, baseLang: c.baseLang, level: c.level, status: c.status },
    lessons: lessons.map((l) => ({
      ...l,
      openReports: reportsBy.get(l.id) ?? 0,
      versions: versionsBy.get(l.id) ?? 0,
    })),
  };
}

/** One lesson for review: its content, open reports per exercise and earlier versions. */
export async function lessonForReview(lessonId: string) {
  const lesson = await prisma.langLesson.findUnique({
    where: { id: lessonId },
    include: { curriculum: { select: { targetLang: true, baseLang: true, level: true } } },
  });
  if (!lesson) throw notFound("Lesson");
  const [reports, versions] = await Promise.all([
    prisma.langReport.findMany({ where: { lessonId }, orderBy: { createdAt: "desc" }, include: { user: { select: { name: true, email: true } } } }),
    prisma.artifactEdit.findMany({
      where: { entityType: LESSON_VERSION, entityId: lessonId },
      orderBy: { version: "desc" },
      select: { version: true, note: true, createdAt: true, editedBy: { select: { name: true, email: true } } },
    }),
  ]);
  return {
    id: lesson.id,
    title: lesson.title,
    unitTitle: lesson.unitTitle,
    focus: lesson.focus,
    status: lesson.status,
    error: lesson.error,
    retiredAt: lesson.retiredAt,
    editedAt: lesson.editedAt,
    audioAt: lesson.audioAt,
    model: lesson.model,
    hiddenExercises: lesson.hiddenExercises,
    curriculum: lesson.curriculum,
    content: lesson.content as LessonContent | null,
    reports: reports.map((r) => ({
      id: r.id,
      index: r.exerciseIndex,
      reason: r.reason,
      comment: r.comment,
      createdAt: r.createdAt,
      resolvedAt: r.resolvedAt,
      resolution: r.resolution,
      by: r.user.name || r.user.email,
    })),
    versions: versions.map((v) => ({ version: v.version, note: v.note, createdAt: v.createdAt, by: v.editedBy.name || v.editedBy.email })),
  };
}

/** Keeps the lesson as it is now, before a change. */
async function snapshot(adminId: string, lessonId: string, note: string) {
  const lesson = await prisma.langLesson.findUniqueOrThrow({ where: { id: lessonId }, select: { title: true, focus: true, content: true, status: true } });
  if (!lesson.content) return;
  const last = await prisma.artifactEdit.findFirst({ where: { entityType: LESSON_VERSION, entityId: lessonId }, orderBy: { version: "desc" }, select: { version: true } });
  await prisma.artifactEdit.create({
    data: {
      entityType: LESSON_VERSION,
      entityId: lessonId,
      version: (last?.version ?? 0) + 1,
      snapshot: { title: lesson.title, focus: lesson.focus, content: lesson.content } as Prisma.JsonObject,
      note,
      editedById: adminId,
    },
  });
}

async function resolveReports(lessonId: string, indexes: number[] | "all", resolution: string) {
  await prisma.langReport.updateMany({
    where: { lessonId, resolvedAt: null, ...(indexes === "all" ? {} : { exerciseIndex: { in: indexes } }) },
    data: { resolvedAt: new Date(), resolution },
  });
  const lesson = await prisma.langLesson.findUniqueOrThrow({ where: { id: lessonId }, select: { hiddenExercises: true } });
  const hidden = indexes === "all" ? [] : lesson.hiddenExercises.filter((i) => !indexes.includes(i));
  await prisma.langLesson.update({ where: { id: lessonId }, data: { hiddenExercises: hidden } });
}

/**
 * Saves an admin's corrections. The exercises stay in the same order and
 * number (answers and reports refer to them by position); the reports of the
 * exercises that changed are resolved and those exercises shown again.
 */
export async function saveLessonEdit(adminId: string, lessonId: string, input: { title?: string; content?: unknown; note?: string }) {
  const lesson = await prisma.langLesson.findUnique({ where: { id: lessonId }, select: { content: true, status: true } });
  if (!lesson) throw notFound("Lesson");
  const before = lesson.content as LessonContent | null;
  if (!before || lesson.status !== "READY") throw badRequest("Only a lesson that is ready can be edited.");
  const parsed = lessonContentSchema.safeParse(input.content);
  if (!parsed.success) throw badRequest(`The lesson is not valid: ${parsed.error.issues[0]?.path.join(".")} ${parsed.error.issues[0]?.message}`);
  const content = parsed.data;
  if (content.exercises.length !== before.exercises.length) throw badRequest("Exercises can be corrected, not added or removed.");
  for (const [i, e] of content.exercises.entries()) {
    if (e.type !== before.exercises[i].type) throw badRequest(`Exercise ${i + 1} must keep its type (${before.exercises[i].type}).`);
    checkExercise(e, i);
  }
  // Same field order on both sides before comparing.
  const same = (a: Exercise, b: Exercise) => JSON.stringify(exerciseSchema.parse(a)) === JSON.stringify(exerciseSchema.parse(b));
  const changed = content.exercises.map((e, i) => (same(e, before.exercises[i]) ? -1 : i)).filter((i) => i >= 0);
  await snapshot(adminId, lessonId, input.note || "Edited");
  await prisma.langLesson.update({
    where: { id: lessonId },
    data: { content: content as unknown as Prisma.JsonObject, editedAt: new Date(), ...(input.title ? { title: input.title } : {}) },
  });
  if (changed.length) await resolveReports(lessonId, changed, "fixed");
  void pregenerateLessonAudio(lessonId).catch(() => undefined);
  return { changed };
}

/** Rules a hand-edited exercise must still follow to be playable. */
export function checkExercise(e: Exercise, i: number) {
  const n = i + 1;
  exerciseSchema.parse(e);
  if (e.type === "choice" || e.type === "listen") {
    if (e.options.length < 2) throw badRequest(`Exercise ${n}: give at least 2 options.`);
    if (!e.options.includes(e.answer)) throw badRequest(`Exercise ${n}: the answer must be one of the options.`);
  }
  if (e.type === "match" && e.pairs.length < 2) throw badRequest(`Exercise ${n}: give at least 2 pairs.`);
  if (e.type === "cloze" && !/\{\{.+?\}\}/.test(e.text)) throw badRequest(`Exercise ${n}: the sentence needs a {{blank}}.`);
  if (["order", "cloze", "translate"].includes(e.type) && !e.answer.trim()) throw badRequest(`Exercise ${n}: the answer is empty.`);
}

/** Writes the lesson again with the AI model (the current version is kept). */
export async function regenerateLesson(adminId: string, lessonId: string) {
  const lesson = await prisma.langLesson.findUnique({ where: { id: lessonId }, select: { status: true } });
  if (!lesson) throw notFound("Lesson");
  if (lesson.status === "GENERATING") throw badRequest("The lesson is being written right now.");
  await snapshot(adminId, lessonId, "Before regenerating");
  await prisma.langLesson.update({ where: { id: lessonId }, data: { status: "QUEUED", content: Prisma.DbNull, error: null, hiddenExercises: [] } });
  await prisma.langReport.updateMany({ where: { lessonId, resolvedAt: null }, data: { resolvedAt: new Date(), resolution: "regenerated" } });
  void prepareLesson(lessonId).catch(() => undefined);
}

/** Retires (or brings back) a lesson: retired lessons are no longer offered. */
export async function setRetired(adminId: string, lessonId: string, retired: boolean) {
  const lesson = await prisma.langLesson.findUnique({ where: { id: lessonId }, select: { id: true } });
  if (!lesson) throw notFound("Lesson");
  await prisma.langLesson.update({ where: { id: lessonId }, data: { retiredAt: retired ? new Date() : null } });
  if (retired) await prisma.langReport.updateMany({ where: { lessonId, resolvedAt: null }, data: { resolvedAt: new Date(), resolution: "retired" } });
}

/** Restores an earlier version (the current one is kept too). */
export async function restoreVersion(adminId: string, lessonId: string, version: number) {
  const v = await prisma.artifactEdit.findUnique({ where: { entityType_entityId_version: { entityType: LESSON_VERSION, entityId: lessonId, version } } });
  if (!v) throw notFound("Version");
  const snap = v.snapshot as { title: string; focus: string; content: LessonContent };
  await snapshot(adminId, lessonId, `Before restoring version ${version}`);
  await prisma.langLesson.update({
    where: { id: lessonId },
    data: { title: snap.title, focus: snap.focus, content: snap.content as unknown as Prisma.JsonObject, status: "READY", error: null, editedAt: new Date(), hiddenExercises: [] },
  });
  await prisma.langReport.updateMany({ where: { lessonId, resolvedAt: null }, data: { resolvedAt: new Date(), resolution: "fixed" } });
}

/** Closes the reports of one exercise without changing it, and shows it again. */
export async function dismissReports(lessonId: string, index: number) {
  if (!(await prisma.langLesson.findUnique({ where: { id: lessonId }, select: { id: true } }))) throw notFound("Lesson");
  await resolveReports(lessonId, [index], "dismissed");
}

/** Open reports, grouped by exercise, most reported first. */
export async function reportQueue() {
  const reports = await prisma.langReport.findMany({
    where: { resolvedAt: null },
    orderBy: { createdAt: "desc" },
    include: { lesson: { select: { id: true, title: true, content: true, hiddenExercises: true, curriculum: { select: { id: true, targetLang: true, level: true } } } } },
  });
  const groups = new Map<string, { lessonId: string; index: number; title: string; curriculum: { id: string; targetLang: string; level: string }; prompt: string; answer: string; hidden: boolean; reasons: Record<string, number>; comments: string[]; count: number; latest: Date }>();
  for (const r of reports) {
    const key = `${r.lessonId}:${r.exerciseIndex}`;
    const ex = (r.lesson.content as LessonContent | null)?.exercises?.[r.exerciseIndex];
    const g = groups.get(key) ?? {
      lessonId: r.lessonId,
      index: r.exerciseIndex,
      title: r.lesson.title,
      curriculum: r.lesson.curriculum,
      prompt: ex?.prompt ?? "",
      answer: ex?.answer ?? "",
      hidden: r.lesson.hiddenExercises.includes(r.exerciseIndex),
      reasons: {},
      comments: [],
      count: 0,
      latest: r.createdAt,
    };
    g.count++;
    g.reasons[r.reason] = (g.reasons[r.reason] ?? 0) + 1;
    if (r.comment) g.comments.push(r.comment);
    groups.set(key, g);
  }
  return [...groups.values()].sort((a, b) => b.count - a.count || b.latest.getTime() - a.latest.getTime());
}
