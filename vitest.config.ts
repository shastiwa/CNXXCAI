import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  test: {
    include: ["tests/**/*.test.ts"],
    fileParallelism: false,
    globalSetup: ["tests/global-setup.ts"],
    env: {
      DATABASE_URL: "file:./test.db",
      SESSION_SECRET: "test-secret-test-secret-test-secret-123",
      HELIX_WEBHOOK_SECRET: "test-webhook-secret",
      APP_BASE_URL: "http://localhost:3000",
      HELIX_MODE: "mock",
      BWF_MODE: "mock",
    },
  },
});
