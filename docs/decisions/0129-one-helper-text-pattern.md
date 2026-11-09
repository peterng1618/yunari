# 0129 — one helper-text pattern for hand-built fields

- **Date:** 2026-11-10
- **Status:** accepted
- **Paths:** `src/web/packages/editor/src/components/ui/control-hint.tsx`

## Problem

Explanatory sentences for controls appear as three different footnote
paragraphs: `text-xs text-muted`, `text-2xs text-faint`, and `text-sm
text-muted` in the settings surface, each under a hand-built field or dialog
control. The visual language is inconsistent, and the sentence is only
readable by looking at the field's foot. Controls built from `ControlRow`
already have one answer — a `hint` that reaches the author through a tooltip
and the control's `aria-describedby` — but a hand-built field (a panel
dialog's number well, a source form's address input) has no row to hand its
hint to, so it invents a paragraph.

## Rung 1 — internal owner

Searched: `ControlRow`, `ControlTooltip`, `ControlIconButton`,
`useControlIds`, and every `hint` call site under `packages/editor/src`
(CodeGraph `control-well hint` plus grep of `hint=` in JSX).

Found: `ControlRow` owns the row's hint: `tip = hint`, wrapped in
`ControlTooltip`, plus an `sr-only` paragraph the control is described by.
`ControlTooltip` owns the one tooltip (hover delay, focus-immediate,
portal, `aria-describedby` merge). `ControlIconButton` owns the 26px
icon action's name/tooltip pairing. Nothing owns a hint for a field that is
not a `ControlRow` — that gap is what produced the inline paragraphs.

## Rung 2 — installed dependencies

Searched: `@base-ui/react/tooltip` source and `editor-shell/controls/tooltip.tsx`.

Found: `Tooltip.Trigger` donates hover/focus open, close-on-blur/escape,
portal and positioning; the repo wrapper already fixes the delay to 220ms and
merges `aria-describedby` rather than replacing it. No new dependency is
needed.

## Rung 3 — native platform

Searched: HTML `button`, `aria-label`, `aria-describedby`, and the `title`
attribute.

Found: `title` is not revealed on focus and is not reliably announced as a
description, so it cannot carry help for a keyboard or screen-reader author.
A real `<button>` with `aria-label` is focusable and named; paired with the
installed tooltip it covers pointer and keyboard alike.

## Rung 4 — public solutions

Searched: Base UI Tooltip docs (Context7 `/websites/base-ui_react`,
`Tooltip.Trigger` — delay, `render`, focus behavior, accessible-name
guidance), and the toolbar composition example.

Found: Base UI's documented pattern for a glyph trigger is an
`aria-label` on the trigger plus a tooltip payload; the docs' own examples
name an icon trigger with the sentence of its action. It handles hover and
focus opening and closing; it leaves the choice of mark and the sentence
wording to the caller, which is exactly the seam this note fills.

## Rung 5 — integration comparison

| Option | Fit | Unsolved work | Verdict |
|---|---|---|---|
| Keep per-surface paragraphs | no | three visual weights and no keyboard route | rejected |
| Native `title` only | no | no focus reveal, weak announcement | rejected |
| New dependency (Radix/Headless tooltip) | no | a second tooltip vocabulary beside `ControlTooltip` | rejected |
| `ControlHint` over the installed `ControlTooltip` + `INFO_GLYPH` | yes | none; naming and mark are the caller's | chosen |

## Rung 6 — smallest probe

The existing `ControlRow` tooltip already proves the trigger/name pairing in
jsdom (`control-well` suites) and the browser suites; `ControlHint` is the
same pairing at a smaller mark, so no separate probe was needed. Rendering it
in the panel-controls dialog and the source form and running their DOM suites
is the check.

## Decision

Add `ControlHint`: an info-glyph button whose accessible name and tooltip are
the one sentence, using the installed `ControlTooltip` and `INFO_GLYPH`.
Convert the helper paragraphs on hand-built fields to it — the panel dialog's
brightness and settings hints, the source form's field hint, and the video
trim hint — while the display presentation's two paragraphs become the
`hint` prop their existing `ControlSlider`/`ControlSegmented` already
support. Status, counts, refusals, file data and dialog prose stay visible
text: they are state, not help.
