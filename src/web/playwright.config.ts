import { defineConfig, devices } from "@playwright/test";
import { HOST_APP_DIR, HOST_PORT } from "./tests/e2e/host-theme.js";

/**
 * Projects are split by *shared state*, not by device.
 *
 * `host-*.spec.ts` drive one real host process whose stores are a directory on
 * disk. With a single fully-parallel project those files run in separate workers
 * while writing the same `active-theme.json`, `theme-answers.json` and display
 * state, so they raced: the consumer's saved device choice came back empty from
 * `page.reload()` under four workers. The host project pins `workers: 1` to keep
 * those stores single-threaded.
 *
 * The other two files share no server and never touch the host, so they keep
 * full parallelism. The host specs and the preview specs also share no port or
 * store, so no dependency phase is needed between the projects.
 *
 * Only `phone-host` is limited to `host-player.spec.ts` and the live chart's
 * edge probe: the host's three viewport-independent HTTP checks were duplicated
 * across both viewports for no viewport reason, and the host's own phone
 * rendering is covered by `/api/sensors` rather than a layout that would
 * differ. `host-media.spec.ts`
 * joins `HOST_SPECS` for the reason the others do — it boots a real host and
 * writes theme packages into the shared themes directory — and reads only on
 * `desktop-host`, because `phone-host` is not matched for it. It still guards
 * with `isDesktopSurface`, so widening that project's `testMatch` later cannot
 * silently turn a desktop pixel read into a phone one.
 */
// `walkthrough` is here for the reason the others are: it boots the real host
// through this project's `webServer` and drives the editor through that host's
// `/editor/` mount, which no preview server provides. The regex is also the
// `desktop-chromium`/`phone-chromium` `testIgnore`, so widening it keeps the
// walkthrough out of the two preview projects rather than pulling it into a
// second one. `phone-host` matches `host-player` alone and is unaffected.
const HOST_SPECS = /host-(player|settings|media|chrome|walkthrough).spec.ts/;

/**
 * The live chart's edge probe is a phone measurement and is not a second copy of
 * a viewport-independent check, so it runs on `phone-host` alone rather than
 * joining `HOST_SPECS`, whose `desktop-host` project would run it a second time
 * at a size the reading is not about (`vg-571`). The preview projects ignore it
 * for the reason they ignore the rest: it needs the real host. The file itself
 * skips unless `YUNARI_EDGE_PROBE` is set, and a run whose every selected test
 * is skipped starts no `webServer` — so the default path costs neither the
 * hundred seconds nor a host.
 */
const EDGE_PROBE_SPEC = /live-chart-edge\.spec\.ts/;

/**
 * The own-host editor proofs each start their own host on its own port and drive
 * the editor through that host's `/editor/` mount, because `/api/hosting`,
 * `/api/publish` and `/api/published` are only same-origin there — and a theme
 * store on disk is a fixture the preview projects do not provide. Like the host
 * specs they cannot run under the preview projects, and they cannot share their
 * port — `publish-header` owns 4227, `publish-loop` owns 4229,
 * `editor-invalid-theme` owns 4231, `editor-overlarge-theme` owns 4237,
 * `host-secure-origin` owns 4233 and `media-artwork` owns 4222. The display
 * runner's preview owns 4223 (`playwright.display.config.ts`), so
 * `custom-source` owns 4225 and `game-artwork` owns 4239; `game-metadata` owns
 * 4245.
 *
 * The installability proof joins them for the reason `host-secure-origin` is
 * here rather than in the host project: it starts its own host bound to the
 * LAN and launches its own browser, because a service worker needs a secure
 * context and `localhost` is one whatever the host does. It owns 4235.
 */
const OWN_HOST_SPEC =
  /(publish-(header|loop)|editor-(invalid|overlarge)-theme|host-secure-origin|host-pwa|media-artwork|game-artwork|game-metadata|custom-source)\.spec\.ts/;

/**
 * The rebuild drives its own preview on its own port, under
 * `playwright.rebuild.config.ts`, for the reason that config states: two agents
 * on one preview is how a proof ends up screenshotting somebody else's theme.
 * A file with its own runner cannot also run under this one — it would arrive
 * at the shared 4174 server, which is not the bundle its fixes were built into,
 * and fail for a reason that has nothing to do with the rebuild. Excluded here
 * for the same reason the host specs are: they need an arrangement this config
 * does not provide.
 */
