# 0069 — segmented chips take equal shares

- **Date:** 2026-11-01
- **Status:** accepted
- **Paths:** `src/web/packages/editor/src/components/ui/control-segmented.tsx`, `src/web/packages/editor/src/components/ui/control.dom.test.tsx`, `DESIGN.md`

## Problem

`ControlSegmented` lays its `ToggleGroup` out as a flex row, but each `Toggle`
is an auto-width item: the chip boxes hug their labels (measured 34.1px for
"Left" and 48.1px for "Center" in a 170px group). All three reference drawings
give each chip an equal share of the well. The mismatch is visual only, but it
drifts silently because no test reads the distribution classes.

## Rung 1 — internal owner

Searched: CodeGraph not used (the repository index is shared and the question is
one file plus its test); read `control-segmented.tsx`, `control-well.tsx`,
`control.dom.test.tsx`. Searched every `ToggleGroup` import in
`packages/editor/src`.

Found: `ControlSegmented` is the owner of this labelled row. `hitTargetClasses`
in `control-well.tsx` carries the hit area and must stay. Three other surfaces
reuse the same primitive with their own paint (`asset-finder/finder-controls.tsx`,
`editor-shell/shell-layout.tsx`, `store-mode/region.tsx`); they are outside this
issue's file scope and keep their current layout. No equal-share helper exists,
and the distribution is a Tailwind class on the chip, not a mechanism.

## Rung 2 — installed dependencies

Searched: `@base-ui/react` 1.9.0 `toggle-group/ToggleGroup.js`,
`toggle/Toggle.js` and their type declarations; `node_modules/tailwindcss`
utility definitions.

Found: Base UI renders `ToggleGroup` as a `div` and `Toggle` as a `button`,
forwarding `className` and leaving layout entirely to the caller. No donated
flex sizing. Tailwind's `flex-1` compiles to `flex: 1 1 0%`; `min-w-0` is the
standard `min-width: 0`. Both are already used under `packages/editor/src`.

## Rung 3 — native platform

Searched: CSS Flexible Box Layout (`flex`, `min-width`), MDN.

Found: a flex item with `flex: 1 1 0%` ignores its content width in the main
axis and divides the free space equally; `min-width: auto` would otherwise let a
long label push the chip wider, so `min-w-0` is required alongside. This is the
whole behaviour needed; no JavaScript or measurement is involved.

## Rung 4 — public solutions

Searched: CSS Flexbox specification, §7 Flexibility; MDN `flex` shorthand and
`min-width`; Tailwind CSS `flex` utility docs; the shipped Base UI toggle-group
example source.

Found: equal-share tab/segmented strips are uniformly `display:flex` on the
group and `flex:1` (`flex-1`) on each member, with `min-width:0` where labels
may overflow. No library ships a segmented control whose sizing should replace
this component.

## Rung 5 — integration comparison

| Option | Fit | Unsolved work | Verdict |
|---|---|---|---|
| `flex-1 min-w-0` on each chip | Exact; Tailwind already in the file | None | Chosen |
| JS measuring widths | Not needed | Resize observer, drift | Rejected |
| `grid grid-cols-N` with a fixed count | Needs a per-render class or inline style for 2–4 options | Inline style atoms, arbitrary class | Rejected as more mechanism |
| New segmented component / dependency | Duplicates the owner | Another control in the closed vocabulary | Rejected |

## Rung 6 — smallest probe

Behaviour is settled by the DOM assertion added to
`control.dom.test.tsx`: every option chip carries `flex-1` and `min-w-0`, and
the group is the flex container. The test was run red before the class existed
and green after.

## Decision

Add `flex-1 min-w-0` to each `Toggle` in `ControlSegmented` and amend the
`Segmented` entry in `DESIGN.md` to state the equal-share rule. The set's
colour, spacing, radius, type, elevation and hairline are untouched.
