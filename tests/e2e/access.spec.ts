import { test, expect } from "@playwright/test";
import { e2eAccessKey } from "./access-key";

const key = e2eAccessKey();

test.describe("access gate", () => {
  // A fresh visitor: none of the cookies the global setup prepared.
  test.use({ storageState: { cookies: [], origins: [] } });
  test.skip(!key, "LECTURE_ACCESS_KEY is not set — the gate is off");

  test("asks for the access key, rejects a wrong one, then lets the visitor in", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/access\?next=%2Fdashboard/);

    await page.getByLabel("Access key").fill("definitely-not-the-key");
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page.locator("#access-error")).toHaveText(/incorrect access key/i);

    await page.getByLabel("Access key").fill(key!);
    await page.getByRole("button", { name: "Continue" }).click();
    // Past the gate, the dashboard still requires signing in.
    await expect(page).toHaveURL(/\/auth\/sign-in/);
  });

  test("APIs refuse callers without the access cookie", async ({ request }) => {
    const res = await request.get("/api/auth/csrf", { headers: { cookie: "" } });
    expect(res.status()).toBe(401);
  });
});