const REBUILD_SPEC = /author-journey-rebuild\.spec\.ts/;

/**
 * The display proof takes its own editor preview and starts its own real host
 * on its own port, over a themes directory it writes itself. Excluded here for
 * the same reason the rebuild is: this config provides no such arrangement, and
 * a spec that arrived at the shared 4174 server would be measuring a bundle its
 * own fixes were not built into.
 */
const DISPLAY_SPEC = /author-journey-display\.spec\.ts/;

export default defineConfig({
  testDir: "./tests/e2e",
  // Its own artifact dir: a shared test-results/ lets the first run to finish
  // clear the other's traces, which the survivor reports as test failures (vg-216).
  outputDir: "test-results/main",
  // Every Playwright spec is a `.spec.ts`. The default (`spec` **or** `test`)
  // would also collect a Vitest unit test that lives beside the harness, and an
  // import of `vitest`'s `test` is a hard error for the whole suite, not one
  // skipped file.
  testMatch: "**/*.spec.ts",
  // Seeds the host fixture once; the config itself runs in every worker.
  globalSetup: "./tests/e2e/global-setup.ts",
  retries: 0,
  fullyParallel: true,
  // `workers` is deliberately left to Playwright's default (half the cores).
  // Hardcoding a count would oversubscribe a small CI runner, and oversubscription
  // is what turned the long `clock.runFor` waits into 30 s timeouts under load.
  // The two host projects below pin their own `workers: 1` instead.
  // JSON summary feeds dev-status without rerunning the browser suite.
  reporter: [[process.env["CI"] === undefined ? "list" : "github"], ["json"]],

  use: {
    baseURL: "http://127.0.0.1:4173",
    trace: "retain-on-failure",
  },

  // Test built player/editor bundles on explicit IPv4 loopback ports.
  webServer: [
    {
      command:
        "npx vite preview packages/player --port 4173 --strictPort --host 127.0.0.1",
      url: "http://127.0.0.1:4173",
      reuseExistingServer: true,
      timeout: 60_000,
    },
    {
      command:
        "npx vite preview packages/editor --port 4174 --strictPort --host 127.0.0.1",
      url: "http://127.0.0.1:4174",
      reuseExistingServer: true,
      timeout: 60_000,
    },
    {
      // The real Node host, not a preview server: hosted theme loading, package
      // asset serving and the SSE stream are otherwise never browser-tested.
      command: `node packages/host/bin/yunari.js --no-browser --port ${HOST_PORT} --app-dir ${HOST_APP_DIR}`,
      // http, which the host still serves beside https on the same port
      // (0070). The pairing link these specs drive is the one the host prints,
      // and what that link should carry belongs to the per-display-themes
      // spec; the secure origin is read by `host-secure-origin.spec.ts`, which
      // starts its own host on the LAN and launches its own browser.
      url: `http://127.0.0.1:${HOST_PORT}/api/health`,
      reuseExistingServer: true,
      timeout: 60_000,
    },
  ],

  projects: [
    {
      name: "desktop-chromium",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1280, height: 720 },
      },
      testIgnore: new RegExp(
        `${HOST_SPECS.source}|${REBUILD_SPEC.source}|${DISPLAY_SPEC.source}|${OWN_HOST_SPEC.source}|${EDGE_PROBE_SPEC.source}`,
      ),
    },
    {
      // Tall phone viewport exercises contain-mode letterboxing.
      name: "phone-chromium",
      use: { ...devices["Pixel 7"] },
      testIgnore: new RegExp(
        `${HOST_SPECS.source}|${REBUILD_SPEC.source}|${DISPLAY_SPEC.source}|${OWN_HOST_SPEC.source}|${EDGE_PROBE_SPEC.source}`,
      ),
    },
    {
      // One real host, one set of stores: serial by construction.
      name: "desktop-host",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1280, height: 720 },
      },
      testMatch: HOST_SPECS,
      workers: 1,
    },
    {
      name: "phone-host",
      use: { ...devices["Pixel 7"] },
      testMatch: /host-player\.spec\.ts|live-chart-edge\.spec\.ts/,
      workers: 1,
    },
    {
      // Its own host on its own port, so it is serial by construction for the
      // same reason the host projects are.
      name: "own-host",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1680, height: 1000 },
      },
      testMatch: OWN_HOST_SPEC,
      workers: 1,
    },
  ],
});
