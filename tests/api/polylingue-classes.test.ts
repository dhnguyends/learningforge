import { describe, it, expect, beforeAll, afterAll } from "vitest";
import "./helpers";
import { prisma, createTestUser, disposeTestUser, signInAs, jsonRequest, type TestUser } from "./helpers";
import { NextRequest } from "next/server";
import { GET as listClasses, POST as createClassRoute } from "@/app/api/polylingue/teach/classes/route";
import { GET as dashboardRoute, PATCH as patchClass, DELETE as deleteClassRoute } from "@/app/api/polylingue/teach/classes/[classId]/route";
import { GET as outlineRoute } from "@/app/api/polylingue/teach/classes/[classId]/outline/route";
import { POST as assignRoute } from "@/app/api/polylingue/teach/classes/[classId]/assignments/route";
import { DELETE as unassignRoute } from "@/app/api/polylingue/teach/classes/[classId]/assignments/[assignmentId]/route";
import { DELETE as removeStudentRoute } from "@/app/api/polylingue/teach/classes/[classId]/students/[userId]/route";
import { GET as difficultiesRoute, POST as activitiesRoute } from "@/app/api/polylingue/teach/classes/[classId]/difficulties/route";
import { GET as exportRoute } from "@/app/api/polylingue/teach/classes/[classId]/export/route";
import { GET as myClassesRoute } from "@/app/api/polylingue/classes/route";
import { GET as previewRoute, POST as joinRoute } from "@/app/api/polylingue/classes/join/route";
import { PATCH as leagueRoute, DELETE as leaveRoute } from "@/app/api/polylingue/classes/[classId]/route";
import { GET as openAssignmentsRoute } from "@/app/api/polylingue/assignments/route";
import { POST as answerRoute } from "@/app/api/polylingue/courses/[courseId]/lessons/[lessonId]/answer/route";
import { POST as completeRoute } from "@/app/api/polylingue/courses/[courseId]/lessons/[lessonId]/complete/route";
import { adminRuleViolation, effectiveRole } from "@/lib/admin";
import { deleteAccountCompletely } from "@/lib/deletion";
import { assignmentState, behindReasons, toCsv } from "@/lib/polylingue/classes";
import { CEFR_LEVELS, TARGET_LANGUAGES, BASE_LANGUAGES, type Cefr } from "@/lib/polylingue/levels";
import type { LessonContent } from "@/lib/polylingue/content";

/**
 * Phase 4, PolyLingue for Schools: the TEACHER role (Human only), classes
 * joined with a code, assignments, the class dashboard, common difficulties
 * with suggested activities (mock model), CSV export, class leagues, and the
 * privacy rules — on hand-written courses at language pairs nobody uses.
 */
const BASE = "http://localhost";
let teacher: TestUser;
let otherTeacher: TestUser;
let ana: TestUser;
let ben: TestUser;
let combo: { t: string; b: string; l: Cefr; l2: Cefr };
let curriculumId: string;
let otherCurriculumId: string;
let classId: string;
let code: string;
const unit0: string[] = [];
let unit1Lesson: string;

const LESSON: LessonContent = {
  intro: "Greetings.",
  words: [
    { term: "ciao", translation: "hello", example: "", exampleTranslation: "", partOfSpeech: "" },
    { term: "grazie", translation: "thank you", example: "", exampleTranslation: "", partOfSpeech: "" },
    { term: "sì", translation: "yes", example: "", exampleTranslation: "", partOfSpeech: "" },
  ],
  exercises: Array.from({ length: 6 }, (_, i) => ({
    type: "choice" as const,
    prompt: `Q${i + 1}: what does "ciao" mean?`,
    text: "",
    answer: "hello",
    accepted: [],
    options: ["hello", "bye", "thanks"],
    pairs: [],
    explanation: "",
    audio: "",
  })),
};

const body = (r: Response) => r.json();
const get = (url = `${BASE}/x`) => new NextRequest(url);
const cls = () => ({ params: { classId } });

