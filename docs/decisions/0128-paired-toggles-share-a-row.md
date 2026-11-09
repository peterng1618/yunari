# 0128 — two independent booleans share one labelled row

- **Date:** 2026-11-09
- **Status:** accepted
- **Paths:** `src/web/packages/editor/src/components/ui/control-toggle.tsx`,
  `src/web/packages/editor/src/components/ui/control-toggle-pair.tsx`,
  `src/web/packages/editor/src/selection-inspector/view.ts`

## Problem

The background inspector draws Flip horizontally and Flip vertically as two
field rows, one switch each. They are two independent booleans over one
concept — the media's two paint-time mirrors — and two rows read as two
unrelated settings. The offset pair already shares one labelled row, so the
same shape must carry the flips. A wrong integration fails quietly by
duplicating the row shape in the caller, losing each switch's own label, or
taking the pair out of the inspector's 74px-label/value-cell grid.

## Rung 1 — internal owner

Searched: CodeGraph for `ControlPair`, `ControlToggle`, `PairHalfView`,
`toggle` in `selection-inspector`; read `components/ui/control-pair.tsx`,
`components/ui/control-toggle.tsx`, `components/ui/control-number.tsx`,
`selection-inspector/column.tsx`, `selection-inspector/view.ts`,
`selection-inspector/background-column.ts`.

Found: `ControlPair` owns "one labelled row, two controls": it renders one
`ControlRow` and a `ControlNumber inline` per half. `ControlNumber` already has
the `inline` mode (`label` + well without a row). `ControlToggle` has no inline
mode, so two switches cannot share a row without either nesting rows or letting
the caller hand-draw a row. `PairHalfView` is numeric-only. The write path
already routes each half's id (`background.flipX`/`background.flipY`), so the
document boundary needs no change.

## Rung 2 — installed dependencies

Searched: `@base-ui/react/switch` source and its use in
`components/ui/control-toggle.tsx`; existing tests under
`components/ui/` and `selection-inspector/`.

Found: Base UI's `Switch.Root` donates the checked state, `readOnly` refusal,
`nativeButton` focus target and `aria-checked` semantics. It deliberately
renders no label or row: those belong to the caller. It has no paired-switch
variant, so the pair is a composition, not a missing primitive.

## Rung 3 — native platform

Searched: HTML forms — `<button>`/`<input type="checkbox" role="switch">` and
`<label for>` association.

Found: the platform supplies one label per control and no grouped-boolean
control. A `<fieldset><legend>` groups related booleans but replaces the
inspector's row grid and its single visible label column, which rule 2 of
`DESIGN.md` fixes. Nothing to adopt.

## Rung 4 — public solutions

Searched: web for how design systems present two independent booleans on one
labelled row (Radix/shadcn switch settings list, VegaStack settings rows, Create
UI `SwitchGroup`, oks-ui settings panels).

Found: the common shape is one labelled row per boolean, or a
settings-matrix with a column header per switch. None ships a paired-toggle
control; each still requires a label per switch and a row label. That confirms
the composition (one row label, two labelled switches) rather than a new
primitive.

## Rung 5 — integration comparison

| Option | Fit | Unsolved work | Verdict |
|---|---|---|---|
| Two `ControlToggle` rows (today) | Works, but reads as two unrelated settings | None | Rejected — the reported defect |
| New standalone paired-switch primitive | Duplicates Base UI behaviour already owned | Rewiring state, refusal, focus | Rejected |
| `ControlToggle inline` + `ControlTogglePair` mirroring `ControlPair` | Reuses the `ControlRow` grid, Base UI switch and the one inline pattern | A pair field arm and its two halves | **Chosen** |
| Hand-drawn row in `background-column.ts` | Less code | A second owner of the pair shape; loses the shared grid | Rejected |

## Rung 6 — smallest probe

No probe needed: `ControlNumber inline` is already the proven pattern in the
same row (`Selection → Offset`), and `ControlPair` renders it inside the same
`ControlRow` the inspector uses. The change repeats that composition for the
switch.

## Decision

Extend `ControlToggle` with `inline`/`labelledById` exactly as `ControlNumber`
has them; add `ControlTogglePair`, which renders one `ControlRow` and one
inline `ControlToggle` per half; add a `toggle-pair` `FieldView` arm and route
each half through the existing field writer. `pair` stays numeric — a number
field and a boolean field are different controls sharing a row shape, not one
union.
