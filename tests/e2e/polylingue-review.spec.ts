import { test, expect, type Page } from "@playwright/test";
import { cleanUp, contextFor, courseFor, createAccount, prisma, seedCourse, type E2EUser, type SeededCourse } from "./polylingue-fixtures";

/**
 * Phase 5 end to end, quality and scale: learners report a problem (3
 * reports hide the exercise); an admin finds it in the queue, corrects it,
 * restores a version, retires and brings back a lesson, and opens the
 * content, analytics and voices screens. Steps that call an AI model
 * (Regenerate) or change a live setting (voice choice) are covered by the API
 * tests with mocks, not here.
 */
test.describe.configure({ mode: "serial", timeout: 240_000 });

let course: SeededCourse;
let admin: E2EUser;
const learners: E2EUser[] = [];
const courseIds: string[] = [];
let adminPage: Page;
let learnerPage: Page;

test.beforeAll(async ({ browser, baseURL }) => {
  course = await seedCourse();
  admin = await createAccount("E2E Admin", "ADMIN");
  for (let i = 0; i < 3; i++) {
    const u = await createAccount(`E2E Learner ${i + 1}`);
    learners.push(u);
    courseIds.push((await courseFor(u, course)).id);
  }
  adminPage = (await contextFor(browser, baseURL!, admin)).page;
  learnerPage = (await contextFor(browser, baseURL!, learners[0])).page;
});

test.afterAll(async () => {
  await cleanUp([admin, ...learners], course);
});

const lessonUrl = (i: number, lessonId = course.unit0[0]) => `/polylingue/${courseIds[i]}/lesson/${lessonId}`;

test("a learner reports a problem from the answer feedback", async () => {
  await learnerPage.goto(lessonUrl(0));
  await learnerPage.getByRole("button", { name: "Start the 6 exercises" }).click({ timeout: 90_000 });
  await learnerPage.getByRole("button", { name: /hello$/ }).click();
  await learnerPage.getByRole("button", { name: "Check", exact: true }).click();
  await learnerPage.getByRole("button", { name: "Report a problem" }).click();
  await learnerPage.getByLabel("The expected answer is wrong").check();
  await learnerPage.getByLabel("Details").fill("Ciao also means goodbye");
  await learnerPage.getByRole("button", { name: "Send" }).click();
  await expect(learnerPage.getByText(/problem was reported/)).toBeVisible({ timeout: 30_000 });
  await expect(learnerPage.getByRole("button", { name: "Reported" })).toBeDisabled();
  const report = await prisma.langReport.findFirstOrThrow({ where: { lessonId: course.unit0[0], userId: learners[0].id } });
  expect(report).toMatchObject({ exerciseIndex: 0, reason: "wrong_answer", comment: "Ciao also means goodbye", resolvedAt: null });
});

test("after 3 different learners report it, the exercise is skipped", async ({ browser, baseURL }) => {
  for (const i of [1, 2]) {
    const { ctx } = await contextFor(browser, baseURL!, learners[i]);
    const res = await ctx.request.post(`/api/polylingue/courses/${courseIds[i]}/lessons/${course.unit0[0]}/report`, { data: { index: 0, reason: "unclear" } });
    expect(res.status()).toBe(201);
    await ctx.close();
  }
  await learnerPage.goto(lessonUrl(0));
  await expect(learnerPage.getByRole("button", { name: "Start the 5 exercises" })).toBeVisible({ timeout: 90_000 });
});

test("the admin finds the hidden exercise in the report queue", async () => {
  await adminPage.goto("/admin?tab=polylingue");
  await adminPage.getByRole("tab", { name: /Reports/ }).click({ timeout: 90_000 });
  const entry = adminPage.locator("li", { hasText: "Greetings 1 · exercise 1" });
  await expect(entry).toBeVisible({ timeout: 30_000 });
  await expect(entry.getByText("hidden from learners")).toBeVisible();
  await expect(entry.getByText(/wrong answer × 1/)).toBeVisible();
  await expect(entry.getByText(/unclear × 2/)).toBeVisible();
  await entry.getByRole("link", { name: "Review" }).click();
  await adminPage.waitForURL(/\/admin\/polylingue\/[a-z0-9]+\?exercise=0$/, { timeout: 60_000 });
  await expect(adminPage.locator("#exercise-0").getByText("3 reports")).toBeVisible({ timeout: 60_000 });
});

