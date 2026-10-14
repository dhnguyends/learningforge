import { test, expect } from "@playwright/test";

test.describe("public marketing surface", () => {
  test("landing page renders the pitch and routes to sign-in", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveTitle(/LearningForge/i);

    // Core promise is stated on the page.
    await expect(page.locator("h1").first()).toContainText(/turn|lecture/i);

    const signIn = page.getByRole("link", { name: "Sign in" }).first();
    await signIn.click();
    await expect(page).toHaveURL(/\/auth\/sign-in/);
    await expect(page.locator("#email")).toBeVisible();
  });

  test("unauthenticated dashboard visits bounce to sign-in", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/auth\/sign-in/);
  });

  test("wrong credentials are rejected with feedback", async ({ page }) => {
    await page.goto("/auth/sign-in");
    await page.fill("#email", "demo@learningforge.app");
    await page.fill("#password", "not-the-password");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByText(/invalid email or password/i)).toBeVisible();
    await expect(page).toHaveURL(/\/auth\/sign-in/);
  });
});
