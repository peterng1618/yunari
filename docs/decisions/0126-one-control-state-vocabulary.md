# 0126 — one control state vocabulary

- **Date:** 2026-11-08
- **Status:** accepted
- **Paths:** `src/web/packages/editor/src/components/ui/control-state.ts`

## Problem

Every button on every surface needs the same hover, selected, in-progress and
outcome states, and async actions currently spell their own: the finder's
`data-yunari-asset-action-busy`, the assign dialog's changing label, the
publishing toggle's `pending`, the chooser's `removing`. Each is invisible to
the next control, and none carries an outcome other than a sentence elsewhere on
the page. A second spelling would make "busy" mean two things.

## Rung 1 — internal owner

Searched: CodeGraph for button/control state, `ControlIconButton`,
`ACTION_BUTTON`, `ActionBox`, `data-yunari-destructive`, `aria-pressed`,
`aria-busy`, plus `editor-shell.control-rules.test.ts`.

Found: `ControlIconButton` owns hover (`enabled:hover:border-muted`), selected
(`aria-pressed`) and blocked (`text-faint`) for icon actions; `ControlToggle` and
`ControlSegmented` own selected through Base UI's pressed/checked state;
`destructiveMarker` already demonstrates one shared attribute painted by one
unlayered rule. `aria-busy` exists only on loading regions, never as a control
state. No shared outcome state exists. Unsolved: one caller-settable state
vocabulary and one paint rule.

## Rung 2 — installed dependencies

Searched: React 19 `HTMLAttributes`/ARIA typing; `@base-ui/react` toggle,
switch and dialog source and the installed `control-*.dom.test.tsx` suites.

Found: React passes `aria-busy`, `aria-pressed` and arbitrary `data-*` straight
through; Base UI contributes pressed/checked state but no busy/outcome state.
No dependency owns this vocabulary, and none needs to be added.

## Rung 3 — native platform

Searched: ARIA 1.2 `aria-busy`, `aria-pressed`, `aria-disabled`; CSS
`:hover`, `:focus-visible`, `:disabled` and attribute selectors.

Found: the platform provides every state an assistive reader needs except
success/failure, which has no ARIA token. The platform leaves the visual
treatment and the outcome attribute to the author.

## Rung 4 — public solutions

Searched: WAI-ARIA Authoring Practices (button pattern, `aria-busy` and
`aria-disabled` guidance), MDN `:disabled`/`aria-disabled`, and the established
"data-state" pattern used by headless UI libraries (Radix, Base UI) for
non-ARIA visual states.

Found: busy belongs on `aria-busy` plus a disabled control; selected belongs on
`aria-pressed`/`aria-checked`; a non-ARIA outcome is conventionally a
`data-*` attribute. No library is needed for three attributes and one rule.

## Rung 5 — integration comparison

| Option | Fit | Unsolved work | Verdict |
|---|---|---|---|
| Per-control class strings | diverges silently; two controls can drift | every caller repeats the mapping | reject |
| A new headless UI dependency | supplies pressed/checked only; adds a package to two bundles | outcome/busy still custom | reject |
| One helper + one documented attribute + one unlayered CSS rule | shared by every editor button; host pages can spell the same documented attribute | host admin and `pair.html` own their CSS | accept |

## Rung 6 — smallest probe

Behavior is established by the existing text-read guard:
`editor-shell.control-rules.test.ts` already reads the stylesheet's rule bodies
(no jsdom cascade), so the new rule and its tokens are asserted there and the
attribute helper is asserted in `control-state.test.ts`. No browser probe is
needed because the change is one attribute plus one colour rule, not a
sampling, scheduling or lifecycle mechanism.

## Decision

Build the minimum: `control-state.ts` owns the type and attribute spelling, the
`@theme static` block owns the three state tokens, and one unlayered rule paints
`busy`/`success`/`failure` for every surface. Hover, focus and selected stay with
the controls that already own them. The host's separate bundles reuse the
documented attribute and CSS surface locally, because they cannot import the
editor bundle.
