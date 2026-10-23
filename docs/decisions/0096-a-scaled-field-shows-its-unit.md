# 0096 — A scaled field shows the unit it is scaled into

- **Date:** 2026-10-23
- **Status:** accepted
- **Paths:** `src/web/packages/editor/src/components/ui/control-pair.tsx`

## The problem

`ControlNumber` renders a `unit` suffix in its well, and `ControlPair` renders
two `ControlNumber`s as halves — but its half type has no `unit`, so a pair
cannot say what its numbers are. The background's offsets are stored as
fractions of the box and shown as percentages (`percent: true` on both halves),
so the author reads `25` with nothing saying it means 25% of the box. The
author's own words for the confusion: they expected to type a percentage, and a
bare number gave them no way to tell whether they had.

## Rung 1 — Yunari
Searched: `ControlNumber`'s `unit` prop and its `ControlWell` suffix span,
`ControlPair`'s half type, `FieldView.unit`, `PairHalfView`, and every caller
passing `percent`.
Found: the primitive already renders a unit and the lone-number arm already
forwards `FieldView.unit`; the gap is exactly the pair's half type. No second
mechanism to reuse, and no reason to invent one.

## Rung 2 — dependencies
Searched: Base UI's `NumberField` (`Suffix`, `Adornment`) and the primitives we
already install.
Found: Base UI models a suffix as part of its field, which is the same shape as
our `unit` span. We do not re-implement `NumberField`, so nothing to adopt; the
existing span is the equivalent.

## Rung 3 — platform
Searched: `<input type="number">` and `inputmode="decimal"`.
Found: the platform has no unit concept at all — no suffix slot, no
`aria-unit`. A text or number input can only carry the unit in surrounding
markup, which is what our well already does.

## Rung 4 — ecosystem
Searched: how design systems put a unit beside a numeric field (Base UI's
`NumberField.Suffix`, Radix Themes' `TextField` with a slot, Material's
`TextField` suffixText, Ant Design's `InputNumber` `addonAfter`).
Found: all four put the unit in markup *inside* the field's trailing edge, none
inside the input's value. That is our existing `unit` span; the ecosystem
answer confirms the shape rather than adding one.

## Rung 5 — comparison
| Option | Fit | Cost | Risk | Verdict |
|---|---|---|---|---|
| Forward `unit` through the pair half | matches `ControlNumber` | one prop | none | chosen |
| Bake `%` into the half's label (`X %`) | no primitive change | the label stops being `X`, and every locator reading labels changes | the unit reads as part of the axis name | rejected |
| Render the unit in the column, beside the pair | no primitive change | a second place that knows about units | drifts from `ControlNumber`'s span | rejected |

## Rung 6 — probe
Not measured; there is no behaviour to compare, only a rendered string. The
existing `column.dom.test.tsx` case already reads `offsetX.value === "25"`, and
the unit is asserted beside it in that same case.

## Decision

`ControlPair`'s half takes an optional `unit` and forwards it to the
`ControlNumber` it renders; the column passes `"%"` when the half (or the
number field) is `percent`. The number is already scaled by the column — the
suffix is only what names the scale, so the write boundary still receives the
fraction and nothing about the model changes.
