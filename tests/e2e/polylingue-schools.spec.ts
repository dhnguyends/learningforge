import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { cleanUp, closeBadges, contextFor, createAccount, openPage, playLesson, prisma, seedCourse, type E2EUser, type SeededCourse } from "./polylingue-fixtures";

/**
 * Phase 4 end to end, PolyLingue for Schools: a teacher creates a class and
 * assigns work; a student joins with the code, sees the assignment first,
 * does it and joins the class league; the teacher follows the class, exports
 * it, and another teacher cannot see it. AI-dependent steps (suggested
 * activities) are covered by the API tests with the mock model.
 */
test.describe.configure({ mode: "serial", timeout: 240_000 });

let course: SeededCourse;
let teacher: E2EUser;
let otherTeacher: E2EUser;
let student: E2EUser;
let teacherPage: Page;
let studentPage: Page;
let code = "";
let classPath = "";

test.beforeAll(async ({ browser, baseURL }) => {
  course = await seedCourse();
  teacher = await createAccount("E2E Teacher", "TEACHER");
  otherTeacher = await createAccount("E2E Other teacher", "TEACHER");
  student = await createAccount("E2E Student");
  teacherPage = (await contextFor(browser, baseURL!, teacher)).page;
  studentPage = (await contextFor(browser, baseURL!, student)).page;
});

test.afterAll(async () => {
  await cleanUp([teacher, otherTeacher, student], course);
});

test("a student without the Teacher role is told who runs classes", async () => {
  await studentPage.goto("/polylingue/teach");
  await expect(studentPage.getByText(/Classes are run by teachers/)).toBeVisible({ timeout: 90_000 });
});

test("a teacher creates a class and gets its code", async () => {
  await teacherPage.goto("/polylingue/teach");
  await teacherPage.getByRole("button", { name: "New class" }).click({ timeout: 90_000 });
  await teacherPage.getByLabel("Name").fill("E2E Italian 1B");
  await teacherPage.getByLabel("Language taught").selectOption(course.targetLang);
  await teacherPage.getByLabel("Level").selectOption(course.level);
  await teacherPage.getByLabel("Explanations in").selectOption(course.baseLang);
  await teacherPage.getByLabel("Minutes a week").fill("30");
  await teacherPage.getByRole("button", { name: "Create the class" }).click();
  await teacherPage.waitForURL(/\/polylingue\/teach\/[a-z0-9]+$/, { timeout: 60_000 });
  classPath = new URL(teacherPage.url()).pathname;
  await expect(teacherPage.getByRole("heading", { name: "E2E Italian 1B" })).toBeVisible({ timeout: 60_000 });
  code = (await teacherPage.getByTitle("Copy the code for your students").innerText()).trim();
  expect(code).toMatch(/^[A-Z2-9]{3}-[A-Z2-9]{3}$/);
  const row = await prisma.langClass.findUniqueOrThrow({ where: { code } });
  expect(row).toMatchObject({ teacherId: teacher.id, curriculumId: course.curriculumId, weeklyMinutes: 30 });
});

test("the teacher assigns unit 1 with a due date", async () => {
  await teacherPage.getByRole("tab", { name: /Assignments/ }).click();
  await teacherPage.getByRole("button", { name: "Assign work" }).click();
  await teacherPage.getByRole("radio", { name: /Unit 1: Hello/ }).check({ timeout: 30_000 });
  await teacherPage.getByLabel("Note (optional)").fill("Before Friday");
  await teacherPage.getByRole("button", { name: "Assign", exact: true }).click();
  // The list refreshes once the dashboard is fetched again (the dev server may still be compiling the route).
  await expect(teacherPage.getByRole("tab", { name: "Assignments (1)" })).toBeVisible({ timeout: 60_000 });
  await expect(teacherPage.getByText(/0 of 0 finished/)).toBeVisible();
});

test("the student joins with the code after a preview", async () => {
  await studentPage.goto("/polylingue/classes");
  await studentPage.getByRole("button", { name: "Join a class" }).click({ timeout: 90_000 });
  await studentPage.getByLabel("Class code").fill(code.replace("-", " ").toLowerCase());
  await studentPage.getByRole("button", { name: "Continue" }).click();
  await expect(studentPage.getByText("E2E Italian 1B")).toBeVisible({ timeout: 30_000 });
  await expect(studentPage.getByRole("dialog").getByText(/Your teacher sees your activity/)).toBeVisible();
  await studentPage.getByRole("button", { name: "Join the class" }).click();
  await studentPage.waitForURL((url) => /\/polylingue\/[a-z0-9]{20,}$/.test(url.pathname), { timeout: 60_000 });
  const c = await prisma.languageCourse.findUniqueOrThrow({ where: { userId_targetLang: { userId: student.id, targetLang: course.targetLang } } });
  expect(c.curriculumId).toBe(course.curriculumId);
});

