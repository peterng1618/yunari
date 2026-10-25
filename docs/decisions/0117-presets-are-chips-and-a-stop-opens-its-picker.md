# 0117 — Presets are swatch chips, and a gradient stop opens its own picker

- **Date:** 2026-10-25
- **Status:** accepted
- **Paths:** `src/web/packages/editor/src/components/ui/control-choice-row.tsx`,
  `src/web/packages/editor/src/components/ui/colour-picker.tsx`,
  `src/web/packages/editor/src/components/ui/gradient-editor.tsx`,
  `src/web/packages/editor/src/chart-manager/index.ts`,
  `src/web/packages/renderer-core/src/charts/chart-paint.ts`,
  `src/web/packages/renderer-core/src/charts/reading-signature.ts`,
  `src/web/packages/player/src/main.ts`

## The problem

The owner reported three things about the rebuilt picker: each library preset is
a full-width row carrying its name, so twelve colours and fifteen gradients fill
the popover; a gradient stop has no visual answer for which stop the picker and
offset well edit; and a stop cannot be clicked to open the picker that edits it.
The stop gesture already distinguishes a press from a drag (`DRAG_THRESHOLD`),
so the third is a wiring question rather than a gesture redesign.

## Rung 1 — Yunari
Searched: `ControlChoiceRow`, `ColourPicker`, `GradientEditor`, the preset
library, `DESIGN.md` §5.
Found: `ControlChoiceRow` already owns the radio-in-a-group pattern and has two
geometries (`row`, `card`), both carrying the name. The picker and gradient
editor both draw presets through it in `space-y-1` lists. `ColourPicker` owns its
popover `open` state internally. `GradientEditor` owns `selected` and the drag
gesture, and renders one picker per selected stop keyed by the stop index.

## Rung 2 — dependencies
Searched: Base UI `Radio`, `RadioGroup`, `Popover` APIs in the installed
version.
Found: `Popover.Root` accepts controlled `open`/`onOpenChange`; `Radio.Root`
derives `aria-checked` from the group and needs no extra state. No new
dependency is required for either change.

## Rung 3 — platform
Searched: `<input type="color">`, CSS `linear-gradient()`, `CanvasGradient`.
Found: the native colour input still has no alpha channel (decision 0100), and
the three paint paths already share the stored-angle convention (`90 - cssDeg`)
owned by `gradientCss`. A chip is a button with a swatch, which the platform and
the existing control set already provide.

## Rung 4 — ecosystem
Searched: Figma colour styles, Photoshop swatches, Chrome DevTools colour
palettes, cssgradient.io swatch rows; Radix/Base UI "swatch radio" examples.
Found: every one draws a library as a wrapped row of small swatch-only targets
with the name in the accessible label or a tooltip, not printed beside each
swatch. That is the established shape; no library or component package was
added for it.

## Rung 5 — comparison

| Option | Fit | Cost | Risk | Verdict |
|---|---|---|---|---|
| Add a `chip` geometry to `ControlChoiceRow` | Keeps the radio, group, roving focus and refusal channel | Small | None seen | **Chosen** |
| Hand-rolled `<button>` swatches | Duplicates group ownership and focus | Medium | Two keyboard models | Rejected |
| Keep rows, add a tooltip | Does not reduce the popover's height | None | The owner's complaint stands | Rejected |

## Rung 6 — probe
Measured in the built editor on 2026-10-25 with a CDP sampling profiler and
`performance.now()` around pointer dispatch:

- one picker pointer-move cost 75–170 ms end to end; disabling the session's
  `isDirty()` cut it to ~76 ms, and an emptied canvas to ~26 ms;
- `isDirty()` was called 15 times per move at ~4.2 ms each — the same scene
  serialisation and validation recomputed for each subscriber;
- one palette sample issued ~80 ECharts `setOption` render requests across the
  document's seven charts, including charts whose ink the changed token does not
  name.

The chip and picker-open changes are rendered behaviour, so their evidence is
the DOM suites plus the browser capture; no timing claim is made for them.

## The chart reading's palette half

Main extracted the chart reading signature into
`renderer-core/src/charts/reading-signature.ts` while this branch was open, so
the palette inputs this work adds moved with it rather than staying in the
editor's private copy.

Searched: `reading-signature.ts` and the two call sites
(`chart-manager/index.ts`, `player/src/main.ts`); `chart-paint.ts`, whose
`reassignChartPaintReferences` already walks every `ref` in authored settings;
`plan.ts`'s paint resolver; and `rg` for a read-only ref collector or a typed
list of paint fields across renderer-core, editor and player.

Found: the generic walk in `reassignChartPaintReferences` is the existing rule,
so the collector is its read-only twin in the same module rather than a second
per-family field list that four settings shapes would have to keep in step. Both
call sites already hold the palette they resolve paint with, so the signature
takes it as one more input; the platform and installed dependencies offer
nothing for comparing authored paint values.

## Decision
Preset libraries use a third `ControlChoiceRow` geometry — a 24px `--radius-sm`
chip carrying the swatch alone, its name in the accessible label, still a radio
in the one labelled group — because the group already owns the one checked bit
and the arrow keys, and a second swatch control would be a second keyboard model.
A gradient stop opens the picker from its press-without-travel, because the
gesture already knows a press from a drag; the selected stop takes an accent
border so the well and picker have a visible subject.
