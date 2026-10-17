import { test, expect } from "@playwright/test";
import { cleanUp, contextFor, courseFor, createAccount, openPage, prisma, seedCourse, LESSON, type E2EUser, type SeededCourse } from "./polylingue-fixtures";

/**
 * Change level from the left panel's right-click menu, for the same
 * language. The level switched to is prepared as ready so no AI model is
 * called; a level nobody started is shown as "written for you".
 */
test.describe.configure({ mode: "serial", timeout: 240_000 });

let course: SeededCourse;
let learner: E2EUser;
let otherCurriculumId: string | null = null;
let otherLevel = "";

test.beforeAll(async () => {
  course = await seedCourse();
  learner = await createAccount("E2E Level learner");
  await courseFor(learner, course);
  const used = new Set((await prisma.langCurriculum.findMany({ where: { targetLang: course.targetLang, baseLang: course.baseLang }, select: { level: true } })).map((c) => c.level));
  otherLevel = (["B1", "A2", "A1"] as const).find((l) => !used.has(l))!;
  const c = await prisma.langCurriculum.create({
    data: { targetLang: course.targetLang, baseLang: course.baseLang, level: otherLevel as "B1", status: "READY", outline: { units: [{ title: "Next", theme: "t", grammar: "g", lessons: [] }] } },
  });
  otherCurriculumId = c.id;
  await prisma.langLesson.create({ data: { curriculumId: c.id, ordinal: 0, unitIndex: 0, unitTitle: "Next", title: "Next level lesson", focus: "f", status: "READY", content: LESSON } });
});

test.afterAll(async () => {
  if (otherCurriculumId) {
    await prisma.languageCourse.deleteMany({ where: { curriculumId: otherCurriculumId } });
    await prisma.langCurriculum.deleteMany({ where: { id: otherCurriculumId } });
  }
  await cleanUp([learner], course);
});

test("right-click the language, Change level…, and switch to a ready level", async ({ browser, baseURL }) => {
  const { page } = await contextFor(browser, baseURL!, learner);
  await openPage(page, "/polylingue");
  const entry = page.getByRole("navigation", { name: "PolyLingue" }).getByRole("link", { name: new RegExp(`· ${course.level}$`) });
  await expect(entry).toBeVisible({ timeout: 90_000 });
  await entry.click({ button: "right" });
  await page.getByRole("menuitem", { name: "Change level…" }).click();

  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("Change level")).toBeVisible({ timeout: 30_000 });
  const current = dialog.locator("label", { hasText: course.level }).first();
  await expect(current.getByText("current")).toBeVisible({ timeout: 30_000 });
  await expect(dialog.locator("label", { hasText: "C1" }).getByText("written for you")).toBeVisible();
  const target = dialog.locator("label", { hasText: otherLevel }).first();
  await expect(target.getByText("ready")).toBeVisible();
  await target.click();
  await dialog.getByRole("button", { name: `Switch to ${otherLevel}` }).click();

  await expect(page.getByText(new RegExp(`now ${otherLevel}`))).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("navigation", { name: "PolyLingue" }).getByRole("link", { name: new RegExp(`· ${otherLevel}$`) })).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText("Next level lesson").first()).toBeVisible({ timeout: 60_000 });
  const saved = await prisma.languageCourse.findFirstOrThrow({ where: { userId: learner.id } });
  expect(saved).toMatchObject({ level: otherLevel, curriculumId: otherCurriculumId });
  await page.context().close();
});

test("the menu also opens from the keyboard (Shift+F10)", async ({ browser, baseURL }) => {
  const { page } = await contextFor(browser, baseURL!, learner);
  await openPage(page, "/polylingue");
  const entry = page.getByRole("navigation", { name: "PolyLingue" }).getByRole("link", { name: new RegExp(`· ${otherLevel}$`) });
  await entry.focus({ timeout: 90_000 });
  await page.keyboard.press("Shift+F10");
  await expect(page.getByRole("menuitem", { name: "Change level…" })).toBeVisible({ timeout: 30_000 });
  await page.keyboard.press("Escape");
  await page.context().close();
});