test("the admin corrects the exercise; it is shown again and the version before is kept", async () => {
  const ex = adminPage.locator("#exercise-0");
  await ex.getByLabel("Answer").fill("hi");
  await ex.getByLabel("Options (one per line)").fill("hi\ngoodbye forever\nthank you");
  await adminPage.getByLabel("Change note").fill("Accept hi");
  await adminPage.getByRole("button", { name: "Save corrections" }).click();
  await expect(adminPage.getByText(/1 exercise corrected/)).toBeVisible({ timeout: 30_000 });
  await expect(adminPage.getByText("Earlier versions")).toBeVisible({ timeout: 30_000 });
  await expect(adminPage.getByText(/Version 1/)).toBeVisible();
  await expect(adminPage.locator("#exercise-0").getByText("hidden from learners")).toHaveCount(0);
  const lesson = await prisma.langLesson.findUniqueOrThrow({ where: { id: course.unit0[0] } });
  expect(lesson.hiddenExercises).toEqual([]);
  expect((lesson.content as { exercises: { answer: string }[] }).exercises[0].answer).toBe("hi");
  expect(await prisma.langReport.count({ where: { lessonId: course.unit0[0], resolution: "fixed" } })).toBe(3);

  await learnerPage.goto(lessonUrl(0));
  await expect(learnerPage.getByRole("button", { name: "Start the 6 exercises" })).toBeVisible({ timeout: 90_000 });
});

test("the admin restores the earlier version", async () => {
  await adminPage.getByRole("button", { name: "Restore" }).first().click();
  await adminPage.getByRole("dialog").getByRole("button", { name: "Restore" }).click();
  await expect(adminPage.getByText(/Version 1 restored/)).toBeVisible({ timeout: 30_000 });
  const lesson = await prisma.langLesson.findUniqueOrThrow({ where: { id: course.unit0[0] } });
  expect((lesson.content as { exercises: { answer: string }[] }).exercises[0].answer).toBe("hello");
});

test("the admin retires a lesson: learners no longer see it, until it is brought back", async () => {
  await adminPage.goto(`/admin/polylingue/${course.unit1}`);
  await adminPage.getByRole("button", { name: "Retire" }).click({ timeout: 90_000 });
  await adminPage.getByRole("dialog").getByRole("button", { name: "Retire" }).click();
  await expect(adminPage.getByRole("button", { name: "Bring back" })).toBeVisible({ timeout: 30_000 });

  await learnerPage.goto(`/polylingue/${courseIds[0]}`);
  await expect(learnerPage.getByRole("link", { name: /Greetings 1/ })).toBeVisible({ timeout: 90_000 });
  await expect(learnerPage.getByRole("link", { name: /Greetings 3/ })).toHaveCount(0);
  await learnerPage.goto(lessonUrl(0, course.unit1));
  await expect(learnerPage.getByText(/withdrawn from the course/)).toBeVisible({ timeout: 60_000 });

  await adminPage.getByRole("button", { name: "Bring back" }).click();
  await expect(adminPage.getByRole("button", { name: "Retire" })).toBeVisible({ timeout: 30_000 });
  await learnerPage.goto(`/polylingue/${courseIds[0]}`);
  await expect(learnerPage.getByRole("link", { name: /Greetings 3/ })).toBeVisible({ timeout: 60_000 });
});

test("the admin's content, analytics and voices screens work", async () => {
  await adminPage.goto("/admin?tab=polylingue");
  const row = adminPage.getByRole("row", { name: new RegExp(`${course.level}`) }).filter({ hasText: /explanations in/ }).filter({ has: adminPage.locator("td", { hasText: /^3$/ }) });
  await expect(row.first()).toBeVisible({ timeout: 90_000 }); // our course: 3 learners
  await row.first().getByRole("button", { name: "Open the lessons" }).click();
  await expect(adminPage.getByText("Unit 1 · Hello")).toBeVisible({ timeout: 30_000 });
  await expect(adminPage.getByRole("link", { name: /Greetings 1/ })).toBeVisible();

  await adminPage.getByRole("tab", { name: "Analytics" }).click();
  await expect(adminPage.getByText("Retention")).toBeVisible({ timeout: 60_000 });
  await expect(adminPage.getByText(/came back on day 7/)).toBeVisible();
  await expect(adminPage.getByText("Time per lesson")).toBeVisible();

  await adminPage.getByRole("tab", { name: /Voices/ }).click();
  for (const lang of ["Spanish", "English", "French", "German", "Italian", "Portuguese"]) {
    await expect(adminPage.getByLabel(`Voice for ${lang}`)).toBeVisible({ timeout: 30_000 });
  }
});

test("learners cannot open the admin review", async () => {
  await learnerPage.goto(`/admin/polylingue/${course.unit0[0]}`);
  await expect(learnerPage).toHaveURL(/\/dashboard\?denied=admin/, { timeout: 60_000 });
});
