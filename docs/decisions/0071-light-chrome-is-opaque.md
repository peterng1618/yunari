# 0071 — Light's chrome is opaque, and no palette is exempt

- **Status:** accepted
- **Date:** 2026-11-01
- **Paths:** `src/web/packages/editor/src/editor-shell/editor-shell.css`, `src/web/tests/e2e/shell-palette-readers.ts`, `src/web/tests/e2e/shell-palette-appearance.spec.ts`

## The problem

"Chrome is opaque" held in five of six palettes. `light` declared
`--shell-surface: #eff9f2bf` (75% alpha), `--shell-surface-strong: #f8fffbdf`
(87%) and `--shell-popover: #eff9f2f2` (95%), so its rail, panes and inspector
composited against the mint gradient ground while every other palette painted
one flat value. The palette test carried a named exemption for exactly that
value.

## Rungs

1. **Internal owner.** `editor-shell.css` owns the palette tokens; `.editor-glass`
   paints `var(--panel)` and nothing over it. There is no second owner.
2. **Installed dependencies.** No library owns a palette's surface colour; CSS
   custom properties and `color-mix()` are the whole mechanism.
3. **Native platform.** `getComputedStyle` reports the composited chrome colour
   and the token's own declaration, which is how the exemption was measured.
4. **Public solutions.** The rendering brief already fixes chrome as one flat
   surface per palette; upstream design-token systems likewise treat a palette's
   surface role as an opaque value and express translucency as a separate
   overlay role. Nothing needs importing.
5. **Integration comparison.** Adding an overlay role for light would give the
   palette a second surface mechanism the other five do not have. Retuning the
   three surface roles in place keeps one mechanism for all six.
6. **Smallest probe.** Measured in a real browser before the change: light's
   rail read `rgba(239, 249, 242, 0.75)`; the other five read fully opaque
   values. After compositing light's declarations over the midpoint of its own
   gradient (`#d8ebe4` → `#afd4d1`) the tones the reader already saw are
   `#e4f3ec`, `#f1fbf7` and `#edf8f1`.
7. **Decision.** Light's three surface roles take those opaque tones. The test's
   exemption is deleted rather than left for a palette it no longer describes,
   and every palette is now held to alpha 1.

## Consequences

The chrome reads as the composite the reader already saw, so no layout or
contrast change; `--stage` stays the gradient, because a lifted control is not
chrome. The exemption's own rule — a listed palette whose fill turns opaque is a
stale row — is what reds if the tones drift back.
