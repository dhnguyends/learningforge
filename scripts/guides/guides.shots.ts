import path from "node:path";
import { mkdirSync } from "node:fs";
import bcrypt from "bcryptjs";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { test, expect, type Browser, type BrowserContext, type Locator, type Page } from "@playwright/test";
import { signInAsDemo } from "../../tests/e2e/helpers";

/**
 * Screenshots for docs/USER-GUIDE.md and docs/ADMIN-GUIDE.md.
 *
 * - Studying: the seeded demo account (a Bot) and its "Backpropagation &
 *   Optimization" study set.
 * - PolyLingue, teaching and administration: temporary accounts made for
 *   this run (a Bot learner; a teacher and an administrator, which must be
 *   Human accounts) on courses that are already written. They are deleted at
 *   the end, with everything they created.
 * - Other people's names and email addresses are replaced on screen before a
 *   capture, so no real account appears in the guides.
 *
 * Run: npm run guides:screenshots (against the running dev server).
 */
const prisma = new PrismaClient();
const OUT = path.resolve("docs/images");
const PASSWORD = "guide-" + randomUUID().slice(0, 12);
const STUDY_SET = "Backpropagation & Optimization";
const failures: string[] = [];

type Account = { id: string; email: string; name: string };
const made: Account[] = [];
/** Real accounts' names and emails → placeholders, applied before each capture. */
let disguise: [string, string][] = [];

async function account(name: string, email: string, role: "USER" | "TEACHER" | "ADMIN"): Promise<Account> {
  await prisma.user.deleteMany({ where: { email } }); // a previous run that stopped early
  const user = await prisma.user.create({
    data: { email, name, role, nature: role === "USER" ? "BOT" : "HUMAN", passwordHash: await bcrypt.hash(PASSWORD, 4) },
  });
  await prisma.workspace.create({ data: { name: `${name} workspace`, ownerId: user.id, members: { create: { userId: user.id, role: "OWNER" } } } });
  const a = { id: user.id, email, name };
  made.push(a);
  return a;
}

async function signedIn(browser: Browser, baseURL: string, who: Account): Promise<{ ctx: BrowserContext; page: Page }> {
  const ctx = await browser.newContext({
    storageState: "test-results/.auth/access.json",
    ignoreHTTPSErrors: true,
    baseURL,
    viewport: { width: 1280, height: 800 },
    colorScheme: "light",
    permissions: ["microphone"],
  });
  const csrf = await ctx.request.get("/api/auth/csrf");
  const { csrfToken } = (await csrf.json()) as { csrfToken: string };
  const res = await ctx.request.post("/api/auth/callback/credentials", { form: { email: who.email, password: PASSWORD, csrfToken, json: "true" } });
  expect(res.status(), `sign-in of ${who.name}`).toBe(200);
  return { ctx, page: await ctx.newPage() };
}

/** Waits for data and loading placeholders, and closes a "new badge" dialog. */
async function settle(page: Page, waitMs = 60_000) {
  await page.waitForLoadState("networkidle", { timeout: waitMs }).catch(() => undefined);
  await page.waitForFunction(() => !document.querySelector(".animate-pulse"), null, { timeout: waitMs }).catch(() => undefined);
  const great = page.getByRole("button", { name: "Great!" });
  if (await great.isVisible().catch(() => false)) await great.click();
  await page.waitForTimeout(700);
}

async function hideRealPeople(page: Page) {
  if (!disguise.length) return;
  await page.evaluate((pairs) => {
    const swap = (s: string) => pairs.reduce((t, [from, to]) => t.split(from).join(to), s);
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const v = n.nodeValue ?? "";
      const w = swap(v);
      if (w !== v) n.nodeValue = w;
    }
    document.querySelectorAll("input, textarea").forEach((el) => {
      const i = el as HTMLInputElement;
      const w = swap(i.value);
      if (w !== i.value) i.value = w;
    });
    document.querySelectorAll("[title]").forEach((el) => el.setAttribute("title", swap(el.getAttribute("title") ?? "")));
  }, disguise);
}

