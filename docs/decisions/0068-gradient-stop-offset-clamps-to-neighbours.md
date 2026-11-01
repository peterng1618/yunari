# 0068 — A gradient stop's offset clamps to its neighbours

- **Date:** 2026-11-01
- **Status:** accepted
- **Paths:**
  - `src/web/packages/editor/src/components/ui/gradient-editor.tsx`
  - `src/web/packages/editor/src/components/ui/gradient-editor.dom.test.tsx`

## Problem

`GradientEditor`'s `put(index, stop)` is the single write behind a pointer
drag, the keyboard arrows and the percent well. It wrote whatever offset the
gesture asked for, so dragging or typing a stop past a neighbour stored a lower
offset after a higher one. `fabric-envelope-validate.ts` requires ascending
offsets and refuses the document on save ("Gradient stops need ascending 0–1
offsets and non-empty CSS colors", `#52`). The choice — clamp or reorder — had
to be settled before the write could be bounded.

## Rung 1 — internal owner

Searched: `gradient-editor.tsx` (`put`, `addAt`, the pointer, key and well
callers), `gradient-editor.dom.test.tsx`, `gradient-css.ts`, the theme
validator `renderer-core/src/theme/fabric-envelope-validate.ts`.

Found: `put` is already the one write for both gestures the issue names, so the
bound belongs there rather than at each call site. `addAt` already keeps
ascending order by inserting at the sorted position; `gradientCss` sorts a
copy for painting. The validator refuses descending offsets but accepts equal
ones, which is what a pinned drag produces. No existing helper bounds one stop
by its neighbours.

## Rung 2 — installed dependencies

Searched: `ControlNumber` (`control-number.tsx`) and its tests, `colour-picker`
`ratioAlong`.

Found: `ControlNumber` validates only its own `min`/`max` (0 and 100 here); it
has no notion of the other stops, so the percent field cannot carry this rule.
`ratioAlong` clamps the pointer to 0–1 but not to the stop's interval. React
state and the Base UI radio group donate nothing for this shape.

## Rung 3 — native platform

Searched: HTML `input[type=range]` `min`/`max`/`step`, CSS gradients.

Found: a native range input bounds one thumb against a fixed `min`/`max`, not
against the values of sibling thumbs, so it cannot express the interval; the
editor's stops are `role="slider"` divs by design (`DESIGN.md`), and CSS has no
authoring-time notion of stop order. Nothing native is missing or applicable.

## Rung 4 — public solutions

Searched: Penpot gradient-stop clamping (`penpot/penpot` #10879, PR #10881);
fpGUI `TVertexStyle` gradient-stop drag (`graemeg/fpGUI` commit ea72fbf);
Paragon UI gradient editor docs; Qt `QtGradientStopsWidget`.

Found: fpGUI explicitly "clamp[s] drag to adjacent stop offsets so the array
stays sorted during mouse move" — the same rule, in a sorted-array model.
Penpot clamps only to the 0–1 range because its model re-sorts stops by offset;
Qt's widget clones and moves stops through a sorted model. Editors that keep
array identity instead bound the moving stop by its neighbours. No package
donates a neighbour-clamping control; the rule is a few lines at the write.

## Rung 5 — integration comparison

| Option | Fit | Unsolved work | Verdict |
|---|---|---|---|
| Reorder stops on crossing | Matches sorted-model editors | Changes index identity mid-gesture, so marks and the selection must be remapped; a crossing drag can never rest at a neighbour | Rejected (the user's ruling) |
| Clamp inside `put` to `[previous, next]` | One write; array order and index identity stay; a crossing gesture pins | None | Accepted |
| Clamp in each caller | Same result | Three copies (pointer, keyboard, well), and a fourth caller would miss it | Rejected |

## Rung 6 — smallest probe

The DOM suite is the executable probe. Adding the typed-percent and crossing
drag cases before the fix must fail with a descending array
(`[0.9, 0.7]`-style) and pass after it; the red proof was run and restored
(see the change's report).

## Decision

Bound the offset at the start of `put`: lower is the previous stop's offset
(`0` at index 0), upper is the next stop's offset (`1` at the last index), and
the offset is clamped into that interval. Both the drag and the percent well go
through `put`, so both inherit the rule, and the validator remains the trust
boundary for documents written by anything else.
