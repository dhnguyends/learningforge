import type { Page } from "@playwright/test";
import { expect } from "@playwright/test";

/**
 * Sign in as the seeded demo account (prisma/seed.ts) and land on the
 * dashboard. Requires `npm run db:setup && npm run db:seed` to have run.
 */
export async function signInAsDemo(page: Page) {
  // Sign in via page.request (shares the browser context's cookie jar) instead
  // of driving the form: the dev-mode next-auth csrf race — the form mount
  // refetches the csrf token while the submit races it — intermittently (and
  // on non-default ports, reliably) bounces a *successful* authentication
  // back to the sign-in page. One csrf fetch + one immediate POST has no
  // window for that desync.
  const csrf = await page.request.get("/api/auth/csrf");
  const { csrfToken } = (await csrf.json()) as { csrfToken: string };
  const res = await page.request.post("/api/auth/callback/credentials", {
    form: { email: "demo@learningforge.app", password: "demo-password", csrfToken, json: true },
  });
  if (res.status() !== 200) {
    throw new Error(`credentials callback returned ${res.status()}`);
  }
  await page.goto("/dashboard");
  // A dev server compiles the dashboard on first visit — generous window.
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 20_000 });
}

/** Opens the seeded "Backpropagation & Optimization" study set from the dashboard. */
export async function openSeededStudySet(page: Page) {
  await page.goto("/dashboard");
  await page.getByRole("link", { name: /Backpropagation & Optimization/ }).first().click();
  await expect(page).toHaveURL(/\/study-sets\/[^/]+$/, { timeout: 20_000 });
  // Wait for client data to land (React Query fetch after first paint) so the
  // tool cards and source strip exist before callers click into them.
  await expect(
    page.getByRole("heading", { name: /Backpropagation & Optimization/i }),
  ).toBeVisible({ timeout: 20_000 });
}
