# 0046 — A press on a gradient stop selects it; the picker opens on double-click or Enter

- **Date:** 2026-10-31
- **Status:** accepted
- **Paths:** `src/web/packages/editor/src/components/ui/gradient-editor.tsx`

## Problem

A plain press on a gradient stop called `endDrag(true)`, which opened the colour
picker even when the pointer never travelled. The picker's popover moves focus
to its own area, so the stop lost focus and the arrow keys a slider is expected
to answer went nowhere. The spec that asserts the stop keeps focus was red.

## Rung 1 — internal owner

Searched: CodeGraph for `GradientEditor`, `endDrag`, `pickerOpen`; read
`gradient-editor.tsx`, the stop mark's handlers and the `ColourPicker` usage.
Found: one component owns both the press gesture and the picker's open state.
The Enter handler already opened the picker deliberately ("the pointer's
press-without-travel, for a keyboard author"), so the keyboard route existed and
only the pointer route disagreed with it.

## Rung 2 — installed dependencies

Searched: Base UI popover focus handling already relied on by `ColourPicker`.
Found: the popover autofocuses by design; the component cannot both open it and
keep focus on the stop. Nothing donated for "open without stealing focus".

## Rung 3 — native platform

Searched: `role="slider"` keyboard semantics (`tabIndex`, arrow keys).
Found: a slider's arrows are expected to act on the focused element; that is
the behaviour the ruling protects.

## Rung 4 — public solutions

Searched: none needed — the interaction is a two-way choice, not an integration.

## Rung 5 — integration comparison

| Option | Fit | Unsolved work | Verdict |
|---|---|---|---|
| Open picker on press, stop autofocus | Pickers open with one press | Arrows cannot reach the stop | Rejected by ruling |
| Press selects only; double-click/Enter opens | Arrows work; picker still one extra gesture | None | Chosen |
| Stop focus only on double-click | Inconsistent with slider focus | Focus behaviour differs per click count | Rejected |

## Rung 6 — smallest probe

The existing browser case (`colour-picker.spec.ts`, "keeps a gradient stop's keys
out of the window keyboard dispatcher") clicks `gradient-stop-1` and asserts the
stop is focused. With the picker no longer opening on press, the pressed element
keeps focus, which is the probe.

## Decision

`endDrag` commits a travelled drag and does nothing else; a press selects the
stop through the existing pointer and click handlers. `onDoubleClick` opens the
picker, and Enter keeps its keyboard route. The picker's autofocus is left alone,
because it is no longer reached by a single press.
