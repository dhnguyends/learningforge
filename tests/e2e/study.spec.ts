import { test, expect } from "@playwright/test";
import { signInAsDemo, openSeededStudySet } from "./helpers";

// The dev server compiles each route on first visit (seconds on Windows), so
// every navigation-triggered assertion gets a generous explicit timeout.

test.describe("flashcard review loop", () => {
  test("reviews a due card end-to-end: reveal, grade, advance", async ({ page }) => {
    await signInAsDemo(page);
    await openSeededStudySet(page);

    await page.getByRole("link", { name: "open flashcards" }).click();
    await expect(page).toHaveURL(/\/flashcards$/, { timeout: 20_000 });

    // Seeded deck with overdue cards.
    const reviewButton = page.getByRole("button", { name: /review \d+ due/i }).first();
    await expect(reviewButton).toBeVisible({ timeout: 20_000 });
    await reviewButton.click();

    // First card of the due queue.
    await expect(page.getByRole("button", { name: /show answer/i })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(/1 \/ \d+/)).toBeVisible();

    // Reveal → answer + source citation appear.
    await page.getByRole("button", { name: /show answer/i }).click();
    await expect(page.getByRole("button", { name: "Again" })).toBeVisible();
    await expect(page.getByText(/^Source$/)).toBeVisible(); // citation section

    // Grade Good (button's accessible name is "Good 3 — recalled") → next card or completion.
    await page.getByRole("button", { name: "Good" }).click();
    // Case-insensitive: the UI renders "Session complete", and the queue may
    // hold a single due card when earlier runs have graded the others.
    await expect(page.getByText(/session complete|2 \/ \d+/i)).toBeVisible({ timeout: 15_000 });
  });
});

test.describe("study guide", () => {
  test("renders seeded sections with citation chips", async ({ page }) => {
    await signInAsDemo(page);
    await openSeededStudySet(page);

    await page.getByRole("link", { name: "open study guide" }).click();
    await expect(page).toHaveURL(/\/guide$/, { timeout: 20_000 });

    // Definition section title from the seed + chain-rule content.
    await expect(page.getByText("Computational graph").first()).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(/chain rule/i).first()).toBeVisible();
  });
});

test.describe("quiz", () => {
  test("takes the seeded quiz, answers one question, and grades server-side", async ({ page }) => {
    await signInAsDemo(page);
    await openSeededStudySet(page);

    await page.getByRole("link", { name: "open quiz" }).click();
    await expect(page).toHaveURL(/\/quiz$/, { timeout: 20_000 });

    await page.getByRole("button", { name: "Take quiz" }).click();

    // The seeded quiz's first question is multiple choice about backprop.
    await expect(page.getByText(/Backpropagation computes gradients by/i).first()).toBeVisible({ timeout: 20_000 });
    // Options are labels wrapping radios, so the option text is the radio's name.
    await page.getByRole("radio", { name: /chaining vector-Jacobian products/i }).click();

    // Ordering-type questions come pre-seeded with a shuffled order, so the
    // answered count includes them — match any "Submit (n/8)".
    await page.getByRole("button", { name: /submit \(\d+\/8\)/i }).click();

    // Results: the answered MC question is graded correct; the count line and
    // percentage render. (Blank questions grade incorrect server-side.)
    await expect(page.getByText(/\d+\/8 correct/)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText("Correct", { exact: true }).first()).toBeVisible();
    await expect(page.locator("p", { hasText: /^\d+%$/ })).toBeVisible();
  });
});

test.describe("source processing status bar", () => {
  test("shows the pipeline phases for a mid-ingestion source", async ({ page }) => {
    await signInAsDemo(page);
    await page.goto("/dashboard");
    await page.getByRole("link", { name: /Graph Neural Networks/ }).first().click();
    await expect(page).toHaveURL(/\/study-sets\/[^/]+$/, { timeout: 20_000 });
    const studySetId = page.url().split("/").pop()!;
    await page.goto(`/study-sets/${studySetId}/sources`);

    // The seeded GNN source is stuck PROCESSING at stage "transcribing" (55%),
    // which maps to the "Extracting text" phase of the status bar.
    const bar = page.locator('[role="status"][data-phase="extracting"]');
    await expect(bar).toBeVisible({ timeout: 20_000 });
    await expect(bar).toHaveAccessibleName(/extracting text — 55%/i);

    // All five phases render, uploading done, later ones still pending.
    await expect(bar.getByText("Uploading")).toBeVisible();
    await expect(bar.getByText("Chunking")).toBeVisible();
    await expect(bar.getByText("Vectorizing")).toBeVisible();
    await expect(bar.getByText("Indexing")).toBeVisible();
    await expect(bar.locator("svg.lucide-check")).toBeVisible(); // uploading completed
  });
});
