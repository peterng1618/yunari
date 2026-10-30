import { defineConfig, devices } from "@playwright/test";

/**
 * Task F's own runner, for the reason `playwright.rebuild.config.ts` states:
 * the shared config boots servers on 4173/4174/4185 that every other agent and
 * the root session also use, and a measurement is exactly the thing that goes
 * wrong when two of them share a preview. One server, on its own port, driving
 * nothing else.
 */
const EDITOR_PORT = 4219;

export default defineConfig({
  testDir: "./tests/e2e",
  // Its own artifact dir, for the reason playwright.config.ts states (vg-216).
  outputDir: "test-results/glass-shapes",
  testMatch: /glass-shapes-(budget|visual)\.spec\.ts/,
  retries: 0,
  // One measurement at a time. A second worker competing for the same CPU would
  // make every number here noise, which is the whole artifact.
  workers: 1,
  fullyParallel: false,
  reporter: [["list"]],

  use: {
    baseURL: `http://127.0.0.1:${EDITOR_PORT}`,
    ...devices["Desktop Chrome"],
    viewport: { width: 1680, height: 1000 },
    trace: "retain-on-failure",
  },

  webServer: {
    command: `npx vite preview packages/editor --port ${EDITOR_PORT} --strictPort --host 127.0.0.1`,
    url: `http://127.0.0.1:${EDITOR_PORT}`,
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
