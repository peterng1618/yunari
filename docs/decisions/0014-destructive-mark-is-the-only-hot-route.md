# 0014 — the destructive mark is the only route to `--hot`

- **Date:** 2026-10-31
- **Status:** accepted
- **Paths:** `src/web/packages/editor/src/components/ui/preset-context-menu.tsx`

## Problem

Three editor controls painted `text-hot` directly: the icon-button
primitive's `destructive` prop and two pane buttons. The primitive's own
class beat the marker's disabled exclusion, so a disabled destructive
control could paint red where `DESIGN.md` §4 requires `--faint`. The rule
must live at one seam: the registry's `destructiveMarker`.

## Rung 1 — internal owner

Searched: CodeGraph for `destructiveMarker`, `[data-yunari-destructive]`,
`text-hot`.

Found: `object-actions.ts` owns `destructiveMarker` and the registry's
`destructive` flags; `editor-shell.css` owns the single
`[data-yunari-destructive]:not([disabled]):not([aria-disabled="true"])`
rule. The primitive now routes its prop through the marker. The two pane
buttons are the remaining direct writers; both are editor-state colours
rather than registry actions, which is why they were left in the original
finding.

## Rung 2 — installed dependencies

Searched: Base UI context-menu item props (the pane menu's owner).

Found: `ContextMenu.Item` forwards arbitrary `data-*` attributes, so the
registry marker reaches the same element without a second styling path.
No dependency change.

## Rung 3 — native platform

Searched: CSS attribute selectors and the existing cascade.

Found: an attribute selector is enough to carry the state; the marker's
existing rule already excludes disabled and `aria-disabled`. Nothing is
left for a class to own.

## Rung 4 — public solutions

Searched: design-system conventions for destructive styling (selector
strategies, disabled overrides) against the existing register entry.

Found: the common failure is exactly two owners for one semantic colour;
public systems keep one attribute or variant as the owner. Yunari already
has that owner (`destructiveMarker`), so no external mechanism is adopted.

## Rung 5 — integration comparison

| Option | Fit | Unsolved work | Verdict |
|---|---|---|---|
| Keep `text-hot` class lists | split ownership; disabled paints red | a rule per site | reject |
| Route every site through `destructiveMarker` | one owner, existing rule | none | accept |
| Delete the primitive prop | removes the affordance callers may need | dev gallery rework | reject (prop is now marker-routed) |

## Rung 6 — smallest probe

The existing CSS rule was read directly: its `:not([disabled])` and
`:not([aria-disabled="true"])` clauses are what the class list bypassed.
The editor-shell token test and the gate's design checks cover the rule's
presence; no executable probe was needed.

## Decision

Every editor control that paints destructive state carries
`destructiveMarker`'s attribute and no `text-hot` class. `ControlIconButton`
keeps its `destructive` prop but routes it through the marker.
