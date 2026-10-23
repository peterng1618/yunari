# 0099 — The picker's channel maths is ours; the gradient CSS is one formula

- **Date:** 2026-10-23
- **Status:** accepted
- **Paths:** `src/web/packages/editor/src/components/ui/colour-picker-model.ts`,
  `src/web/packages/editor/src/components/ui/gradient-css.ts`

## The problem

The rebuilt picker needs three things no installed owner provides: a channel
read/write pair over `renderer-core`'s `Hsva` that the hue, saturation,
brightness and alpha controls share; a keyboard stepper for a bounded channel
that knows which keys a slider owns; and the saturation × brightness area's
point↔channel conversion, with y inverted. Separately, the same
`linear-gradient(90 - angle, stops sorted and rounded)` string is written in
`panes/tokens/paint-list.tsx` and `components/ui/gradient-editor.tsx`, so a
change to the angle convention has two places to land and one to miss.

The risk is not that the arithmetic is hard. It is that each surface grows its
own version of it — a ratio stepper here, a percentage stepper there — and the
keyboard, the aria value and the painted value then disagree only on a rounded
fraction nobody tests.

## Rung 1 — Yunari

Searched: `ArrowRight`, `PageUp`, `nextTrackRatio`, `aria-valuetext`,
`90 - angle`, `gradientCss`, `Hsva` across `src/web/packages/editor/src` and
`src/web/packages/renderer-core/src`.

Found: `renderer-core/src/color.ts` owns conversions (`toHsv`/`fromHsv`) and the
`Hsva` shape, but nothing reads or writes one channel. `colour-picker.tsx` has
`nextTrackRatio`, a 0–1 ratio stepper for its old four tracks: no Page keys, no
Shift, and it works in ratios rather than channel units, so a hue track and an
alpha track cannot share it. The gradient formula exists twice —
`paint-list.tsx#paintCss` and `gradient-editor.tsx`'s local `css`. No channel
model, no area conversion, no `aria-valuetext` producer exists.

## Rung 2 — dependencies

Searched: every `package.json` under `src/web/packages` for colour or picker
packages; `node_modules` for installed ones.

Found: `culori@4.0.2` (conversion only, no UI maths), `@base-ui/react@1.8.0`
(primitives: no slider arithmetic and no colour model). No picker library is
installed. The task forbids adding a dependency.

## Rung 3 — platform

Searched: native `<input type="range">` keyboard behaviour, CSS
`linear-gradient()` syntax, `aria-valuetext`.

Found: a native range gives arrows/Home/End/Page for free, but only along one
axis. The picker's area is two channels at once and the tracks are painted
gradients, not the native widget's chrome, so the platform control cannot be the
surface. `linear-gradient()` is the platform for the paint itself — the only
code we need is building its string. `aria-valuetext` is a plain attribute; the
platform does not compose the sentence.

## Rung 4 — ecosystem

Searched (npm registry metadata, 2026-10-23): `react-colorful@5.8.1`,
`@uiw/react-color@2.10.3`, `colord@2.10.0`, `culori@4.0.2`; and the ReUI colour
picker this work follows (recorded in `decisions/0098`).

Found: `react-colorful` implements this interaction internally but exports a
component, not its helpers — consuming it means adopting its DOM and losing our
`ControlRow`/`ControlWell` surface, and its HSV maths are private. `@uiw/react-color`
is a component library with the same ownership cost. `colord` converts and
manipulates colours but has no channel stepping or area mapping. ReUI's picker
reads `hsv` channels from the consumer and does no conversion or keyboard
stepping, so it is the interaction model, not an owner. Nobody in this set
publishes a pure "channel unit ↔ stored unit + slider key stepping" pair, which
is exactly the shape this task needs.

## Rung 5 — comparison

| Option | Fit | Cost | Risk | Verdict |
|---|---|---|---|---|
| Reuse `nextTrackRatio` | Ratio stepping only, no Page, no channel units | None today | Hue and percentage tracks keep diverging; area still needs its own maths | Rejected |
| `react-colorful` | Complete picker | New dependency, own DOM, private helpers | Cannot extract the maths; replaces the agreed surface | Rejected |
| `@uiw/react-color` | Complete picker | New dependency, larger | Same ownership inversion | Rejected |
| `colord` | Conversions | Duplicates `renderer-core/color.ts` | Two colour owners again (0098) | Rejected |
| **~90 lines beside the picker** | Exact shape: channel units, key model, area mapping | One small module + tests | None found; all pure and testable | **Accepted** |

## Rung 6 — probe

Ran `culori/fn` with the modes registered, against the reference theme's stored
colours:

- `#081523d9` → `{ h: 211.11111111111111, s: 0.7714285714285715, v: 0.13725490196078433, alpha: 0.8509803921568627 }`
- mid grey → `{ s: 0, v: 0.5, alpha: 1 }` with no `h` property, so a channel
  read must never assume a finite hue.

The probe also confirms the conversions already round-trip in
`renderer-core/src/color.ts`; the new module only scales between the stored
0–1 units and the controls' display units, which needs no colour library.

## Decision

`components/ui/colour-picker-model.ts` owns the channel table, the read/write
pair, ratio conversion, keyboard stepping, the area's point mapping and its
`aria-valuetext` sentence. `components/ui/gradient-css.ts` owns the single
gradient string; `paint-list.tsx` calls it and its local sort/map is deleted.
The maths is pure, tested directly, and depends on `renderer-core` for the
`Hsva` shape alone.
