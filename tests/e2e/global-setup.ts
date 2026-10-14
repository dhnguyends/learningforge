import { request, type FullConfig } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { e2eAccessKey } from "./access-key";

export const ACCESS_STATE = path.join("test-results", ".auth", "access.json");

/**
 * The site is behind LECTURE_ACCESS_KEY: unlock once and hand every test the
 * access cookie via storageState (an empty state when the gate is off).
 */
export default async function globalSetup(config: FullConfig) {
  mkdirSync(path.dirname(ACCESS_STATE), { recursive: true });
  const key = e2eAccessKey();
  if (!key) {
    writeFileSync(ACCESS_STATE, JSON.stringify({ cookies: [], origins: [] }));
    return;
  }
  const baseURL = config.projects[0]?.use.baseURL;
  const ctx = await request.newContext({ baseURL });
  const res = await ctx.post("/api/access", { data: { key } });
  if (!res.ok()) throw new Error(`Could not unlock the access gate for E2E: HTTP ${res.status()}`);
  await ctx.storageState({ path: ACCESS_STATE });
  await ctx.dispose();
}
