# 0075 — Splitting the display browser spec by subject

- **Date:** 2026-11-01
- **Status:** accepted
- **Paths:** `src/web/tests/e2e/editor-display.spec.ts`, `src/web/tests/e2e/editor-display-entry.ts`, `src/web/tests/e2e/editor-display-lens.spec.ts`, `src/web/tests/e2e/editor-display-settings.spec.ts`, `scripts/oversize-files.ceiling.json`

## Problem
`src/web/tests/e2e/editor-display.spec.ts` is 1124 lines, past the 800-line
stop enforced by `scripts/oversize-files.mjs` (issue #233). It holds three
subjects in one suite: the display choice and the framing it produces, what the
lens draws (guide frame, circle clip, letterbox paint, stage texture), and the
catalogue settings expose to the menu. A split by line count would scatter one
subject across files; the cases have to keep their project membership, their
titles, their locators and their assertions.

## Rung 1 — internal owner
Searched: `codegraph_explore "editor-display.spec editor-stage"` and `grep` for
importers of `./editor-stage.js`.
Found: the suite already owns its helpers through `tests/e2e/editor-stage.ts`;
`editor-display.spec.ts` is the only importer and holds no local helper of its
own. The suite runs under the `desktop-chromium` and `phone-chromium` preview
projects in `playwright.config.ts` and is not one of the excluded own-host,
rebuild or display-runner files. `author-journey-display.spec.ts` is a separate
file with its own host and is excluded by `DISPLAY_SPEC`; it is not touched.

## Rung 2 — installed dependencies
Searched: Playwright 1.63's config contract (`testDir`, `testMatch`,
`testIgnore`, per-project matching) and its `test.beforeEach` collector.
Found: Playwright supplies file collection and per-file hooks. It donates no
split of a spec; a helper module imported by the specs cannot be collected as a
spec because `testMatch` is `**/*.spec.ts`.

## Rung 3 — native platform
Searched: the test runner's own module resolution and the browser surface the
cases measure.
Found: no platform API changes the decomposition. The cases stay real-browser
measurements against the built bundles; no assertion or port moves.

## Rung 4 — public solutions
Searched: Playwright's documented patterns for splitting a large spec file and
for shared setup (`test.extend`, exported `beforeEach` functions), and the
repository's existing sibling-spec convention (`host-*.spec.ts`,
`glass-*.spec.ts`, `shell-palette-*.spec.ts`).
Found: the repository's established shape is one spec file per subject, sharing
helpers through a plain `.ts` module. The display suite already follows it with
`editor-stage.ts`; Playwright fixtures would add a second setup mechanism for
one `beforeEach`.

## Rung 5 — integration comparison
| Option | Fit | Unsolved work | Verdict |
|---|---|---|---|
| Keep one 1124-line file | Violates the 800-line stop | None | Rejected |
| Register the moved cases from imported `.ts` modules | Keeps one file's collection, but hides tests in modules the collector does not name | Reviewability; a helper looks importable | Rejected |
| Sibling `.spec.ts` files per subject, one shared `.ts` entry helper | Matches the repo convention; same preview projects; titles unchanged | None | Chosen |

## Rung 6 — smallest probe
`npx playwright test tests/e2e/editor-display*.spec.ts --project=desktop-chromium
--list` before and after the split shows the same 22 titles, and the
`phone-chromium` project shows the same set. `npx tsc --noEmit -p
tsconfig.e2e.json` type-checks the split modules. `node
scripts/oversize-files.mjs` reports `editor-display.spec.ts` under the stop and
reports its ceiling entry as split.

## Decision
Keep `editor-display.spec.ts` as the display choice and framing subject, and
move the lens drawing to `editor-display-lens.spec.ts` and the catalogue
settings to `editor-display-settings.spec.ts`. The shared editor-open sequence
lives in `editor-display-entry.ts`, a `.ts` module that no project's
`testMatch` collects. Every describe title, test title, locator, assertion and
port stays verbatim, and `playwright.config.ts` is unchanged. The
`editor-display.spec.ts` row leaves `scripts/oversize-files.ceiling.json`
because the file is now under the stop.
