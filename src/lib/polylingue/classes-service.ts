import type { CefrLevel, LangClass, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { ApiError, badRequest, notFound } from "@/lib/api";
import { getGenerator } from "@/lib/ai";
import { ensureCurriculum } from "@/lib/polylingue/curriculum";
import { curriculumBaseLang, isImmersion, languageEnglishName, type Cefr } from "@/lib/polylingue/levels";
import { dayKey } from "@/lib/polylingue/progress";
import { addDays, daysBetween, leagueCode, normalizeLeagueCode, rankLeague, visibleStreak, weekDays, weekStart } from "@/lib/polylingue/habits";
import { skillAccuracy } from "@/lib/polylingue/habits-service";
import { activitiesSchema, assignmentState, behindReasons, mockActivities, toCsv, type AssignmentState, type ClassActivities } from "@/lib/polylingue/classes";

/**
 * PolyLingue for Schools. A teacher's class follows one shared course
 * (language, level, explanation language); students join with a code and
 * their course in that language follows the class. Teachers see only their
 * own classes; students see their class, its assignments and, if they opt
 * in, the class league.
 */

const MAX_CLASSES = 30;
const MAX_STUDENTS = 60;

// ------------------------------------------------------------- teacher

export async function ownClass(teacherId: string, classId: string): Promise<LangClass> {
  const c = await prisma.langClass.findUnique({ where: { id: classId } });
  if (!c || c.teacherId !== teacherId) throw notFound("Class");
  return c;
}

async function uniqueCode(): Promise<string> {
  for (let i = 0; i < 6; i++) {
    const code = leagueCode();
    const [cls, league] = await Promise.all([prisma.langClass.findUnique({ where: { code } }), prisma.langLeague.findUnique({ where: { code } })]);
    if (!cls && !league) return code;
  }
  throw new ApiError(500, "Could not make a class code, try again", "code_collision");
}

export async function createClass(
  teacherId: string,
  input: { name: string; targetLang: string; baseLang: string; level: CefrLevel; weeklyMinutes: number },
) {
  if (input.targetLang === input.baseLang && !isImmersion(input.level)) {
    throw badRequest("The explanation language must differ from the language taught (below B2).");
  }
  if ((await prisma.langClass.count({ where: { teacherId } })) >= MAX_CLASSES) throw badRequest(`You can run ${MAX_CLASSES} classes at most.`);
  const curriculum = await ensureCurriculum(input.targetLang, input.baseLang, input.level);
  return prisma.langClass.create({
    data: {
      teacherId,
      name: input.name,
      targetLang: input.targetLang,
      baseLang: curriculumBaseLang(input.targetLang, input.baseLang, input.level as Cefr),
      level: input.level,
      curriculumId: curriculum.id,
      weeklyMinutes: input.weeklyMinutes,
      code: await uniqueCode(),
    },
  });
}

export async function listTeacherClasses(teacherId: string) {
  const classes = await prisma.langClass.findMany({
    where: { teacherId },
    orderBy: { createdAt: "desc" },
    include: { curriculum: { select: { status: true } }, _count: { select: { members: true, assignments: true } } },
  });
  return classes.map((c) => ({
    id: c.id,
    name: c.name,
    targetLang: c.targetLang,
    baseLang: c.baseLang,
    level: c.level,
    code: c.code,
    weeklyMinutes: c.weeklyMinutes,
    students: c._count.members,
    assignments: c._count.assignments,
    courseStatus: c.curriculum.status,
  }));
}

export async function updateClass(teacherId: string, classId: string, input: { name?: string; weeklyMinutes?: number; newCode?: boolean }) {
  await ownClass(teacherId, classId);
  return prisma.langClass.update({
    where: { id: classId },
    data: {
      ...(input.name ? { name: input.name } : {}),
      ...(input.weeklyMinutes !== undefined ? { weeklyMinutes: input.weeklyMinutes } : {}),
      ...(input.newCode ? { code: await uniqueCode() } : {}),
    },
  });
}

export async function deleteClass(teacherId: string, classId: string) {
  await ownClass(teacherId, classId);
  await prisma.langClass.delete({ where: { id: classId } });
}

export async function removeStudent(teacherId: string, classId: string, userId: string) {
  await ownClass(teacherId, classId);
  const removed = await prisma.langClassMember.deleteMany({ where: { classId, userId } });
  if (removed.count === 0) throw notFound("Student");
}

/** The class course: its units and lessons, to choose what to assign. */
export async function classOutline(teacherId: string, classId: string) {
  const c = await ownClass(teacherId, classId);
  return outlineOf(c.curriculumId);
}

async function outlineOf(curriculumId: string) {
  const curriculum = await prisma.langCurriculum.findUniqueOrThrow({ where: { id: curriculumId }, select: { status: true, error: true, outline: true } });
  const lessons = await prisma.langLesson.findMany({
    where: { curriculumId, courseId: null, retiredAt: null },
    orderBy: { ordinal: "asc" },
    select: { id: true, unitIndex: true, title: true, focus: true },
  });
  const outline = (curriculum.outline as { units?: { title: string; theme: string; grammar: string }[] }) ?? {};
  return {
    status: curriculum.status,
    error: curriculum.error,
    units: (outline.units ?? []).map((u, unitIndex) => ({
      index: unitIndex,
      title: u.title,
      grammar: u.grammar,
      lessons: lessons.filter((l) => l.unitIndex === unitIndex).map((l) => ({ id: l.id, title: l.title, focus: l.focus })),
    })),
  };
}

export async function createAssignment(teacherId: string, classId: string, input: { unitIndex?: number; lessonId?: string; dueAt: Date; note?: string }) {
  const c = await ownClass(teacherId, classId);
  const outline = await outlineOf(c.curriculumId);
  let title: string;
  if (input.lessonId) {
    const unit = outline.units.find((u) => u.lessons.some((l) => l.id === input.lessonId));
    const lesson = unit?.lessons.find((l) => l.id === input.lessonId);
    if (!unit || !lesson) throw badRequest("This lesson is not in the class course.");
    title = `${lesson.title} (unit ${unit.index + 1})`;
  } else if (input.unitIndex !== undefined) {
    const unit = outline.units[input.unitIndex];
    if (!unit || unit.lessons.length === 0) throw badRequest("This unit is not in the class course.");
    title = `Unit ${unit.index + 1}: ${unit.title}`;
  } else {
    throw badRequest("Choose a unit or a lesson to assign.");
  }
  if (input.dueAt.getTime() < Date.now() - 86_400_000) throw badRequest("The due date is in the past.");
  return prisma.langAssignment.create({
    data: { classId, title, unitIndex: input.lessonId ? null : input.unitIndex, lessonId: input.lessonId ?? null, dueAt: input.dueAt, note: input.note || null },
  });
}

export async function deleteAssignment(teacherId: string, classId: string, assignmentId: string) {
  await ownClass(teacherId, classId);
  const removed = await prisma.langAssignment.deleteMany({ where: { id: assignmentId, classId } });
  if (removed.count === 0) throw notFound("Assignment");
}

/** Lesson ids of each assignment. */
async function assignedLessons(curriculumId: string, assignments: { id: string; unitIndex: number | null; lessonId: string | null }[]) {
  const units = [...new Set(assignments.filter((a) => a.unitIndex !== null).map((a) => a.unitIndex!))];
  const lessons = units.length
    ? await prisma.langLesson.findMany({ where: { curriculumId, courseId: null, retiredAt: null, unitIndex: { in: units } }, select: { id: true, unitIndex: true }, orderBy: { ordinal: "asc" } })
    : [];
  return new Map(assignments.map((a) => [a.id, a.lessonId ? [a.lessonId] : lessons.filter((l) => l.unitIndex === a.unitIndex).map((l) => l.id)]));
}

/** Each member's course in the class language (null when they have none). */
async function memberCourses(c: LangClass, userIds: string[]) {
  const courses = await prisma.languageCourse.findMany({ where: { userId: { in: userIds }, targetLang: c.targetLang } });
  return new Map(courses.map((x) => [x.userId, x]));
}

/**
 * The class dashboard: per student, activity (active days, minutes, streak,
 * XP), assignments done, accuracy per skill and why they fall behind; per
 * assignment, how many finished.
 */
export async function classDashboard(teacherId: string, classId: string, now = new Date()) {
  const c = await ownClass(teacherId, classId);
  const [members, assignments, outline] = await Promise.all([
    prisma.langClassMember.findMany({ where: { classId }, include: { user: { select: { id: true, name: true, email: true } } }, orderBy: { joinedAt: "asc" } }),
    prisma.langAssignment.findMany({ where: { classId }, orderBy: { dueAt: "asc" } }),
    outlineOf(c.curriculumId),
  ]);
  const lessonsOf = await assignedLessons(c.curriculumId, assignments);
  const courses = await memberCourses(c, members.map((m) => m.userId));
  const courseIds = [...courses.values()].map((x) => x.id);
  const since = addDays(now.toISOString().slice(0, 10), -30);
  const [activity, progress, attempts] = await Promise.all([
    prisma.langDailyActivity.findMany({ where: { courseId: { in: courseIds }, day: { gte: since } } }),
    prisma.langLessonProgress.findMany({ where: { courseId: { in: courseIds }, completedAt: { not: null } }, select: { courseId: true, lessonId: true, completedAt: true } }),
    prisma.langExerciseAttempt.groupBy({ by: ["courseId", "type", "verdict"], where: { courseId: { in: courseIds } }, _count: true }),
  ]);

  const students = members.map((m) => {
    const course = courses.get(m.userId) ?? null;
    const today = dayKey(now, course?.timeZone ?? "UTC");
    const last7 = new Set(Array.from({ length: 7 }, (_, i) => addDays(today, -i)));
    const last28 = new Set(Array.from({ length: 28 }, (_, i) => addDays(today, -i)));
    const days = course ? activity.filter((a) => a.courseId === course.id) : [];
    const minutes7 = Math.round(days.filter((d) => last7.has(d.day)).reduce((n, d) => n + d.seconds, 0) / 60);
    const done = new Map(progress.filter((p) => p.courseId === course?.id).map((p) => [p.lessonId, p.completedAt!]));
    const states = assignments.map((a) => assignmentState(lessonsOf.get(a.id) ?? [], done, a.dueAt, now));
    const overdue = states.filter((s) => s.state === "overdue").length;
    const inactiveDays = course?.lastActiveDay ? Math.max(0, daysBetween(course.lastActiveDay, today)) : null;
    return {
      userId: m.userId,
      name: m.user.name || m.user.email,
      email: m.user.email,
      joinedAt: m.joinedAt,
      level: course?.level ?? null,
      onClassCourse: course?.curriculumId === c.curriculumId,
      lastActiveDay: course?.lastActiveDay ?? null,
      inactiveDays,
      activeDays7: days.filter((d) => last7.has(d.day) && d.xp > 0).length,
      activeDays28: days.filter((d) => last28.has(d.day) && d.xp > 0).length,
      minutes7,
      xp7: days.filter((d) => last7.has(d.day)).reduce((n, d) => n + d.xp, 0),
      xp: course?.xp ?? 0,
      streak: course ? visibleStreak(course.lastActiveDay, today, course.streak, course.streakFreezes) : 0,
      assignmentsDone: states.filter((s) => s.state === "done" || s.state === "late").length,
      overdue,
      skills: skillAccuracy(attempts.filter((a) => a.courseId === course?.id)),
      behind: behindReasons({ inactiveDays, minutes7, weeklyMinutes: c.weeklyMinutes, overdue }),
    };
  });

  return {
    class: {
      id: c.id,
      name: c.name,
      targetLang: c.targetLang,
      baseLang: c.baseLang,
      level: c.level,
      code: c.code,
      weeklyMinutes: c.weeklyMinutes,
      courseStatus: outline.status,
    },
    students,
    assignments: assignments.map((a, i) => {
      const finished = members.filter((m) => {
        const course = courses.get(m.userId);
        const done = new Map(progress.filter((p) => p.courseId === course?.id).map((p) => [p.lessonId, p.completedAt!]));
        const s = assignmentState(lessonsOf.get(a.id) ?? [], done, a.dueAt, now).state;
        return s === "done" || s === "late";
      }).length;
      return { id: a.id, title: a.title, note: a.note, dueAt: a.dueAt, lessons: (lessonsOf.get(a.id) ?? []).length, finished, of: members.length, order: i };
    }),
  };
}

/**
 * What the class finds hard: the words its students forget most, the
 * exercises they miss most, and the grammar points (units) with the lowest
 * accuracy; and the suggested in-class activities, if made.
 */
export async function classDifficulties(teacherId: string, classId: string) {
  const c = await ownClass(teacherId, classId);
  const members = await prisma.langClassMember.findMany({ where: { classId }, select: { userId: true } });
  const courses = [...(await memberCourses(c, members.map((m) => m.userId))).values()].filter((x) => x.curriculumId === c.curriculumId);
  const courseIds = courses.map((x) => x.id);
  const [cards, attempts, lessons, curriculum] = await Promise.all([
    prisma.langCard.groupBy({
      by: ["term", "translation"],
      where: { courseId: { in: courseIds }, lapses: { gt: 0 } },
      _sum: { lapses: true },
      _count: true,
      orderBy: { _sum: { lapses: "desc" } },
      take: 15,
    }),
    prisma.langExerciseAttempt.groupBy({ by: ["lessonId", "exerciseIndex", "verdict"], where: { courseId: { in: courseIds } }, _count: true }),
    prisma.langLesson.findMany({ where: { curriculumId: c.curriculumId, courseId: null }, select: { id: true, title: true, unitIndex: true, ordinal: true, content: true } }),
    prisma.langCurriculum.findUniqueOrThrow({ where: { id: c.curriculumId }, select: { outline: true } }),
  ]);
  const units = ((curriculum.outline as { units?: { title: string; grammar: string }[] }) ?? {}).units ?? [];
  const lessonById = new Map(lessons.map((l) => [l.id, l]));

  const byExercise = new Map<string, { lessonId: string; index: number; wrong: number; total: number }>();
  const byUnit = new Map<number, { points: number; total: number }>();
  for (const a of attempts) {
    const lesson = lessonById.get(a.lessonId);
    if (!lesson) continue; // personal lessons and other courses are left out
    const key = `${a.lessonId}:${a.exerciseIndex}`;
    const e = byExercise.get(key) ?? { lessonId: a.lessonId, index: a.exerciseIndex, wrong: 0, total: 0 };
    e.total += a._count;
    if (a.verdict === "wrong") e.wrong += a._count;
    byExercise.set(key, e);
    if (lesson.unitIndex !== null) {
      const u = byUnit.get(lesson.unitIndex) ?? { points: 0, total: 0 };
      u.points += a._count * (a.verdict === "correct" ? 1 : a.verdict === "almost" ? 0.5 : 0);
      u.total += a._count;
      byUnit.set(lesson.unitIndex, u);
    }
  }
  const exercises = [...byExercise.values()]
    .filter((e) => e.wrong > 0)
    .sort((a, b) => b.wrong / b.total - a.wrong / a.total || b.wrong - a.wrong || (lessonById.get(a.lessonId)!.ordinal ?? 0) - (lessonById.get(b.lessonId)!.ordinal ?? 0) || a.index - b.index)
    .slice(0, 10)
    .map((e) => {
      const lesson = lessonById.get(e.lessonId)!;
      const ex = (lesson.content as { exercises?: { type: string; prompt: string; answer: string }[] } | null)?.exercises?.[e.index];
      return { lesson: lesson.title, prompt: ex?.prompt ?? "", answer: ex?.answer ?? "", type: ex?.type ?? "", wrongRate: Math.round((e.wrong / e.total) * 100), answers: e.total };
    });
  const grammar = [...byUnit.entries()]
    .map(([index, u]) => ({ unit: index + 1, title: units[index]?.title ?? "", grammar: units[index]?.grammar ?? "", accuracy: Math.round((u.points / u.total) * 100), answers: u.total }))
    .sort((a, b) => a.accuracy - b.accuracy)
    .slice(0, 5);
  return {
    students: courses.length,
    words: cards.map((w) => ({ term: w.term, translation: w.translation, lapses: w._sum.lapses ?? 0, learners: w._count })),
    exercises,
    grammar,
    activities: (c.activities as ClassActivities | null)?.activities ?? null,
    activitiesAt: c.activitiesAt,
  };
}

/** In-class activities written by the AI model from the class's difficulties (kept on the class). */
export async function suggestActivities(teacherId: string, classId: string) {
  const c = await ownClass(teacherId, classId);
  const d = await classDifficulties(teacherId, classId);
  const T = languageEnglishName(c.targetLang);
  const words = d.words.map((w) => w.term);
  const grammar = d.grammar.map((g) => g.grammar).filter(Boolean);
  const result = await (await getGenerator()).generate({
    system:
      `You are an experienced ${T} teacher preparing a CEFR ${c.level} class. Suggest 3 to 5 short in-class activities (role-play, speaking, grammar, vocabulary, ` +
      `games, listening or writing) that work on the difficulties given. Write titles and instructions in ${languageEnglishName(c.baseLang)}, with any example ` +
      `phrases in ${T}. Each activity: "title", "kind", "minutes" (5–60), "targets" (the difficulty it works on) and "instructions" (how to run it, step by step). ` +
      "Return ONLY one JSON object.",
    user:
      `Words the students forget most: ${words.slice(0, 12).join(", ") || "(none yet)"}.\n` +
      `Grammar with the lowest accuracy: ${d.grammar.map((g) => `${g.grammar} (${g.accuracy}%)`).join("; ") || "(none yet)"}.\n` +
      `Exercises missed most: ${d.exercises.slice(0, 6).map((e) => `"${e.prompt}" → ${e.answer} (${e.wrongRate}% wrong)`).join("; ") || "(none yet)"}.`,
    schema: activitiesSchema,
    temperature: 0.6,
    maxTokens: 3000,
    mock: () => mockActivities(words, grammar),
  });
  await prisma.langClass.update({ where: { id: classId }, data: { activities: result.data as unknown as Prisma.JsonObject, activitiesAt: new Date() } });
  return result.data;
}

/** Students and their activity, as a spreadsheet. */
export async function classCsv(teacherId: string, classId: string): Promise<{ filename: string; csv: string }> {
  const d = await classDashboard(teacherId, classId);
  const skillNames = d.students[0]?.skills.map((s) => s.name) ?? ["Lessons", "Reading", "Listening", "Writing", "Speaking", "Weak words"];
  const csv = toCsv(
    [
      "Student",
      "E-mail",
      "Level",
      "Last active",
      "Active days (7)",
      "Active days (28)",
      "Minutes (7 days)",
      "XP (7 days)",
      "XP",
      "Streak",
      `Assignments done (of ${d.assignments.length})`,
      "Overdue",
      ...skillNames.map((n) => `${n} accuracy %`),
      "Falling behind",
    ],
    d.students.map((s) => [
      s.name,
      s.email,
      s.level,
      s.lastActiveDay,
      s.activeDays7,
      s.activeDays28,
      s.minutes7,
      s.xp7,
      s.xp,
      s.streak,
      s.assignmentsDone,
      s.overdue,
      ...s.skills.map((k) => k.accuracy),
      s.behind.join("; "),
    ]),
  );
  const safe = d.class.name.replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "").slice(0, 40) || "class";
  return { filename: `${safe}-${new Date().toISOString().slice(0, 10)}.csv`, csv };
}