/** Hides the smallest box (card, banner) holding one of these texts: other people's course titles. */
async function hideBoxes(page: Page, texts: string[]) {
  await page.evaluate((needles) => {
    for (const needle of needles) {
      // The deepest elements holding the text (it may be split across children, e.g. a quoted title).
      const holders = [...document.querySelectorAll<HTMLElement>("body *")].filter((el) => el.textContent?.includes(needle));
      const hits = holders.filter((el) => ![...el.children].some((c) => c.textContent?.includes(needle)));
      for (const hit of hits) {
        const box = hit.closest<HTMLElement>("[class*='rounded-lg'], [class*='rounded-md'][class*='border']");
        if (box) box.style.display = "none";
      }
    }
  }, texts);
}

async function shot(page: Page, file: string, opts: { full?: boolean; of?: Locator; settleFirst?: boolean; hide?: string[] } = {}) {
  if (opts.settleFirst !== false) await settle(page);
  if (opts.hide) await hideBoxes(page, opts.hide);
  await hideRealPeople(page);
  const target = path.join(OUT, file);
  if (opts.of) await opts.of.screenshot({ path: target });
  else await page.screenshot({ path: target, fullPage: Boolean(opts.full) });
  console.log("  shot", file);
}

const ONLY = process.env.GUIDE_ONLY ? new RegExp(process.env.GUIDE_ONLY, "i") : null;

/** One screen: a failure is logged and the run goes on. GUIDE_ONLY (a pattern) retakes only matching screens. */
async function step(name: string, fn: () => Promise<void>) {
  if (ONLY && !ONLY.test(name)) return;
  try {
    await fn();
  } catch (err) {
    failures.push(`${name}: ${err instanceof Error ? err.message.split("\n")[0] : String(err)}`);
    console.log("  FAILED", name);
  }
}

test.beforeAll(async () => {
  mkdirSync(path.join(OUT, "user"), { recursive: true });
  mkdirSync(path.join(OUT, "admin"), { recursive: true });
  const real = await prisma.user.findMany({
    where: { NOT: [{ email: { endsWith: "@learningforge.app" } }, { email: { endsWith: "@guide.test" } }, { email: { startsWith: "e2e-" } }] },
    select: { name: true, email: true },
    orderBy: { createdAt: "asc" },
  });
  const stand = [
    ["Alex Martin", "alex.martin@example.com"],
    ["Sam Lee", "sam.lee@example.com"],
    ["Jordan Diaz", "jordan.diaz@example.com"],
    ["Robin Patel", "robin.patel@example.com"],
  ];
  disguise = real.flatMap((u, i) => {
    const [n, e] = stand[i % stand.length];
    return [[u.email, e], ...(u.name ? [[u.name, n] as [string, string]] : [])] as [string, string][];
  });
  // Longest first, so a name inside an email is not replaced on its own.
  disguise.sort((a, b) => b[0].length - a[0].length);
});

