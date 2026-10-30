import { defineConfig, devices } from "@playwright/test";

/**
 * The display proof's own runner, for the reason `playwright.rebuild.config.ts`
 * is the rebuild's: it needs one editor preview on one port, and it starts a
 * real host itself.
 *
 * `playwright.config.ts` boots 4173/4174/4175 and the shared host, which every
 * other agent and the root session also uses. Two agents on one preview is how
 * a pass ends up screenshotting somebody else's theme — which the plan records
 * as having already happened twice.
 *
 * The host is **not** a `webServer` here: its themes directory is written by the
 * test, from the package the editor's own Save control produced, so it cannot
 * exist before the test runs.
 */
const EDITOR_PORT = 4223;

export default defineConfig({
  testDir: "./tests/e2e",
  // Its own artifact dir, for the reason playwright.config.ts states (vg-216).
  outputDir: "test-results/display",
  testMatch: /author-journey-display\.spec\.ts/,
  retries: 0,
  // One document, one editor, and the editor global's `N` is per instance.
  workers: 1,
  fullyParallel: false,
  reporter: [["list"]],

  use: {
    baseURL: `http://127.0.0.1:${EDITOR_PORT}`,
    // A desktop surface: `tests/e2e/surface.ts` records that the editor is
    // desktop-only. A phone is a *display*, driven by `setViewportSize` below.
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

  projects: [{ name: "display" }],
});
