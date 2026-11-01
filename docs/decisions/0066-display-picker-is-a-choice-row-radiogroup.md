# 0066 — The display picker is a radiogroup of choice rows

- **Date:** 2026-11-01
- **Status:** accepted
- **Paths:**
  - `src/web/packages/editor/src/components/ui/control-choice-row.tsx`

## Problem

Host mode's display picker is a `ToggleGroup` of `Toggle` buttons painted as
cards. The selection is a closed, exactly-one set, but it is announced as three
independent toggles, the pressed state is only a border shift, and the drawn
shape is none of the control set's shapes. DESIGN.md rule 7 requires a set too
large for `Segmented` to be choice rows, one radio in one labelled radiogroup.
The rows also carry a per-display fact (the theme it shows, and whether that
theme is followed from this PC) after the name, which the choice row has no
place for.

## Rung 1 — internal owner

Searched: `ControlChoiceRow`, `ChoiceShape`, `ControlProps`, `RadioGroup`
call sites, `editor-shell/settings.tsx`, `colour-picker.tsx`,
`gradient-editor.tsx`, `host-settings-mode/region.tsx`.

Found: `control-choice-row.tsx` is the one owner of the choice row's geometry,
its `data-[checked]` lift to `--stage` and its accent border; the palette
settings and the colour picker already compose `RadioGroup` + `ControlChoiceRow`,
and `Radio.Root` derives `aria-checked` from the group so no row holds its own
bit. What it lacked was a trailing fact, so each choice-row caller would
otherwise have re-spelled the row to add one.

## Rung 2 — installed dependencies

Searched: `@base-ui/react/radio-group` and `@base-ui/react/radio` in
`node_modules`, plus `control-choice-row.dom.test.tsx` and
`control.dom.test.tsx`.

Found: `RadioGroup` owns `value`/`onValueChange`, the roving tab stop and the
arrow-key model; `Radio.Root` takes the accessible name from `aria-label` and
merges caller attributes through `data`. Nothing is donated for a secondary
description inside the row — `hint` is rendered `sr-only`, so a visible trailing
fact had to be caller content, not a new prop on the primitive.

## Rung 3 — native platform

Searched: native `<input type="radio">` and `role="radio"` behaviour.

Found: the platform supplies the semantics but not the editor's visual shape,
and the control set deliberately renders a `button` with `role="radio"` so the
chosen row can take the accent boundary. No native API draws a trailing detail.

## Rung 4 — public solutions

Searched: web search for the WAI-ARIA Authoring Practices radio group pattern
(`w3.org/WAI/ARIA/apg/patterns/radio/`, `.../examples/radio/`, MDN
`radiogroup` role), and Context7 was not needed because the primitive is already
installed and its source was read directly.

Found: the APG pattern states one Tab stop, arrows that move focus *and* check,
and the checked radio as the group's reported choice. It says nothing about a
row's secondary text; a `radio`'s accessible name is its content, so a visible
detail is part of the content and must not displace the name.

## Rung 5 — integration comparison

| Option | Fit | Unsolved work | Verdict |
|---|---|---|---|
| Keep `ToggleGroup`, restyle the pressed row | Wrong role — three toggles, not one choice; keyboard model is not the group's | None | Rejected |
| Compose `RadioGroup` in `region.tsx` with local row markup | Right role, but duplicates the row's classes and chosen treatment beside their owner | Two sources of truth for one row | Rejected |
| Extend `ControlChoiceRow` with a trailing `detail` node | Reuses the owner's row, its checked treatment and the group's keyboard model; the detail is caller content as `swatch` already is | The label needs `flex-1` only when a detail is present so the detail sits right | Accepted |

## Rung 6 — smallest probe

The existing `control-choice-row.dom.test.tsx` and the region's own jsdom
harness mount real Base UI radios; a region case asserting
`role="radiogroup"`, one `role="radio"` per display and a single
`aria-checked="true"` settles the integration without a browser probe.

## Decision

Reuse `RadioGroup` + `ControlChoiceRow`. The row gains one optional `detail`
node drawn after the name, right-aligned, and the name becomes `flex-1` only
when one is present, so a detail never reflows the card or chip shapes.

`region.tsx` replaces the `ToggleGroup` with `RadioGroup`, keeps the existing
`data-yunari-host-display*` attributes on the radio button (the row is the focus
target, as `ControlProps.data` requires), and moves the theme name and the
"follows" marker into the row's `detail`.
