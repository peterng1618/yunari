# 0058 — the editor's CSS build states its browser floor

- **Date:** 2026-11-01
- **Status:** accepted
- **Paths:** `src/web/packages/editor/vite.config.ts`
- **Paths:** `src/web/packages/editor/scripts/check-css-prefixes.mjs`
- **Paths:** `src/web/packages/editor/package.json`

## Problem

`packages/editor/vite.config.ts` set no CSS target and the workspace declared
no browserslist, so Lightning CSS chose the prefix set from Vite's default.
Issue #100 records the symptom that motivated the finding: a built stylesheet
carried only `-webkit-backdrop-filter` while the source declared both forms,
so a browser that supports the standard property painted nothing. The blur
declarations were removed for other reasons; the configuration gap stayed.
The failure is silent: the source is correct, the build is green, and only a
browser outside the loop shows it.

## Rung 1 — internal owner

Searched with grep across `src/web`: no package declares `browserslist`, no
`css.lightningcss` or `build.cssTarget` exists, and `packages/editor/vite.config.ts`
owns the editor build. `packages/player/vite.config.ts` and
`packages/host/vite.config.ts` set `build.target` only; the player's floor is
the phone WebView and the host bundles for Node, so the editor's support matrix
is this file's. The pattern for a built-output assertion already exists:
`packages/player/scripts/check-size.mjs`, run from that package's `size`
script. The new check follows that shape rather than inventing one.

## Rung 2 — installed dependencies

The workspace installs Vite 8.3.5, whose CSS minifier is Lightning CSS 1.32.0
(`package-lock.json`). Vite's own config types accept `build.cssTarget`, and
its docs state `cssTarget` takes precedence over `css.lightningcss.targets`
for the minification step. Lightning CSS accepts a `Targets` bitfield for the
transform step, but Vite already parses esbuild-style target strings for the
minifier, so no new dependency and no `lightningcss` import is needed.

## Rung 3 — native platform

The browser side is the constraint: a rule that reaches the CSSOM in one form
only is applied per property, and a vendor-prefixed declaration is not an alias
the standard consumer falls back to. No browser API reports which form a build
emitted; reading the built stylesheet is the only platform-level check.

## Rung 4 — public solutions

Read Vite's current docs (`/vitejs/vite`): `build.cssTarget` defaults to
`build.target`; the documented example uses a string target such as `chrome61`
to stop Lightning from lowering `rgba()` to `#RGBA`. Lightning CSS's README
documents `targets` as a browserslist-to-bitfield conversion and warns that
without targets it targets "the latest version" of each browser. No public
tool asserts that a *declared* property survived; that assertion is
product-specific. Considered a browserslist file (the app's floor is one
product, not a marketing matrix) and `css.lightningcss.targets` directly (a
second encoding of the same fact).

## Rung 5 — integration comparison

| Option | Fit | Unsolved work | Verdict |
|---|---|---|---|
| `build.cssTarget: ["chrome111","edge111","safari16.4"]` + built-output check | One statement of the editor floor; Vite parses the strings; the check reads what shipped | A check script and its wiring into the package build | Chosen |
| A workspace `browserslist` | Shared by every package, but the player's phone floor differs from the editor's | Splits become per-package overrides anyway | Rejected |
| `css.lightningcss.targets` bitfield | Direct Lightning API | Needs a `lightningcss` import and numeric encoding; minification still reads `cssTarget` | Rejected |

## Rung 6 — smallest probe

Built the editor before the change and read `dist/assets/*.css`: the current
output carries both `appearance:none` and `-webkit-appearance:none`, so the
symptom is not reproduced by that property today. The check therefore asserts
the class of defect rather than a current failure, and was red-proofed by
building a copy of the stylesheet with the standard declaration removed: the
script exits 1 naming the property, and exits 0 against the real bundle.

## Decision

`packages/editor/vite.config.ts` sets `build.cssTarget` to the editor's stated
floor (Chrome/Edge 111, Safari 16.4) and
`packages/editor/scripts/check-css-prefixes.mjs` reads the built stylesheet
after `vite build`, failing when a property the editor authors in standard form
did not survive. The player keeps `target: "es2022"` because its floor is the
panel's WebView, not the desktop authoring surface.
