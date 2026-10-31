# 0052 — The player's CSS budget counts the styles its page carries

- **Date:** 2026-10-31
- **Status:** accepted
- **Paths:** `src/web/packages/player/scripts/check-size.mjs`

## Problem

The player's chrome CSS lives in `index.html`'s own `<style>` block: the player
loads no token stylesheet, and that placement was ruled legitimate. The gzip
budget walked `dist/` and summed only `.css` files, so it reported `0.0 KB` for
a build that added colour literals and an inline stylesheet — the budget could
not see the styles it existed to bound.

## Rung 1 — internal owner

Searched: `codegraph explore "check-size player bundle budget gzip CSS"`;
source of `packages/player/scripts/check-size.mjs`,
`packages/player/index.html`, `docs/decisions/0032-artboard-paint-pure-forms.md`.

Found: `check-size.mjs` is the only owner of the player's byte budget, and the
page's inline CSS is emitted into `dist/index.html` by the build because the
player has no CSS module. No second budget surface exists.

## Rung 2 — installed dependencies

Searched: Vite 8's HTML emit path, `node:zlib` gzip.

Found: the build emits each HTML input as an asset with its authored `<style>`
content intact; no installed package measures per-asset gzip size inside HTML,
so the walk must read the page itself.

## Rung 3 — native platform

Searched: Node `fs.readFile`, `zlib.gzipSync`.

Found: reading the emitted page and gzipping each style block is native to the
runtime the script already uses; no parser is needed for the `<style>` subset
the page owns.

## Rung 4 — public solutions

Searched: Context7 `/vitejs/vite` — "production build HTML entry emit CSS tags
and inline styles" (`guide/features.md`, `plugins/html.ts`); `size-limit`
counts every matched bundle asset, HTML included.

Found: Vite re-emits the HTML entry with authored inline styles unchanged, so a
budget must read the emitted page rather than only the CSS assets. Bundle-size
tools in the wild count the files matched by their globs, including HTML; none
treat a `.css` extension as the definition of styles.

## Rung 5 — integration comparison

| Option | Fit | Unsolved work | Verdict |
|---|---|---|---|
| Count `.css` only | misses the page's chrome | the reported defect | rejected (status quo) |
| Count every emitted byte in one budget | no split between JS and CSS | a colour literal charged to the JS budget | rejected |
| Extract `<style>` blocks and charge them to CSS | keeps the JS/CSS split, no new dependency | a regex over authored HTML | chosen |
| Move the chrome CSS to a `.css` file | one file type | changes a ruled placement | rejected by the placement ruling |

## Rung 6 — smallest probe

The defect is visible in the script's own output: a build with the inline chrome
reported `CSS 0.0 KB`. The new walk charges exactly the bytes inside
`<style>` blocks, so the probe is the printed CSS figure moving off zero when
the page holds a style block and staying zero when it does not.

## Decision

`check-size.mjs` reads every emitted `.html`, extracts each `<style>` block and
adds its gzip size to the CSS figure. JS keeps counting `.js` only. The budget
stays split, and the page's own chrome is now inside the number the gate
enforces.