async function courseOf(user: TestUser) {
  return prisma.languageCourse.findUniqueOrThrow({ where: { userId_targetLang: { userId: user.id, targetLang: combo.t } } });
}

beforeAll(async () => {
  teacher = await createTestUser("Teacher");
  otherTeacher = await createTestUser("Other teacher");
  ana = await createTestUser("Ana");
  ben = await createTestUser("=cmd|' /C calc'!A0"); // a name a spreadsheet would run as a formula
  // Only Human accounts can teach (these test accounts are deleted afterwards).
  await prisma.user.updateMany({ where: { id: { in: [teacher.id, otherTeacher.id] } }, data: { role: "TEACHER", nature: "HUMAN" } });

  const used = new Set((await prisma.langCurriculum.findMany({ select: { targetLang: true, baseLang: true, level: true } })).map((c) => `${c.targetLang}/${c.baseLang}/${c.level}`));
  outer: for (const t of TARGET_LANGUAGES.map((x) => x.code)) {
    for (const b of BASE_LANGUAGES.map((x) => x.code)) {
      if (t === b) continue;
      const free = CEFR_LEVELS.slice(0, 2).filter((l) => !used.has(`${t}/${b}/${l}`));
      if (free.length === 2) {
        combo = { t, b, l: free[0], l2: free[1] };
        break outer;
      }
    }
  }
  if (!combo) throw new Error("no unused language pair for the test");
  const outline = {
    units: [
      { title: "Hello", theme: "greetings", grammar: "Informal greetings", lessons: [] },
      { title: "Café", theme: "ordering", grammar: "Polite requests", lessons: [] },
    ],
  };
  const curriculum = await prisma.langCurriculum.create({ data: { targetLang: combo.t, baseLang: combo.b, level: combo.l, status: "READY", outline } });
  curriculumId = curriculum.id;
  for (const [i, unitIndex] of [0, 0, 1].entries()) {
    const l = await prisma.langLesson.create({
      data: { curriculumId, ordinal: i, unitIndex, unitTitle: outline.units[unitIndex].title, title: `Lesson ${i + 1}`, focus: "f", status: "READY", content: LESSON as never },
    });
    if (unitIndex === 0) unit0.push(l.id);
    else unit1Lesson = l.id;
  }
  // Ben already learns this language at another level, with some XP.
  const other = await prisma.langCurriculum.create({ data: { targetLang: combo.t, baseLang: combo.b, level: combo.l2, status: "READY", outline } });
  otherCurriculumId = other.id;
  await prisma.languageCourse.create({ data: { userId: ben.id, targetLang: combo.t, baseLang: combo.b, level: combo.l2, curriculumId: other.id, xp: 120 } });
});

afterAll(async () => {
  for (const u of [teacher, otherTeacher, ana, ben]) await disposeTestUser(u.email);
  await prisma.langCurriculum.deleteMany({ where: { id: { in: [curriculumId, otherCurriculumId] } } });
  await prisma.$disconnect();
});

describe("the TEACHER role", () => {
  it("is for Human accounts only", async () => {
    expect(effectiveRole("TEACHER", "HUMAN")).toBe("TEACHER");
    expect(effectiveRole("TEACHER", "BOT")).toBe("USER");
    expect(adminRuleViolation({ role: "TEACHER", nature: "BOT" })).toMatch(/Only Human accounts can be made Teachers/);
    expect(adminRuleViolation({ role: "TEACHER", nature: "BOT" }, { role: "TEACHER", nature: "HUMAN" })).toMatch(/remove the Teacher role/);
    expect(adminRuleViolation({ role: "TEACHER", nature: "HUMAN" })).toBeNull();
  });

  it("is needed to run classes (a Bot set to TEACHER is refused)", async () => {
    signInAs(ana.id);
    expect((await listClasses(get(), {} as never)).status).toBe(403);
    const bot = await createTestUser("Bot teacher");
    await prisma.user.update({ where: { id: bot.id }, data: { role: "TEACHER" } });
    signInAs(bot.id);
    expect((await listClasses(get(), {} as never)).status).toBe(403);
    await disposeTestUser(bot.email);
  });
});

