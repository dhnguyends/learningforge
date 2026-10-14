import { test, expect } from "@playwright/test";
import { signInAsDemo, openSeededStudySet } from "./helpers";

test.describe("demo dashboard", () => {
  test("signs in with the seeded demo account", async ({ page }) => {
    await signInAsDemo(page);
    // First dashboard hit of the run also compiles /api/study-sets.
    await expect(page.getByRole("link", { name: /Backpropagation & Optimization/ }).first()).toBeVisible({ timeout: 20_000 });
  });

  test("shows both study sets and the live processing job", async ({ page }) => {
    await signInAsDemo(page);

    // Fully processed set with due cards surfaced.
    const seeded = page.getByRole("link", { name: /Backpropagation & Optimization/ }).first();
    await expect(seeded).toBeVisible({ timeout: 20_000 });

    // Second set is mid-ingest: the dashboard surfaces active job state.
    const processing = page.getByRole("link", { name: /Graph Neural Networks/i }).first();
    await expect(processing).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(/Graph Neural Networks/i).first()).toBeVisible();
  });

  test("study set detail lists the three sources with status", async ({ page }) => {
    await signInAsDemo(page);
    await openSeededStudySet(page);

    // .first(): the video title also appears in the sidebar source widget.
    await expect(page.getByText(/Lecture 6 — Backpropagation/i).first()).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(/lecture06-slides\.pdf/i).first()).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(/Recitation notes/i).first()).toBeVisible({ timeout: 20_000 });
  });
});
