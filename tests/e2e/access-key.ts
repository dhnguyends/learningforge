import { readFileSync, existsSync } from "node:fs";
import path from "node:path";

/** LECTURE_ACCESS_KEY for E2E: the process env, else the project's .env (null = gate off). */
export function e2eAccessKey(): string | null {
  const fromEnv = process.env.LECTURE_ACCESS_KEY?.trim();
  if (fromEnv) return fromEnv;
  const file = path.join(process.cwd(), ".env");
  if (!existsSync(file)) return null;
  const line = readFileSync(file, "utf8").split(/\r?\n/).find((l) => /^\s*LECTURE_ACCESS_KEY\s*=/.test(l));
  const value = line?.replace(/^\s*LECTURE_ACCESS_KEY\s*=\s*/, "").trim().replace(/^["']|["']$/g, "");
  return value ? value : null;
}