describe("classes", () => {
  it("lets a teacher create a class on the shared course", async () => {
    signInAs(teacher.id);
    expect((await createClassRoute(jsonRequest(`${BASE}/x`, "POST", { name: "x", targetLang: combo.t, baseLang: combo.b, level: combo.l }), {} as never)).status).toBe(400);
    const res = await createClassRoute(jsonRequest(`${BASE}/x`, "POST", { name: "Italian 1B", targetLang: combo.t, baseLang: combo.b, level: combo.l, weeklyMinutes: 30 }), {} as never);
    expect(res.status).toBe(201);
    ({ id: classId, code } = await body(res));
    expect(code).toMatch(/^[A-Z2-9]{3}-[A-Z2-9]{3}$/);
    const { classes } = await body(await listClasses(get(), {} as never));
    expect(classes).toEqual([expect.objectContaining({ id: classId, name: "Italian 1B", students: 0, courseStatus: "READY", weeklyMinutes: 30 })]);
    const outline = await body(await outlineRoute(get(), cls()));
    expect(outline.units.map((u: { lessons: unknown[] }) => u.lessons.length)).toEqual([2, 1]);
  });

  it("lets students preview and join with the code; their course follows the class", async () => {
    signInAs(ben.id);
    const preview = await body(await previewRoute(get(`${BASE}/x?code=${code.replace("-", "").toLowerCase()}`), {} as never));
    expect(preview).toMatchObject({ name: "Italian 1B", level: combo.l, alreadyMember: false, currentCourse: { level: combo.l2, changes: true } });
    expect((await previewRoute(get(`${BASE}/x?code=ZZZ-ZZ`), {} as never)).status).toBe(400);
    const joined = await body(await joinRoute(jsonRequest(`${BASE}/x`, "POST", { code, timeZone: "Europe/Paris" }), {} as never));
    expect(joined.classId).toBe(classId);
    expect(await courseOf(ben)).toMatchObject({ curriculumId, level: combo.l, xp: 120 });

    signInAs(ana.id);
    await joinRoute(jsonRequest(`${BASE}/x`, "POST", { code, timeZone: "UTC" }), {} as never);
    expect(await courseOf(ana)).toMatchObject({ curriculumId, timeZone: "UTC" });

    signInAs(teacher.id);
    expect((await joinRoute(jsonRequest(`${BASE}/x`, "POST", { code, timeZone: "UTC" }), {} as never)).status).toBe(400); // own class
  });

  it("assigns a unit or a lesson, never both or something outside the course", async () => {
    signInAs(teacher.id);
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString();
    const unit = await assignRoute(jsonRequest(`${BASE}/x`, "POST", { unitIndex: 0, dueAt: tomorrow, note: "Before Friday" }), cls());
    expect(unit.status).toBe(201);
    expect((await body(unit)).title).toBe("Unit 1: Hello");
    const lesson = await body(await assignRoute(jsonRequest(`${BASE}/x`, "POST", { lessonId: unit1Lesson, dueAt: tomorrow }), cls()));
    // Make the lesson assignment overdue.
    await prisma.langAssignment.update({ where: { id: lesson.id }, data: { dueAt: new Date(Date.now() - 3600_000) } });
    expect((await assignRoute(jsonRequest(`${BASE}/x`, "POST", { unitIndex: 0, lessonId: unit1Lesson, dueAt: tomorrow }), cls())).status).toBe(400);
    expect((await assignRoute(jsonRequest(`${BASE}/x`, "POST", { dueAt: tomorrow }), cls())).status).toBe(400);
    expect((await assignRoute(jsonRequest(`${BASE}/x`, "POST", { unitIndex: 7, dueAt: tomorrow }), cls())).status).toBe(400);
    expect((await assignRoute(jsonRequest(`${BASE}/x`, "POST", { lessonId: "elsewhere", dueAt: tomorrow }), cls())).status).toBe(400);
    expect((await assignRoute(jsonRequest(`${BASE}/x`, "POST", { unitIndex: 1, dueAt: "2020-01-01" }), cls())).status).toBe(400);
  });

  it("shows students their assignments first, and marks them done", async () => {
    signInAs(ana.id);
    const course = await courseOf(ana);
    let open = (await body(await openAssignmentsRoute(get(), {} as never))).assignments;
    expect(open.map((a: { title: string; state: string }) => [a.title, a.state])).toEqual([
      ["Lesson 3 (unit 2)", "overdue"],
      ["Unit 1: Hello", "todo"],
    ]);
    expect(open[1]).toMatchObject({ nextLessonId: unit0[0], courseId: course.id, done: 0, total: 2 });

    for (const lessonId of unit0) {
      for (let i = 0; i < 6; i++) {
        await answerRoute(jsonRequest(`${BASE}/x`, "POST", { index: i, answer: i < 2 ? "bye" : "hello", retry: false }), { params: { courseId: course.id, lessonId } });
      }
      await completeRoute(jsonRequest(`${BASE}/x`, "POST", { firstTryCorrect: 4, total: 6, seconds: 600 }), { params: { courseId: course.id, lessonId } });
    }
    open = (await body(await openAssignmentsRoute(get(), {} as never))).assignments;
    expect(open.map((a: { title: string }) => a.title)).toEqual(["Lesson 3 (unit 2)"]);
    const { classes } = await body(await myClassesRoute(get(), {} as never));
    expect(classes[0]).toMatchObject({ name: "Italian 1B", teacher: "Teacher", onClassCourse: true, inLeague: false, league: null });
    expect(classes[0].assignments.find((a: { title: string }) => a.title.startsWith("Unit")).state).toBe("done");
    // Classmates' data is not part of the student's view.
    expect(JSON.stringify(classes)).not.toContain(ben.email);
  });

  it("gives the teacher a dashboard with who falls behind", async () => {
    signInAs(teacher.id);
    const d = await body(await dashboardRoute(get(), cls()));
    expect(d.class).toMatchObject({ id: classId, code, weeklyMinutes: 30 });
    const a = d.students.find((s: { userId: string }) => s.userId === ana.id);
    const b = d.students.find((s: { userId: string }) => s.userId === ben.id);
    expect(a).toMatchObject({ assignmentsDone: 1, overdue: 1, minutes7: 20, activeDays7: 1, inactiveDays: 0, onClassCourse: true });
    expect(a.skills.find((k: { name: string }) => k.name === "Lessons")).toMatchObject({ answers: 12, accuracy: 67 });
    expect(a.behind).toEqual(["20 of 30 min this week", "1 overdue assignment"]);
    expect(b.behind[0]).toBe("Has not practised yet");
    expect(d.assignments.map((x: { title: string; finished: number; of: number }) => [x.title, x.finished, x.of])).toEqual([
      ["Lesson 3 (unit 2)", 0, 2],
      ["Unit 1: Hello", 1, 2],
    ]);
  });

  it("finds the class's difficulties and suggests activities", async () => {
    await prisma.langCard.updateMany({ where: { courseId: (await courseOf(ana)).id, term: "grazie" }, data: { lapses: 3 } });
    signInAs(teacher.id);
    const d = await body(await difficultiesRoute(get(), cls()));
    expect(d.students).toBe(2);
    expect(d.words[0]).toMatchObject({ term: "grazie", lapses: 3, learners: 1 });
    expect(d.exercises[0]).toMatchObject({ prompt: 'Q1: what does "ciao" mean?', answer: "hello", wrongRate: 100 });
    expect(d.grammar[0]).toMatchObject({ unit: 1, grammar: "Informal greetings", accuracy: 67 });
    expect(d.activities).toBeNull();
    const made = await body(await activitiesRoute(jsonRequest(`${BASE}/x`, "POST"), cls()));
    expect(made.activities.length).toBeGreaterThanOrEqual(2);
    expect((await body(await difficultiesRoute(get(), cls()))).activities).toEqual(made.activities);
  });

  it("exports the class as CSV, safe for spreadsheets", async () => {
    signInAs(teacher.id);
    const res = await exportRoute(get(), cls());
    expect(res.headers.get("content-type")).toContain("text/csv");
    expect(res.headers.get("content-disposition")).toMatch(/attachment; filename="Italian-1B-\d{4}-\d{2}-\d{2}\.csv"/);
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]); // so Excel reads UTF-8
    const text = new TextDecoder().decode(bytes);
    expect(text).toContain("Student,E-mail,Level");
    expect(text).toContain(ana.email);
    expect(text).toContain("\n'=cmd|' /C calc'!A0,"); // starts with a quote: not a live formula
  });

  it("keeps class leagues opt-in, with nicknames only", async () => {
    signInAs(ana.id);
    expect((await leagueRoute(jsonRequest(`${BASE}/x`, "PATCH", { inLeague: true }), cls())).status).toBe(400); // needs a nickname
    await leagueRoute(jsonRequest(`${BASE}/x`, "PATCH", { inLeague: true, nickname: "Annie" }), cls());
    let mine = (await body(await myClassesRoute(get(), {} as never))).classes[0];
    expect(mine.league.map((r: { nickname: string; you: boolean }) => [r.nickname, r.you])).toEqual([["Annie", true]]);

    signInAs(ben.id);
    mine = (await body(await myClassesRoute(get(), {} as never))).classes[0];
    expect(mine.league).toBeNull(); // Ben has not opted in: he sees no ranking
    await leagueRoute(jsonRequest(`${BASE}/x`, "PATCH", { inLeague: true, nickname: "B" + "en" }), cls());
    mine = (await body(await myClassesRoute(get(), {} as never))).classes[0];
    expect(mine.league.map((r: { nickname: string }) => r.nickname)).toEqual(["Annie", "Ben"]);
    expect(JSON.stringify(mine.league)).not.toContain(ana.email);
  });

  it("keeps each teacher to their own classes, and students out of teaching", async () => {
    signInAs(otherTeacher.id);
    expect((await dashboardRoute(get(), cls())).status).toBe(404);
    expect((await exportRoute(get(), cls())).status).toBe(404);
    expect((await removeStudentRoute(get(), { params: { classId, userId: ana.id } })).status).toBe(404);
    expect((await body(await listClasses(get(), {} as never))).classes).toEqual([]);
    signInAs(ana.id);
    expect((await dashboardRoute(get(), cls())).status).toBe(403);
  });

  it("removes a student, lets one leave, and deletes the class; courses stay", async () => {
    signInAs(teacher.id);
    expect((await patchClass(jsonRequest(`${BASE}/x`, "PATCH", { newCode: true }), cls())).status).toBe(200);
    expect((await prisma.langClass.findUniqueOrThrow({ where: { id: classId } })).code).not.toBe(code);
    expect((await removeStudentRoute(get(), { params: { classId, userId: ben.id } })).status).toBe(200);
    signInAs(ana.id);
    expect((await leaveRoute(get(), cls())).status).toBe(200);
    expect(await prisma.langClassMember.count({ where: { classId } })).toBe(0);
    signInAs(teacher.id);
    const assignment = await prisma.langAssignment.findFirstOrThrow({ where: { classId } });
    expect((await unassignRoute(get(), { params: { classId, assignmentId: assignment.id } })).status).toBe(200);
    expect((await deleteClassRoute(get(), cls())).status).toBe(200);
    expect(await prisma.langAssignment.count({ where: { classId } })).toBe(0);
    expect(await courseOf(ana)).toBeTruthy();
  });
});

