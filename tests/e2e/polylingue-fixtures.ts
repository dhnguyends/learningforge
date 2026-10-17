import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";
import { expect, type Browser, type BrowserContext, type Page } from "@playwright/test";

/**
 * PolyLingue end-to-end fixtures: temporary accounts (Bots; a Teacher or an
 * Admin is made Human for the test only, as in the API tests), a hand-written
 * course at a language pair nobody uses (so no AI model is called and no
 * real learner sees it), sign-in, lesson play, and clean-up.
 */
export const prisma = new PrismaClient();
export const ACCESS_STATE = "test-results/.auth/access.json";
const PASSWORD = "e2e-password-" + randomUUID().slice(0, 8);

export interface E2EUser {
  id: string;
  email: string;
  name: string;
}

export async function createAccount(name: string, role: "USER" | "TEACHER" | "ADMIN" = "USER"): Promise<E2EUser> {
  const email = `e2e-${randomUUID()}@test.lectureforge`;
  const user = await prisma.user.create({
    data: { email, name, role, nature: role === "USER" ? "BOT" : "HUMAN", passwordHash: await bcrypt.hash(PASSWORD, 4) },
  });
  await prisma.workspace.create({ data: { name: `${name} workspace`, ownerId: user.id, members: { create: { userId: user.id, role: "OWNER" } } } });
  return { id: user.id, email, name };
}

/** A browser context signed in as the user (access key cookie included). */
export async function contextFor(browser: Browser, baseURL: string, user: E2EUser): Promise<{ ctx: BrowserContext; page: Page }> {
  const ctx = await browser.newContext({ storageState: ACCESS_STATE, ignoreHTTPSErrors: true, baseURL, viewport: { width: 1400, height: 1000 } });
  const csrf = await ctx.request.get("/api/auth/csrf");
  const { csrfToken } = (await csrf.json()) as { csrfToken: string };
  const res = await ctx.request.post("/api/auth/callback/credentials", { form: { email: user.email, password: PASSWORD, csrfToken, json: "true" } });
  expect(res.status(), `sign-in of ${user.name}`).toBe(200);
  return { ctx, page: await ctx.newPage() };
}

export interface SeededCourse {
  curriculumId: string;
  targetLang: string;
  baseLang: string;
  level: "A1" | "A2";
  unit0: string[];
  unit1: string;
}

const OPTIONS = ["hello", "goodbye forever", "thank you"];
export const LESSON = {
  intro: "Saying hello.",
  words: [
    { term: "ciao", translation: "hello", example: "", exampleTranslation: "", partOfSpeech: "" },
    { term: "grazie", translation: "thank you", example: "", exampleTranslation: "", partOfSpeech: "" },
    { term: "sì", translation: "yes", example: "", exampleTranslation: "", partOfSpeech: "" },
  ],
  exercises: Array.from({ length: 6 }, (_, i) => ({
    type: "choice",
    prompt: `(${i + 1}) What does "ciao" mean?`,
    text: "",
    answer: "hello",
    accepted: [],
    options: OPTIONS,
    pairs: [],
    explanation: "Ciao is informal.",
    audio: "",
  })),
};

/** A READY course (2 units: 2 lessons, then 1) at a target / explanation language / level nobody uses. */
export async function seedCourse(): Promise<SeededCourse> {
  const used = new Set((await prisma.langCurriculum.findMany({ select: { targetLang: true, baseLang: true, level: true } })).map((c) => `${c.targetLang}/${c.baseLang}/${c.level}`));
  const pairs = ["it/en", "pt/en", "de/en", "it/fr", "pt/fr", "de/fr", "es/fr", "es/en"];
  let combo: { t: string; b: string; l: "A1" | "A2" } | null = null;
  outer: for (const pair of pairs) {
    for (const l of ["A1", "A2"] as const) {
      if (!used.has(`${pair}/${l}`)) {
        const [t, b] = pair.split("/");
        combo = { t, b, l };
        break outer;
      }
    }
  }
  if (!combo) throw new Error("no unused language pair for the end-to-end test");
  const outline = {
    units: [
      { title: "Hello", theme: "greetings", grammar: "Informal greetings", lessons: [] },
      { title: "Café", theme: "ordering", grammar: "Polite requests", lessons: [] },
    ],
  };
  const curriculum = await prisma.langCurriculum.create({ data: { targetLang: combo.t, baseLang: combo.b, level: combo.l, status: "READY", outline } });
  const ids: string[] = [];
  for (const [i, unitIndex] of [0, 0, 1].entries()) {
    const l = await prisma.langLesson.create({
      data: { curriculumId: curriculum.id, ordinal: i, unitIndex, unitTitle: outline.units[unitIndex].title, title: `Greetings ${i + 1}`, focus: "greetings", status: "READY", content: LESSON },
    });
    ids.push(l.id);
  }
  return { curriculumId: curriculum.id, targetLang: combo.t, baseLang: combo.b, level: combo.l, unit0: ids.slice(0, 2), unit1: ids[2] };
}

export async function courseFor(user: E2EUser, c: SeededCourse) {
  return prisma.languageCourse.create({ data: { userId: user.id, targetLang: c.targetLang, baseLang: c.baseLang, level: c.level, curriculumId: c.curriculumId, timeZone: "UTC" } });
}

/** Closes the "new badge" dialog if it is open (it hides the page from the accessibility tree). */
export async function closeBadges(page: Page) {
  const great = page.getByRole("button", { name: "Great!" });
  if (await great.isVisible().catch(() => false)) await great.click();
}

/** Opens a PolyLingue page and closes a "new badge" dialog that may pop up on it. */
export async function openPage(page: Page, url: string) {
  await page.goto(url);
  const great = page.getByRole("button", { name: "Great!" });
  if (await great.waitFor({ timeout: 5_000 }).then(() => true, () => false)) await great.click();
}

/** Plays the open lesson to the end: right answers, except the first when `firstWrong`. */
export async function playLesson(page: Page, opts: { firstWrong?: boolean } = {}) {
  await page.getByRole("button", { name: /Start the \d+ exercises/ }).click({ timeout: 90_000 });
  let wrong = Boolean(opts.firstWrong);
  for (let i = 0; i < 30; i++) {
    if (await page.getByText("Lesson complete!").isVisible()) return;
    await page.getByRole("button", { name: wrong ? /goodbye forever$/ : /hello$/ }).click();
    wrong = false;
    await page.getByRole("button", { name: "Check", exact: true }).click();
    const next = page.getByRole("button", { name: /^(Continue|Finish)/ });
    const finishing = /^Finish/.test((await next.innerText()).trim());
    await next.click();
    if (finishing) break; // the lesson is being saved: wait for its summary below
    await page.waitForTimeout(100);
  }
  await expect(page.getByText("Lesson complete!")).toBeVisible({ timeout: 30_000 });
}

export async function cleanUp(users: E2EUser[], course: SeededCourse | null) {
  // Deleting the accounts removes their courses, classes, reports and memberships.
  await prisma.user.deleteMany({ where: { id: { in: users.map((u) => u.id) } } });
  if (course) {
    await prisma.artifactEdit.deleteMany({ where: { entityType: "lang_lesson", entityId: { in: [...course.unit0, course.unit1] } } });
    await prisma.languageCourse.deleteMany({ where: { curriculumId: course.curriculumId } });
    await prisma.langClass.deleteMany({ where: { curriculumId: course.curriculumId } });
    await prisma.langCurriculum.deleteMany({ where: { id: course.curriculumId } });
  }
  await prisma.$disconnect();
}
