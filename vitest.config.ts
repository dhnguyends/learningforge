import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
  test: {
    environment: "node",
    include: ["tests/unit/**/*.test.ts", "tests/api/**/*.test.ts"],
    testTimeout: 30_000,
    // API tests share one development database (accounts, admin settings), so
    // test files run one at a time: global rules such as "last administrator"
    // or the stored AI model must not see another file's half-finished state.
    fileParallelism: false,
    hookTimeout: 30_000,
    env: {
      // API tests exercise real route handlers against the local database.
      // Everything else defaults to offline/mock providers (see src/lib/env.ts).
      DATABASE_URL:
        process.env.DATABASE_URL ?? "postgresql://lectureforge:lectureforge@localhost:5433/lectureforge?schema=public",
      NODE_ENV: "test",
      QUEUE_DRIVER: "inline",
      STORAGE_DRIVER: "local",
      AI_PROVIDER: "mock",
      EMBEDDINGS_PROVIDER: "mock",
      TRANSCRIPTION_PROVIDER: "mock",
      TTS_PROVIDER: "mock",
    },
  },
});
