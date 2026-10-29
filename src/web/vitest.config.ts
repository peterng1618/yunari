import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/** The product's version, injected the same way `packages/editor/vite.config.ts`
 *  injects it for the built bundle. The unit suite does not build through that
 *  file, so without this the editor source's `__YUNARI_VERSION__` would be an
 *  unresolved global (`vg-279`). */
const { version } = JSON.parse(
  readFileSync(new URL("./package.json", import.meta.url), "utf8"),
) as { version: string };

export default defineConfig({
  define: { __YUNARI_VERSION__: JSON.stringify(version) },
  // shadcn's convention, matched to the editor's own vite alias so a component
  // written for the app resolves in tests too.
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./packages/editor/src", import.meta.url)),
    },
  },
  test: {
    // Unit tests for the shared renderer's pure logic. Visual and cross-device
    // behaviour is covered by Playwright (tests/e2e), not here.
    //
    // Two namespaces under `tests/` are pure readers of a file — no DOM, no
    // server — and are collected here on purpose. `tests/scripts/design-md.test.ts`
    // drives the root `scripts/design-md.mjs` checks; it is the reader's own
    // proof that it reads the artefact rather than a transcription of it.
    // Playwright's own suite is `.spec.ts` only (`playwright.config.ts`), so the
    // two runners do not collect each other's files.
    include: [
      "packages/*/src/**/*.test.ts",
      "packages/*/src/**/*.test.tsx",
      "tests/e2e/**/*.test.ts",
      "tests/scripts/**/*.test.ts",
    ],
    environment: "node",
    restoreMocks: true,
    // The default 5s per-test budget is below the floor this harness imposes: at
    // 144 files Vitest spawns a worker per file (~5.2s of startup each), and a
    // jsdom file needs 5-8s of wall clock under load. The budget was failing
    // tests whose bodies all pass in isolation, with a different set each run -
    // load, not logic. Raise the ceiling rather than the file's own timeout, so
    // a genuinely slow test still shows up.
    testTimeout: 20000,
    hookTimeout: 20000,
  },
});
