import { seedHostTheme } from "./host-theme.js";

/**
 * Seeds the host fixture, then the host that serves it starts.
 *
 * This is not a Playwright `globalSetup`, and the distinction is the ordering.
 * Playwright appends its `webServer` plugins to the config (`runner/index.js`,
 * `runAllTestsWithConfig`) and runs plugin setup **before** any global setup
 * (`createGlobalSetupTasks`), so a `globalSetup` seed wiped the folder a host
 * had already taken: its `host.lock` and every setting written under it.
 *
 * `playwright.config.ts` therefore runs this file as the first half of the
 * host's `webServer.command`, in the same shell as the host process. The wipe
 * lands before the host that owns `HOST_APP_DIR` exists, and no running host
 * ever loses its state.
 */
await seedHostTheme();