describe("privacy: deleting an account removes its PolyLingue data", () => {
  it("leaves no course, card, attempt, class, membership, league, reminder or subscription behind", async () => {
    const gone = await createTestUser("Leaving learner");
    const c = await prisma.languageCourse.create({ data: { userId: gone.id, targetLang: combo.t, baseLang: combo.b, level: combo.l, curriculumId } });
    await prisma.langCard.create({ data: { courseId: c.id, term: "ciao", translation: "hello" } });
    await prisma.langExerciseAttempt.create({ data: { courseId: c.id, lessonId: unit0[0], exerciseIndex: 0, type: "choice", answer: "hello", verdict: "correct" } });
    await prisma.langOfflineSync.create({ data: { id: `gone-${gone.id}`, courseId: c.id, lessonId: unit0[0] } });
    const league = await prisma.langLeague.create({ data: { name: "L", code: `Q${Date.now().toString(36).slice(-2).toUpperCase()}-ZZ9`.slice(0, 7), createdById: gone.id, members: { create: { userId: gone.id, nickname: "G" } } } });
    await prisma.langReminder.create({ data: { userId: gone.id } });
    await prisma.pushSubscription.create({ data: { userId: gone.id, endpoint: `https://push.example.test/${gone.id}`, p256dh: "x".repeat(20), auth: "y".repeat(10) } });
    const theirClass = await prisma.langClass.create({ data: { teacherId: gone.id, name: "C", targetLang: combo.t, baseLang: combo.b, level: combo.l, curriculumId, code: `T${Date.now().toString(36).slice(-2).toUpperCase()}-ZZ8`.slice(0, 7) } });

    await deleteAccountCompletely(gone.id);
    expect(await prisma.languageCourse.count({ where: { userId: gone.id } })).toBe(0);
    expect(await prisma.langCard.count({ where: { courseId: c.id } })).toBe(0);
    expect(await prisma.langExerciseAttempt.count({ where: { courseId: c.id } })).toBe(0);
    expect(await prisma.langOfflineSync.count({ where: { courseId: c.id } })).toBe(0);
    expect(await prisma.langLeague.count({ where: { id: league.id } })).toBe(0);
    expect(await prisma.langReminder.count({ where: { userId: gone.id } })).toBe(0);
    expect(await prisma.pushSubscription.count({ where: { userId: gone.id } })).toBe(0);
    expect(await prisma.langClass.count({ where: { id: theirClass.id } })).toBe(0);
  });
});