test.afterAll(async () => {
  const ids = made.map((a) => a.id);
  await prisma.auditLog.deleteMany({ where: { userId: { in: ids } } });
  await prisma.langClass.deleteMany({ where: { teacherId: { in: ids } } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
  await prisma.$disconnect();
  console.log(failures.length ? `\nScreens that failed:\n- ${failures.join("\n- ")}` : "\nAll screens captured.");
});

test("user guide: signing in and studying", async ({ browser, baseURL }) => {
  // The sign-in page, before any session.
  await step("sign-in", async () => {
    const ctx = await browser.newContext({ storageState: "test-results/.auth/access.json", ignoreHTTPSErrors: true, baseURL, viewport: { width: 1280, height: 800 } });
    const page = await ctx.newPage();
    await page.goto("/auth/sign-in");
    await shot(page, "user/02-sign-in.png");
    await ctx.close();
  });

  const ctx = await browser.newContext({ storageState: "test-results/.auth/access.json", ignoreHTTPSErrors: true, baseURL, viewport: { width: 1280, height: 800 }, colorScheme: "light" });
  const page = await ctx.newPage();
  await signInAsDemo(page);

  await step("dashboard", async () => {
    await page.goto("/dashboard");
    await expect(page.getByRole("link", { name: new RegExp(STUDY_SET) }).first()).toBeVisible();
    await shot(page, "user/03-dashboard.png");
  });
  await step("create", async () => {
    await page.goto("/create");
    await page.getByLabel(/^Title/).fill("Lecture 7 — Convolutional networks");
    await page.getByLabel("Course code").fill("CS 583 — Deep Learning");
    await page.getByLabel("Keywords").fill("convolution, pooling, CNN");
    await shot(page, "user/04-new-study-set.png");
  });

  await page.goto("/dashboard");
  await page.getByRole("link", { name: new RegExp(STUDY_SET) }).first().click();
  await page.waitForURL(/\/study-sets\/[^/]+$/);
  const setUrl = new URL(page.url()).pathname;

  await step("overview", async () => {
    await expect(page.getByRole("heading", { name: new RegExp(STUDY_SET) })).toBeVisible();
    await shot(page, "user/05-study-set.png");
  });
  await step("sources", async () => {
    await page.goto(`${setUrl}/sources`);
    await shot(page, "user/06-sources.png");
  });
  await step("transcript", async () => {
    await page.goto(`${setUrl}/transcript`);
    await shot(page, "user/08-transcript.png");
  });
  await step("guide", async () => {
    await page.goto(`${setUrl}/guide`);
    await expect(page.getByText("Computational graph").first()).toBeVisible();
    await shot(page, "user/09-study-guide.png");
  });
  await step("flashcards", async () => {
    await page.goto(`${setUrl}/flashcards`);
    await shot(page, "user/10-flashcards.png");
    const review = page.getByRole("button", { name: /review \d+ due/i }).first();
    if (await review.isVisible().catch(() => false)) {
      await review.click();
      await page.getByRole("button", { name: /show answer/i }).click();
      await shot(page, "user/11-flashcard-review.png");
    }
  });
  await step("quiz", async () => {
    await page.goto(`${setUrl}/quiz`);
    await shot(page, "user/12-quiz.png");
    await page.getByRole("button", { name: "Take quiz" }).click();
    await shot(page, "user/13-quiz-question.png");
  });
  await step("exercises", async () => {
    await page.goto(`${setUrl}/exercises`);
    await shot(page, "user/14-exercises.png");
    await page.getByRole("button", { name: "Work on set" }).first().click();
    await shot(page, "user/14b-exercise.png");
  });
  await step("tutor", async () => {
    // The demo account's seeded conversation: no AI call, nothing added to the account.
    await page.goto(`${setUrl}/tutor`);
    await settle(page, 120_000);
    await page.getByRole("button", { name: "Why is backprop 'cheap'?" }).click({ timeout: 60_000 });
    await shot(page, "user/15-tutor.png");
  });
  await step("analytics", async () => {
    await page.goto(`${setUrl}/analytics`);
    await settle(page, 180_000);
    await shot(page, "user/16-analytics.png");
  });
  await step("explore", async () => {
    await page.goto("/explore");
    await shot(page, "user/17-explore.png");
  });
  await step("settings", async () => {
    await page.goto("/settings");
    await shot(page, "user/18-settings.png");
  });
  await ctx.close();
});

test("user and admin guides: PolyLingue, teaching and administration", async ({ browser, baseURL }) => {
  const spanish = await prisma.langCurriculum.findFirstOrThrow({ where: { targetLang: "es", baseLang: "en", level: "A1", status: "READY" } });
  const english = await prisma.langCurriculum.findFirstOrThrow({ where: { targetLang: "en", baseLang: "fr", level: "A2", status: "READY" } });
  const learner = await account("Maya Chen", "maya.chen@guide.test", "USER");
  const teacher = await account("Ms. Rivera", "teacher.rivera@guide.test", "TEACHER");
  const admin = await account("Alex Admin", "admin@guide.test", "ADMIN");
  const es = await prisma.languageCourse.create({ data: { userId: learner.id, targetLang: "es", baseLang: "en", level: "A1", curriculumId: spanish.id, timeZone: "UTC" } });
  const en = await prisma.languageCourse.create({ data: { userId: learner.id, targetLang: "en", baseLang: "fr", level: "A2", curriculumId: english.id, timeZone: "UTC" } });

  const { page } = await signedIn(browser, baseURL!, learner);

  await step("polylingue home", async () => {
    await page.goto("/polylingue");
    await shot(page, "user/20-polylingue-home.png");
  });
  await step("add a language", async () => {
    await page.getByRole("link", { name: "Add a language" }).click();
    await shot(page, "user/21-add-language.png");
  });
  await step("course", async () => {
    await page.goto(`/polylingue/${es.id}`);
    await shot(page, "user/22-course.png");
  });
  await step("lesson", async () => {
    const first = await prisma.langLesson.findFirstOrThrow({ where: { curriculumId: spanish.id, status: "READY" }, orderBy: { ordinal: "asc" } });
    await page.goto(`/polylingue/${es.id}/lesson/${first.id}`);
    await shot(page, "user/23-lesson-start.png");
    await page.getByRole("button", { name: /Start the \d+ exercises/ }).click({ timeout: 90_000 });
    await shot(page, "user/24-lesson-exercise.png");
    // Answer with the first option (numbered "1 …").
    await page.getByRole("button", { name: /^1\s/ }).first().click();
    await page.getByRole("button", { name: "Check", exact: true }).click();
    await expect(page.getByRole("button", { name: /^(Continue|Finish)/ })).toBeVisible({ timeout: 60_000 });
    await shot(page, "user/25-lesson-feedback.png");
  });
  await step("change level", async () => {
    await page.goto("/polylingue");
    await settle(page);
    const entry = page.getByRole("navigation", { name: "PolyLingue" }).getByRole("link", { name: /· A1$/ });
    await entry.click({ button: "right" });
    await page.waitForTimeout(400);
    await shot(page, "user/26-language-menu.png", { settleFirst: false });
    await page.getByRole("menuitem", { name: "Change level…" }).click();
    await expect(page.getByRole("dialog").getByText("Change level")).toBeVisible();
    await expect(page.getByRole("dialog").getByText(/Loading the levels/)).toBeHidden({ timeout: 90_000 });
    await page.waitForTimeout(800);
    await shot(page, "user/27-change-level.png", { settleFirst: false });
    await page.keyboard.press("Escape");
  });
  await step("speaking", async () => {
    const speaking = await prisma.langPractice.findFirstOrThrow({ where: { curriculumId: english.id, skill: "SPEAKING", status: "READY" } });
    await page.goto(`/polylingue/${en.id}/practice/speaking/${speaking.id}`);
    await shot(page, "user/28-speaking.png");
    await page.getByRole("button", { name: "Micro settings" }).click();
    await page.waitForTimeout(1500);
    await shot(page, "user/29-micro-settings.png", { settleFirst: false });
    await page.keyboard.press("Escape");
  });
  await step("reading", async () => {
    const reading = await prisma.langPractice.findFirstOrThrow({ where: { curriculumId: english.id, skill: "READING", status: "READY" } });
    await page.goto(`/polylingue/${en.id}/practice/reading/${reading.id}`);
    await shot(page, "user/30-reading.png");
  });
  for (const [name, url, file] of [
    ["practice menu", `/polylingue/${en.id}/practice/speaking`, "user/31-practice-list.png"],
    ["progress", `/polylingue/${es.id}/progress`, "user/32-progress.png"],
    ["review", `/polylingue/${es.id}/review`, "user/33-review.png"],
    ["badges", "/polylingue/achievements", "user/34-badges.png"],
    ["leagues", "/polylingue/leagues", "user/35-leagues.png"],
    ["summary", "/polylingue/summary", "user/36-weekly-summary.png"],
    ["reminders", "/polylingue/reminders", "user/37-reminders.png"],
  ] as const) {
    await step(name, async () => {
      await page.goto(url);
      await shot(page, file);
    });
  }

  // Teaching: the teacher creates a class, the learner joins it.
  const t = await signedIn(browser, baseURL!, teacher);
  let code = "";
  let classPath = "";
  await step("teach new class", async () => {
    await t.page.goto("/polylingue/teach");
    await shot(t.page, "admin/20-teaching.png");
    await t.page.getByRole("button", { name: "New class" }).click();
    await t.page.getByLabel("Name").fill("Spanish 1 — Tuesday group");
    await t.page.getByLabel("Language taught").selectOption("es");
    await t.page.getByLabel("Level").selectOption("A1");
    await t.page.getByLabel("Explanations in").selectOption("en");
    await t.page.getByLabel("Minutes a week").fill("45");
    await shot(t.page, "admin/21-new-class.png", { settleFirst: false });
    await t.page.getByRole("button", { name: "Create the class" }).click();
    await t.page.waitForURL(/\/polylingue\/teach\/[a-z0-9]+$/, { timeout: 60_000 });
    classPath = new URL(t.page.url()).pathname;
    code = (await t.page.getByTitle("Copy the code for your students").innerText({ timeout: 60_000 })).trim();
  });
  await step("join class", async () => {
    await page.goto("/polylingue/classes");
    await shot(page, "user/38-my-classes.png");
    await page.getByRole("button", { name: "Join a class" }).click();
    await page.getByLabel("Class code").fill(code);
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page.getByRole("dialog").getByText(/Your teacher sees your activity/)).toBeVisible();
    await shot(page, "user/39-join-class.png", { settleFirst: false });
    await page.getByRole("button", { name: "Join the class" }).click();
    await page.waitForURL((url) => /\/polylingue\/[a-z0-9]{20,}$/.test(url.pathname), { timeout: 60_000 });
  });
  await step("class dashboard", async () => {
    await t.page.goto(classPath);
    await shot(t.page, "admin/22-class-students.png");
    await t.page.getByRole("tab", { name: /Assignments/ }).click();
    await t.page.getByRole("button", { name: "Assign work" }).click();
    await t.page.getByRole("radio").first().check({ timeout: 30_000 });
    await t.page.getByLabel("Note (optional)").fill("Before Friday's class");
    await shot(t.page, "admin/23-assign-work.png", { settleFirst: false });
    await t.page.getByRole("button", { name: "Assign", exact: true }).click();
    await expect(t.page.getByRole("tab", { name: "Assignments (1)" })).toBeVisible({ timeout: 60_000 });
    await shot(t.page, "admin/24-class-assignments.png");
    await t.page.getByRole("tab", { name: /Common difficulties/ }).click();
    await shot(t.page, "admin/25-class-difficulties.png");
  });
  await t.ctx.close();

  // Administration.
  const a = await signedIn(browser, baseURL!, admin);
  const tab = async (name: string) => {
    await a.page.goto("/admin");
    await settle(a.page);
    await a.page.getByRole("tab", { name, exact: true }).click();
  };
  await step("admin users", async () => {
    await tab("Users");
    await shot(a.page, "admin/01-users.png");
  });
  await step("admin ai", async () => {
    await tab("AI model");
    await settle(a.page, 180_000);
    // The GPU memory panel loads after the cards.
    await a.page.getByRole("region", { name: "GPU memory" }).waitFor({ timeout: 60_000 }).catch(() => undefined);
    await shot(a.page, "admin/02-ai-model.png", { full: true });
  });
  await step("admin courses", async () => {
    await tab("Courses");
    await settle(a.page, 180_000);
    // Only the demo account's courses (other people's titles stay private).
    await a.page.getByPlaceholder("Search courses or owners").fill("Demo");
    await shot(a.page, "admin/03-courses.png", { hide: ["is empty (no sources)"] });
  });
  await step("admin tree", async () => {
    await tab("Courses Tree");
    await settle(a.page, 180_000);
    // Collapsed: the disciplines only, no course titles.
    await a.page.getByRole("button", { name: "Collapse all" }).click();
    await shot(a.page, "admin/04-courses-tree.png", { hide: ["Not in the tree yet"] });
  });
  for (const [sub, file] of [
    ["Content", "admin/05-polylingue-content.png"],
    ["Reports", "admin/06-polylingue-reports.png"],
    ["Analytics", "admin/07-polylingue-analytics.png"],
    ["Voices & audio", "admin/08-polylingue-voices.png"],
  ] as const) {
    await step(`admin polylingue ${sub}`, async () => {
      await tab("PolyLingue");
      await settle(a.page);
      await a.page.getByRole("tab", { name: new RegExp(`^${sub.replace("&", "&")}`) }).click();
      await shot(a.page, file);
    });
  }
  await step("admin lesson review", async () => {
    const lesson = await prisma.langLesson.findFirstOrThrow({ where: { curriculumId: spanish.id, status: "READY" }, orderBy: { ordinal: "asc" } });
    await a.page.goto(`/admin/polylingue/${lesson.id}`);
    await shot(a.page, "admin/09-lesson-review.png");
  });
  await step("admin database", async () => {
    await tab("Database");
    await settle(a.page, 180_000);
    await shot(a.page, "admin/10-database.png");
  });
  await a.ctx.close();
});
