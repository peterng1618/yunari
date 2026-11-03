# 0091 — One compact reading list for the picker and the inline `@`

- **Date:** 2026-11-03
- **Status:** accepted
- **Paths:** `src/web/packages/editor/src/sensor-key-options.ts`, `src/web/packages/editor/src/components/ui/sensor-key-dot.tsx`, `src/web/packages/editor/src/selection-inspector/mention-port.ts`

## Problem

The run-source picker lists the sensor catalogue under family headings, which
costs a heading row per family for a list of short names, and neither that list
nor the inline `@` suggestion says whether a key is working on this PC. The two
surfaces also build their entries independently, so a new state would have to be
taught twice and could drift.

## Rung 1 — internal owner

Searched: CodeGraph and source for `groupDescriptorsByFamily`, `measured`,
`ControlSelect`, `TextMentionPort`, `run-source` and `mention`.

Found: `selection-inspector/runs.tsx` already derives the picker options from
the catalogue and the host's `measured` set, and `text-manager/index.ts` already
filters the same catalogue descriptors for the inline list. `ControlSelect`
owns option rows and renders arbitrary item children; `ui-copy.ts` owns every
string. What is missing is one owner for "which keys, in what order, in what
state" — today that is re-spelled in `runs.tsx` and absent from the mention
port.

## Rung 2 — installed dependencies

Searched: Base UI Select docs (`Select.Item`, `Select.ItemText`, accessible
labels) and the installed `@base-ui/react/select` source used by
`ControlSelect`.

Found: `Select.Item` renders arbitrary children, so a leading mark needs no new
primitive; the `label` prop only drives type-ahead, and an accessible name can
come from `aria-label`. Base UI supplies no availability semantics, which is
Yunari's fact rather than a component concern.

## Rung 3 — native platform

Searched: CSS custom properties, `aria-hidden`, `aria-label`, and the existing
`editor-shell.css` role tokens.

Found: a 6 px span coloured by `--ok` / `--error` / `--faint` states the reading
with no script; `aria-hidden` keeps the dot out of the name, and `aria-label`
on the row carries the state as words. The platform supplies no "is this sensor
reporting" notion.

## Rung 4 — public solutions

Searched: Base UI Select "custom rendering" example (indicator before the item
text); the WAI-ARIA name calculation for options.

Found: the documented pattern for a leading indicator is an arbitrary child
inside `Select.Item`; accessible names come from `aria-label`. Neither answers
which keys exist or what their state is, so they settle the rendering, not the
list.

## Rung 5 — integration comparison

| Option | Fit | Unsolved work | Verdict |
|---|---|---|---|
| Keep two independent lists | No | State, order and retained-key rules stay duplicated | Reject |
| Family headings plus dots | Partial | Still spends a row per family; the issue asks for compact | Reject |
| One pure option builder, two renderers | Yes | Dot markup exists in React and plain DOM | Build |

## Rung 6 — smallest probe

Not needed: `ControlSelect` already renders `Select.Item` children and the
mention overlay already appends rows to a `role="listbox"`; the change is the
same data through existing seams. Behavior is covered by the run-picker and
inline-insert suites.

## Decision

`sensor-key-options.ts` owns the compact list: catalogue order without family
headings, a discovered key in its family's place, a binding the catalogue no
longer lists at the end, and one status per key (reporting / bound but
unavailable / unknown) computed from the host's `measured` set and the theme's
bound keys. `SensorKeyDot` draws the same state in the picker; the mention
overlay reuses the builder, the `.editor-shell-sensor-dot` class and the
accessible-name helper, so the two surfaces cannot disagree. Family headings
stay available in `ControlSelect` for its other consumers; this picker no longer
uses them.