test("the student sees the assignment first on the home and completes it", async () => {
  for (let lesson = 0; lesson < 2; lesson++) {
    await openPage(studentPage, "/polylingue");
    await expect(studentPage.getByRole("heading", { name: "Assignments" })).toBeVisible({ timeout: 90_000 });
    await expect(studentPage.getByText("Unit 1: Hello")).toBeVisible();
    await expect(studentPage.getByText(`${lesson} of 2 lessons`, { exact: false })).toBeVisible();
    await studentPage.getByRole("link", { name: "Start" }).first().click();
    await playLesson(studentPage, { firstWrong: lesson === 0 });
    await closeBadges(studentPage);
  }
  await openPage(studentPage, "/polylingue");
  await expect(studentPage.getByRole("heading", { name: "PolyLingue" })).toBeVisible({ timeout: 60_000 });
  await expect(studentPage.getByRole("heading", { name: "Assignments" })).toHaveCount(0); // nothing left to do
});

test("the student joins the class league under a nickname", async () => {
  await openPage(studentPage, "/polylingue/classes");
  await expect(studentPage.getByText("Done").first()).toBeVisible({ timeout: 90_000 });
  await studentPage.getByLabel("Nickname shown to classmates").fill("Gigi");
  await studentPage.getByRole("button", { name: "Join the class league" }).click();
  await expect(studentPage.getByText("(you)")).toBeVisible({ timeout: 30_000 });
  await expect(studentPage.getByText("Gigi")).toBeVisible();
});

test("the teacher's dashboard shows the student's work and difficulties", async () => {
  await teacherPage.goto(classPath);
  const row = teacherPage.getByRole("row", { name: new RegExp(student.name) });
  await expect(row).toBeVisible({ timeout: 90_000 });
  await expect(row.getByRole("cell").nth(5)).toHaveText(/^1 \/ 1/); // assignments done (column 6)
  await teacherPage.getByRole("tab", { name: /Assignments/ }).click();
  await expect(teacherPage.getByText("1 of 1 finished")).toBeVisible();
  await teacherPage.getByRole("tab", { name: "Common difficulties" }).click();
  await expect(teacherPage.getByText("Exercises missed most")).toBeVisible({ timeout: 30_000 });
  await expect(teacherPage.getByText(/\d+% wrong/).first()).toBeVisible(); // the first answer was wrong
});

test("the teacher exports the class as a CSV file", async () => {
  await teacherPage.getByRole("tab", { name: "Students" }).click();
  const download = teacherPage.waitForEvent("download");
  await teacherPage.getByRole("link", { name: "CSV" }).click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/^E2E-Italian-1B-\d{4}-\d{2}-\d{2}\.csv$/);
  const text = readFileSync((await file.path())!, "utf8");
  expect(text).toContain("Student,E-mail,Level");
  expect(text).toContain(student.email);
});

test("another teacher cannot open the class", async ({ browser, baseURL }) => {
  const { page } = await contextFor(browser, baseURL!, otherTeacher);
  await page.goto(classPath);
  await expect(page.getByText(/Class not found/)).toBeVisible({ timeout: 90_000 });
  await page.goto("/polylingue/teach");
  await expect(page.getByText(/No class yet/)).toBeVisible({ timeout: 60_000 });
  await page.context().close();
});

test("the teacher removes the student, then deletes the class; the student keeps the course", async () => {
  await teacherPage.goto(classPath);
  await teacherPage.getByRole("button", { name: `Remove ${student.name} from the class` }).click({ timeout: 90_000 });
  await teacherPage.getByRole("button", { name: "Remove", exact: true }).click();
  await expect(teacherPage.getByText(/No student yet/)).toBeVisible({ timeout: 30_000 });
  await teacherPage.getByRole("button", { name: "Delete", exact: true }).first().click();
  await teacherPage.getByRole("dialog").getByRole("button", { name: "Delete" }).click();
  await teacherPage.waitForURL(/\/polylingue\/teach$/, { timeout: 60_000 });
  expect(await prisma.langClass.count({ where: { code } })).toBe(0);
  expect(await prisma.languageCourse.count({ where: { userId: student.id } })).toBe(1);
});
