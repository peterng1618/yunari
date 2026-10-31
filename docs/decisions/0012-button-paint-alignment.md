# 0012 — Align the shared button and icon-button paint with DESIGN.md

- **Date:** 2026-10-31
- **Status:** accepted
- **Paths:** `src/web/packages/editor/src/components/ui/control-icon-button.tsx`, `src/web/packages/editor/src/components/ui/control-well.tsx`, `src/web/packages/editor/src/components/ui/dialog.tsx`

## Problem

Three shared control tokens had drifted from the design language or from each
other: a disabled icon button still answered hover, the plain-button token
carried `text-text` beside a caller's `text-hot`, and the labelled button was
painted by two owners with different fill, radius and hover roles. A wrong
choice here is silent: the component compiles and only the rendered tone or
shape differs.

## Rung 1 — internal owner

Searched the editor package for every reader of `ACTION_BUTTON`,
`plainButtonClasses` and `ControlIconButton`, plus `.editor-shell-dialog >
button` in `editor-shell.css`. Found: `ACTION_BUTTON` is the labelled-button
token used by eleven dialogs; `.editor-shell-dialog > button` is the same
control for two dialogs that draw a button directly; `plainButtonClasses` is
the plain-button token used by seven panes; `ControlIconButton` is shared by
the layer panel, selection lead, pager, gallery and item modal. `dialog.tsx`
already spells `enabled:hover:` and `disabled:text-faint`, so the intended
pattern exists in the owner of the same control class. `DESIGN.md` §2, §3, §4
and §5 rule 6 give the values: labelled button fill `--yunari-control-bg`,
radius `--radius-md` (6px), hover raises `--edge` to `--muted`; headings are UI
sans. No second owner was found for those values.

## Rung 2 — installed dependencies

Searched the installed Tailwind entry in `packages/editor/src/editor-shell/editor-shell.css`
and the built utility usage across the editor package. Found: the `enabled:`
and `disabled:` variants are already used by `dialog.tsx`, and the project
composes these utilities as strings rather than through a component library.
No dependency donates a button variant model that fits the closed control
vocabulary without adding a second vocabulary.

## Rung 3 — native platform

Searched CSS custom-property and `:enabled`/`:hover` behaviour. Found: the
platform already distinguishes a disabled control from a hovered one, and a
custom property resolves at computed-value time. No platform feature chooses
which design token a control should wear; that decision belongs to DESIGN.md.

## Rung 4 — public solutions

Searched DESIGN.md and the current drawings under `docs/design/mockups/current/`
for the labelled button, icon button and section headings. Found: the drawings
draw the labelled button at the control fill and 6px radius, headings in
`system-ui`, and no drawing grants a hover colour change. No public library
solution selects here because the values are the product's own design
language, not a framework default.

## Rung 5 — integration comparison

| Option | Fit | Unsolved work | Verdict |
|---|---|---|---|
| Keep two owners and align both by hand | Matches the existing class-string idiom | The strings can drift again | Rejected: the issue is drift |
| Move both to a component | Gives one owner | Adds a component for a string with no behaviour, against the closed-control note in `control-well.tsx` | Rejected |
| Align both strings to DESIGN.md and pin the constant | Shortest diff, keeps the existing seam | None material | Chosen |

## Rung 6 — smallest probe

No executable probe decides a token value. The rendered states were read from
the existing `dialog.tsx` implementation, which already carries the `enabled:`
qualifier, and the values from DESIGN.md. A DOM test cannot resolve Tailwind
utilities in jsdom, so the check is the design gate plus the component tests
that already mount these controls.

## Decision

Reuse the design language rather than add a variant system: the icon button
gains `enabled:` on its hover utilities, `plainButtonClasses` stops restating
the inherited text colour so a caller's colour utility is the only one on the
element, and `ACTION_BUTTON` takes the labelled button's fill, radius and
muted hover from DESIGN.md. The dialog's own button rule keeps the same values
for the two surfaces that draw a button without the token.