describe("class rules", () => {
  it("dates assignments and explains who falls behind", () => {
    const due = new Date("2026-10-20T18:00:00Z");
    const done = new Map([
      ["a", new Date("2026-10-19T10:00:00Z")],
      ["b", new Date("2026-10-21T10:00:00Z")],
    ]);
    expect(assignmentState(["a"], done, due, new Date("2026-10-22")).state).toBe("done");
    expect(assignmentState(["a", "b"], done, due, new Date("2026-10-22")).state).toBe("late");
    expect(assignmentState(["a", "c"], done, due, new Date("2026-10-19"))).toMatchObject({ state: "todo", done: 1, total: 2 });
    expect(assignmentState(["c"], done, due, new Date("2026-10-21")).state).toBe("overdue");
    expect(behindReasons({ inactiveDays: 1, minutes7: 90, weeklyMinutes: 60, overdue: 0 })).toEqual([]);
    expect(behindReasons({ inactiveDays: 4, minutes7: 10, weeklyMinutes: 60, overdue: 2 })).toEqual([
      "Inactive for 4 days",
      "10 of 60 min this week",
      "2 overdue assignments",
    ]);
    expect(toCsv(["a", "b"], [["x,y", 3], ["say \"hi\"", null]])).toBe('a,b\r\n"x,y",3\r\n"say ""hi""",\r\n');
  });
});