// ------------------------------------------------------------- student

/** What joining with a code means, shown before the student confirms. */
export async function previewJoin(userId: string, rawCode: string) {
  const code = normalizeLeagueCode(rawCode);
  if (!code) throw badRequest("A class code looks like K7Q-2MX.");
  const c = await prisma.langClass.findUnique({ where: { code }, include: { teacher: { select: { name: true } }, _count: { select: { members: true } } } });
  if (!c) throw notFound("Class");
  const course = await prisma.languageCourse.findUnique({ where: { userId_targetLang: { userId, targetLang: c.targetLang } } });
  return {
    name: c.name,
    teacher: c.teacher.name ?? "Your teacher",
    targetLang: c.targetLang,
    baseLang: c.baseLang,
    level: c.level,
    students: c._count.members,
    alreadyMember: Boolean(await prisma.langClassMember.findUnique({ where: { classId_userId: { classId: c.id, userId } } })),
    // The student's course in that language moves to the class's level and explanation language.
    currentCourse: course ? { level: course.level, baseLang: course.baseLang, changes: course.curriculumId !== c.curriculumId } : null,
  };
}

export async function joinClass(userId: string, input: { code: string; timeZone: string }) {
  const code = normalizeLeagueCode(input.code);
  if (!code) throw badRequest("A class code looks like K7Q-2MX.");
  const c = await prisma.langClass.findUnique({ where: { code }, include: { _count: { select: { members: true } } } });
  if (!c) throw notFound("Class");
  if (c.teacherId === userId) throw badRequest("This is your own class.");
  const existing = await prisma.langClassMember.findUnique({ where: { classId_userId: { classId: c.id, userId } } });
  if (!existing && c._count.members >= MAX_STUDENTS) throw badRequest(`This class is full (${MAX_STUDENTS} students).`);
  // The course in the class language follows the class (its XP, words and streak are kept).
  const course = await prisma.languageCourse.upsert({
    where: { userId_targetLang: { userId, targetLang: c.targetLang } },
    create: { userId, targetLang: c.targetLang, baseLang: c.baseLang, level: c.level, curriculumId: c.curriculumId, timeZone: input.timeZone, dailyGoalMinutes: 10 },
    update: { level: c.level, baseLang: c.baseLang, curriculumId: c.curriculumId },
  });
  if (!existing) await prisma.langClassMember.create({ data: { classId: c.id, userId } });
  return { classId: c.id, courseId: course.id };
}

