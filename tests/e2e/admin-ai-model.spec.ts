import { test, expect } from "@playwright/test";
import { createAccount, contextFor, prisma, type E2EUser } from "./polylingue-fixtures";

/**
 * Admin › AI model on the real machine: the installed Ollama models are
 * offered (DeepSeek-R1 included), "Test connection" loads DeepSeek alone on
 * the GPU (the other models unloaded first), and "Free GPU memory" empties
 * it. The stored model choice is never changed ("Use this model" is not
 * clicked). Skipped when Ollama or deepseek-r1:8b is not there.
 */
const BASE = process.env.E2E_BASE_URL ?? "https://localhost:3001";
const OLLAMA = process.env.LOCAL_AI_BASE_URL ?? "http://localhost:11434";
let admin: E2EUser;
let ready = false;

test.beforeAll(async () => {
  const tags = (await fetch(`${OLLAMA}/api/tags`).then((r) => r.json(), () => null)) as { models?: { name: string }[] } | null;
  ready = Boolean(tags?.models?.some((m) => m.name === "deepseek-r1:8b"));
  admin = await createAccount("E2E AI admin", "ADMIN");
});

test.afterAll(async () => {
  await prisma.auditLog.deleteMany({ where: { userId: admin.id } });
  await prisma.user.deleteMany({ where: { id: admin.id } });
  await prisma.$disconnect();
});

test("DeepSeek-R1 runs alone on the GPU, and the GPU can be freed", async ({ browser }) => {
  test.skip(!ready, "Ollama with deepseek-r1:8b is not available");
  test.setTimeout(6 * 60_000);
  const storedBefore = await prisma.appSetting.findUnique({ where: { key: "ai" }, select: { value: true, updatedAt: true } });
  // Gemma 4 in memory, as on a busy server.
  await fetch(`${OLLAMA}/api/generate`, { method: "POST", body: JSON.stringify({ model: "gemma4:latest" }) });

  const { ctx, page } = await contextFor(browser, BASE, admin);
  await page.goto("/admin");
  await page.getByRole("tab", { name: "AI model" }).click();
  const deepseek = page.getByRole("radio", { name: /DeepSeek-R1 8B — local \(deepseek-r1:8b\)/ });
  await expect(deepseek).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole("radio", { name: /Gemma 4 — local \(gemma4:latest\)/ })).toBeVisible();
  // Embeddings-only models are not offered.
  await expect(page.getByRole("radio", { name: /embeddinggemma/ })).toHaveCount(0);

  const gpu = page.getByRole("region", { name: "GPU memory" });
  await expect(gpu).toContainText("gemma4:latest", { timeout: 20_000 });

  await deepseek.check();
  await page.getByRole("button", { name: "Test connection" }).click();
  await expect(page.getByText(/deepseek-r1:8b answered in/)).toBeVisible({ timeout: 5 * 60_000 });
  // Gemma 4 was unloaded before DeepSeek ran.
  // Model names only: Ollama misreports some models' sizes, so the panel does not show them.
  await expect(gpu).toContainText(/In Ollama now: deepseek-r1:8b\./, { timeout: 20_000 });
  await expect(gpu).not.toContainText("gemma4:latest");
  await page.screenshot({ path: "test-results/admin-ai-deepseek.png", fullPage: true });

  await gpu.getByRole("button", { name: "Free GPU memory" }).click();
  await expect(gpu.getByRole("status")).toContainText(/Unloaded deepseek-r1:8b/, { timeout: 30_000 });
  await expect(gpu).toContainText("No Ollama model in memory", { timeout: 20_000 });
  const ps = (await fetch(`${OLLAMA}/api/ps`).then((r) => r.json())) as { models: unknown[] };
  expect(ps.models).toEqual([]);

  // The stored model choice is untouched.
  expect(await prisma.appSetting.findUnique({ where: { key: "ai" }, select: { value: true, updatedAt: true } })).toEqual(storedBefore);
  await ctx.close();
});
