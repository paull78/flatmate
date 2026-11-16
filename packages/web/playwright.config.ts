import { execFileSync } from "node:child_process";
import { copyFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, devices } from "@playwright/test";
import { SERVER_PORT } from "./e2e/support/server";

// A fresh data directory per run for the collaboration test's server. Port 8788 leaves 8787 to `pnpm dev:server`;
// E2E_SERVER_PORT moves it, as E2E_WEB_PORT moves the web server (e2e/support/server.ts reads the same variable).
// Playwright also loads this file in its workers; the extra empty temp directories they create are harmless.
const dataDir = mkdtempSync(join(tmpdir(), "fm-e2e-"));
// A project saved before the furnish cycle (no `zones`), for zones.spec.ts. Each worker copies it into its own unused
// temp directory too, which is as harmless as the directories themselves.
copyFileSync(fileURLToPath(new URL("./e2e/fixtures/pre-furnish-project.json", import.meta.url)), join(dataDir, "pre-furnish.json"));
// Seeds go into the server's data directory before the servers start, by spawning the server's own scripts (the web
// package never imports the server); only in the main process, which marks the environment so its workers don't. The
// furnished sample Studio always (parts step 10: the flip with the 3D panel open; real3d step 12: WebGL against look);
// the 50 × 50 grid only with FM_PERF=1 (perf.spec.ts, graphics step 02).
if (!process.env.FM_E2E_SEEDED) {
  if (process.env.FM_PERF) {
    execFileSync("pnpm", ["--filter", "@fm/server", "exec", "tsx", "scripts/run-seed-grid.ts", "50"], {
      env: { ...process.env, DATA_DIR: dataDir },
      stdio: "inherit",
    });
  }
  execFileSync("pnpm", ["--filter", "@fm/server", "exec", "tsx", "scripts/run-seed-studio.ts"], { env: { ...process.env, DATA_DIR: dataDir }, stdio: "inherit" });
  process.env.FM_E2E_SEEDED = dataDir;
}
// E2E_WEB_PORT lets a second checkout run e2e while another dev server holds 5173 (tooling.md, arch-review.18).
const webPort = process.env.E2E_WEB_PORT ?? "5173";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  retries: 0,
  use: {
    baseURL: `http://localhost:${webPort}`,
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command: `pnpm exec vite --port ${webPort} --strictPort`,
      url: `http://localhost:${webPort}`,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
    {
      command: "pnpm --filter @fm/server start",
      port: Number(SERVER_PORT),
      reuseExistingServer: false,
      timeout: 60_000,
      env: { PORT: SERVER_PORT, DATA_DIR: dataDir },
    },
  ],
});