export async function leaveClass(userId: string, classId: string) {
  const removed = await prisma.langClassMember.deleteMany({ where: { classId, userId } });
  if (removed.count === 0) throw notFound("Class");
}

export async function setClassLeague(userId: string, classId: string, input: { inLeague: boolean; nickname?: string }) {
  const m = await prisma.langClassMember.findUnique({ where: { classId_userId: { classId, userId } } });
  if (!m) throw notFound("Class");
  if (input.inLeague && !(input.nickname ?? m.nickname)) throw badRequest("Choose a nickname for the class league.");
  return prisma.langClassMember.update({ where: { id: m.id }, data: { inLeague: input.inLeague, ...(input.nickname ? { nickname: input.nickname } : {}) } });
}

/**
 * The student's classes: teacher, assignments with the student's own state
 * and the next lesson to do, and the class league (opted-in classmates only).
 */
export async function myClasses(userId: string, now = new Date()) {
  const memberships = await prisma.langClassMember.findMany({
    where: { userId },
    orderBy: { joinedAt: "asc" },
    include: { class: { include: { teacher: { select: { name: true } }, assignments: { orderBy: { dueAt: "asc" } } } } },
  });
  const monday = weekStart(now.toISOString().slice(0, 10));
  return Promise.all(
    memberships.map(async (m) => {
      const c = m.class;
      const course = await prisma.languageCourse.findUnique({ where: { userId_targetLang: { userId, targetLang: c.targetLang } } });
      const lessonsOf = await assignedLessons(c.curriculumId, c.assignments);
      const progress = course
        ? await prisma.langLessonProgress.findMany({ where: { courseId: course.id, completedAt: { not: null } }, select: { lessonId: true, completedAt: true } })
        : [];
      const done = new Map(progress.map((p) => [p.lessonId, p.completedAt!]));
      const league = await prisma.langClassMember.findMany({ where: { classId: c.id, inLeague: true }, select: { id: true, userId: true, nickname: true } });
      const xp = await prisma.langDailyActivity.findMany({
        where: { day: { in: weekDays(monday) }, course: { userId: { in: league.map((l) => l.userId) }, targetLang: c.targetLang } },
        select: { xp: true, course: { select: { userId: true } } },
      });
      const xpBy = new Map<string, number>();
      for (const r of xp) xpBy.set(r.course.userId, (xpBy.get(r.course.userId) ?? 0) + r.xp);
      return {
        id: c.id,
        name: c.name,
        teacher: c.teacher.name ?? "Your teacher",
        targetLang: c.targetLang,
        level: c.level,
        courseId: course?.id ?? null,
        onClassCourse: course?.curriculumId === c.curriculumId,
        inLeague: m.inLeague,
        nickname: m.nickname,
        assignments: c.assignments.map((a) => {
          const ids = lessonsOf.get(a.id) ?? [];
          const s = assignmentState(ids, done, a.dueAt, now);
          return { id: a.id, title: a.title, note: a.note, dueAt: a.dueAt, state: s.state as AssignmentState, done: s.done, total: s.total, nextLessonId: ids.find((id) => !done.has(id)) ?? null };
        }),
        league: m.inLeague
          ? rankLeague(league.map((l) => ({ memberId: l.id, nickname: l.nickname ?? "?", xp: xpBy.get(l.userId) ?? 0, you: l.userId === userId })))
          : null,
      };
    }),
  );
}

/** Open assignments across the student's classes, soonest first, for the PolyLingue home. */
export async function openAssignments(userId: string, now = new Date()) {
  const classes = await myClasses(userId, now);
  return classes
    .flatMap((c) =>
      c.assignments
        .filter((a) => a.state === "todo" || a.state === "overdue")
        .map((a) => ({ ...a, classId: c.id, className: c.name, courseId: c.courseId, targetLang: c.targetLang })),
    )
    .sort((a, b) => new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime());
}
