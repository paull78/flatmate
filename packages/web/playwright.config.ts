import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig, devices } from "@playwright/test";

// A fresh data directory per run for the collaboration test's server. Port 8788 leaves 8787 to `pnpm dev:server`.
// Playwright also loads this file in its workers; the extra empty temp directories they create are harmless.
const dataDir = mkdtempSync(join(tmpdir(), "fm-e2e-"));

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  retries: 0,
  use: {
    baseURL: "http://localhost:5173",
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command: "pnpm exec vite --port 5173 --strictPort",
      url: "http://localhost:5173",
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
    {
      command: "pnpm --filter @fm/server start",
      port: 8788,
      reuseExistingServer: false,
      timeout: 60_000,
      env: { PORT: "8788", DATA_DIR: dataDir },
    },
  ],
});
