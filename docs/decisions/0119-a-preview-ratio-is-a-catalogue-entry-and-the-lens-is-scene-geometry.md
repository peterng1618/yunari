# 0119 — A preview ratio is a catalogue entry, and the lens is scene geometry

- **Date:** 2026-10-26
- **Status:** accepted
- **Paths:** `src/web/packages/editor/src/display-lens.ts`,
  `src/web/packages/editor/src/viewport-manager/index.ts`,
  `src/web/packages/editor/src/editor-shell.ts`,
  `src/web/packages/editor/src/editor-shell/editor-shell.css`

## The problem

A preview ratio was derived from `ARTBOARD_RATIOS × ARTBOARD_ORIENTATIONS`: a
fixed table an author could not add to, remove from or reset, with no square and
no circle. The lens box was also measured by `screenRect` in host pixels, so the
frame and its letterbox stayed pinned to the window while the artwork zoomed and
panned beneath them.

The shape that needed deciding is an **open, browser-local list with a closed
token vocabulary**: a stored `W:H`/`Circle` list that an author edits, parsed
defensively on read, plus a display box in artboard units that the camera
transforms. Both halves can be wrong invisibly — a coerced ratio or a box in the
wrong coordinate space renders wrong without throwing.

## Rung 1 — Yunari

Searched: `packages/editor/src/display-lens.ts` (`DISPLAY_LENSES`, `ratioOf`,
`lens`, `screenRect`, `displayLensGroups`), `artboard-presets.ts`,
`viewport-manager/index.ts` (`displayScreenRect`, `framingBox`),
`editor-shell/display-switch.tsx`, `new-document-chooser.tsx`, `ui-copy.ts`
(`display.displays`), `editor-shell/palette.ts`,
`shortcut-manager/bindings.ts`, and the stage gradient in
`docs/design/mockups/current/shell.html`.

Found: the six lenses were generated from the preset table; `screenRect` framed
in host pixels and was reused by `displayScreenRect`; `palette.ts` owns the
`yunari.editor.*` rule that an absent key means the default and reset removes
the key; `bindings.ts` owns the module-level table plus `subscribe` shape. No
author-managed list, no parser, no circle, and no storage.

## Rung 2 — dependencies

Searched: `src/web/package.json`, `src/web/packages/*/package.json`, and the
installed tree for a ratio/fraction/aspect/GCD helper
(`ls node_modules | grep -iE "ratio|fraction|aspect|gcd"`).

Found: nothing. Ratio normalisation is a GCD over two integers plus trimming;
no package earns its place.

## Rung 3 — platform

Searched: browser `Storage`, `JSON.parse`/`JSON.stringify`, `Math.hypot`,
`Number.isFinite`/`Number.isInteger`.

Found: the platform supplies persistence and arithmetic primitives, not a
catalogue. `Storage` may be absent (a private window) and its methods throw when
the store is refused, so every helper owns a `try/catch`. Parsing, dedupe and
change notification remain ours.

## Rung 4 — ecosystem

Searched: the installed packages and the repo for an aspect-ratio catalogue or
token parser. No web search backend is available in this environment, so the
installed tree is the ecosystem evidence.

Found: no maintained dependency solves this shape, and comparable editors ship
a hand-rolled preset list with a browser-local override. Nothing to adopt.

## Rung 5 — comparison

| Option | Fit | Cost | Risk | Verdict |
|---|---|---|---|---|
| Keep deriving from `ARTBOARD_RATIOS` | Zero work | Cannot add, remove or reset; no square or circle | Keeps two known defects | Rejected |
| Catalogue in `display-lens.ts`: parse + normalise + `Storage` + module state | One owner, closed vocabulary, no dependency | ~120 lines in the existing owner | Refused storage must not throw | Chosen |
| A new package for ratios or preferences | Duplicates stdlib arithmetic and storage | New dependency | Two owners for one list | Rejected |
| Keep the frame in host pixels | No geometry move | Camera cannot move the lens or its media | Contradicts the virtual display | Rejected |

## Rung 6 — probe

Measured from the existing module and a probe of the arithmetic:

- The old table was 3 ratios × 2 orientations = 6 lenses; none square or round.
- A `1:1` lens over a 1600 × 900 artboard boxes at 1600 × 1600, top −350 — the
  numbers the new test asserts.
- A circle lens over the same artboard has side `hypot(1600, 900) = 1835.755…`,
  so the artboard's four corners lie on the disc.
- The shell mockup paints the stage with a 45° repeating gradient
  (`#11161c`/`#0e121c`), not the theme's colour — the stage belongs to the shell.

## Decision

`display-lens.ts` owns the catalogue: `W:H` tokens and `Circle`, parsed by
`parsePreviewRatio` (integer pairs reduced by GCD, a decimal edge kept as typed,
invalid input refused with `RangeError`), normalised by
`normalisePreviewRatioTokens` (invalid entries dropped, first duplicate wins),
persisted under `yunari.editor.preview-ratios` with absence meaning defaults
(the `palette.ts` rule), and held as module-level state notified through
`subscribeLenses` (the `bindings.ts` shape). A lens is
`{ id, aspect, orientation, shape }`; `lensBox` returns the display box in
**artboard units**, not host pixels, so the camera can transform it, and a
circle lens sizes its disc to the artboard diagonal.

The specific reason: the stored vocabulary can be closed and validated once on
read, which is the only way a hand-edited or stale preference cannot frame the
stage at a ratio nobody chose — and the display box must live in the same space
as the artwork, or it cannot follow the camera. A preview ratio is camera state
(`docs/product/requirements.md` §67), never document content, so nothing here enters the theme
envelope or authored history.
