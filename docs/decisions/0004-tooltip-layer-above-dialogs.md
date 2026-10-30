# 0004 — the tooltip layer sits above every dialog

- **Date:** 2026-10-30
- **Status:** accepted
- **Paths:** `src/web/packages/editor/src/components/ui/control-select.tsx` and `src/web/packages/editor/src/editor-shell/editor-shell.css`

## Problem

A control inside an editor dialog — the asset finder's toolbar, the asset
preview's foot — mounts its tooltip by `tooltip()`, which appends the popup to
`body`. The dialog is also a `body` child, at `z-index: 71`, while
`.editor-shell-tooltip` stood at `50`. The label therefore rendered under the
dialog it described: it existed, was announced by `aria-describedby`, and could
not be seen. The failure is silent in behaviour tests, because the popup exists
and the description reaches a screen reader.

## Rung 1 — internal owner

Searched: CodeGraph and source for `tooltip`, `useControlTooltip`,
`editor-shell-tooltip`, `editor-shell-dialog`, `z-80` and every
`z-index` in `editor-shell.css`.

Found: `editor-shell/controls/tooltip.ts` is the one owner of a tooltip's DOM
and portalling. `editor-shell.css` owns the shell's layer scale: menu and select
`60`, dialog scrim `70`, dialog `71`, select positioner `80`.
`control-select.tsx` already documents that scale and raises the select above
the dialog for the same reason. The tooltip's own `50` predates dialogs that
contain controls.

## Rung 2 — installed dependencies

Searched: `@base-ui/react/dialog` and tooltip sources in `node_modules`,
including their portal and focus-trap behaviour.

Found: Base UI's dialog is portalled and modal; its focus trap means no editor
control behind the dialog can be hovered or focused while it is open, so a
tooltip raised above the dialog cannot be triggered from behind it. Base UI
does not order the editor's hand-owned tooltip.

## Rung 3 — native platform

Searched: CSS stacking contexts, `position: fixed` and `z-index` as implemented
by the browser.

Found: two portalled `body` siblings are ordered by `z-index`, then DOM order.
The tooltip is appended later, but `50 < 71` decides first. The platform offers
no z-index that "inherits from the trigger"; the layer must be raised or the
tooltip must be portalled into the dialog, which would break `body`-sibling
dismissal and the single-open-tooltip invariant.

## Rung 4 — public solutions

Searched: "CSS tooltip inside modal hidden behind dialog stacking context
z-index portal body"; read radix-ui/primitives#368, chakra-ui#1604,
ant-design#11304, vuetify#5494 and Cloudflare kumo's z-index removal.

Found: every implementation hits the same two `body` siblings. Radix answers
that this is stacking-context order and recommends a root stacking context;
Chakra's confirmed workaround is a tooltip `z-index` above the modal; Ant
Design names the same. Kumo removed per-component z-index entirely and relies
on DOM order, which only works while every portal is at the document body and
none is fixed at a lower number. Yunari's layer scale is explicit, so the fit is
to place the tooltip at the top of that scale.

## Rung 5 — integration comparison

| Option | Fit | Unsolved work | Verdict |
|---|---|---|---|
| Raise `.editor-shell-tooltip` to `90` | One CSS number; one scale already documented | None | Chosen |
| Portal the tooltip into the open dialog's popup | Tooltip then inherits the dialog's stacking | Must find the dialog, keep dismissal and single-open ownership, and unmount with it | Rejected |
| Remove z-index and rely on DOM order (Kumo) | Later append wins | Every fixed layer in the scale would have to be re-ordered; the dialog is `position: fixed` and would still cover an unnumbered popup | Rejected |
| Root stacking context only (Radix) | Sound general advice | Does not help two `body` siblings from the same root; the dialog still outranks the tooltip | Rejected |

## Rung 6 — smallest probe

The existing browser test surface locates `.editor-shell-tooltip` and the dialog
classes. The probe is the DOM's own computed order: open the asset finder,
hover a toolbar glyph, and read the tooltip and dialog `z-index` from the
rendered page. Before the change the tooltip reported `50` under a `71` dialog;
after it reports `90`, above the popup and the select positioner.

## Decision

The tooltip is the top layer of the shell's floating scale: `z-index: 90`,
above the dialog pair (`70`/`71`) and the select positioner (`80`). It keeps
`pointer-events: none`, so being above a modal cannot steal a press. The layer
order is stated in `editor-shell.css` and in `control-select.tsx`, where the
next reader looks.
