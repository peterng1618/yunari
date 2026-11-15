# 0140 — one bare Segmented control for the header and a page sub-filter

- **Date:** 2026-11-16
- **Status:** accepted
- **Paths:** `src/web/packages/editor/src/components/ui/bare-segmented.tsx`

## Problem

The Library's installed-state filter and the Sensor providers sub-filter are both
a well of exclusive labels with no label column. The state filter copied
`store-mode/halves.tsx`'s class list; the sub-filter used `ControlSegmented`,
which draws the 74px labelled row. A third copy would drift.

## Rung 1 — internal owner

Searched: CodeGraph and source for `ControlSegmented`, `ControlRow`,
`hitTargetClasses`, `StoreHalves`, `ModeSwitch`.
Found: `components/ui/control-segmented.tsx` owns the labelled row;
`control-well.tsx` owns the hit target and the id derivation; `StoreHalves`
is the theme grid's own control and is deleted by a later task; `ModeSwitch`
is the header's mode control and is not a consumer. No existing component
draws a bare group without the row.

## Rung 2 — installed dependencies

Searched: `@base-ui/react/toggle-group` source and types in `node_modules`.
Found: `ToggleGroup` donates the exclusive value, roving focus and arrow keys;
it draws no well and needs React. `ControlSegmented` already composes it.

## Rung 3 — native platform

Searched: HTML radio group and `aria-pressed` buttons; CSS.
Found: native radios need one name per option and a surrounding fieldset for a
group name; the project's existing controls already use Base UI's roving focus,
and a second keyboard model beside it would be the defect. CSS owns the well.

## Rung 4 — public solutions

Searched: Base UI ToggleGroup docs and examples; Radix ToggleGroup; the
project's own `ControlSegmented`.
Found: every option is a toggle button with `data-pressed` and one roving stop;
none supplies the project's `--stage`/`--edge` treatment.

## Rung 5 — integration comparison

| Option | Fit | Unsolved work | Verdict |
|---|---|---|---|
| Keep the two copies | diverges on focus, ids and chosen treatment | none today | rejected |
| Extend `ControlSegmented` with a "no row" mode | one owner, but the row's label/refusal/hint are meaningful there | the row's contract grows a branch for two callers | rejected |
| New bare component over `ToggleGroup` + `hitTargetClasses` | fits both callers and `ModeSwitch`'s existing visual class list | none | chosen |

## Rung 6 — smallest probe

The existing `region.dom.test.tsx` and `shell-layout.dom.test.tsx` already read
the roving tab stop and the group name; both fail if the shared control drops
either.

## Decision

Add `BareSegmented` in `components/ui/`. The state filter and the Sensor
providers sub-filter use it; `ControlSegmented`, `StoreHalves` and `ModeSwitch`
stay owned where they are.
