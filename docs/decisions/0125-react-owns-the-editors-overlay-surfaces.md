# 0125 — React owns the editor's status line, tooltip and transform readouts

- **Date:** 2026-11-08
- **Status:** accepted
- **Paths:** `src/web/packages/editor/src/editor-shell/shell-layout.tsx`, `src/web/packages/editor/src/editor-session.ts`, `src/web/packages/editor/src/components/ui/control-icon-button.tsx`, `src/web/packages/editor/src/components/ui/control-well.tsx`

## Problem

Three visible surfaces in a React shell are still built imperatively: the
status message (`textContent` writes into a mounted span), the one tooltip
(a `document.createElement` popup with hand-managed listeners) and the
rotation/size readouts (elements created and moved outside React). Each has a
second writer React cannot see, and a change to the surrounding chrome has to
remember it. A wrong choice here fails quietly: the surface keeps working until
the React neighbourhood re-renders over it, or until a component that owns the
trigger unmounts and leaves the popup behind.

## Rung 1 — internal owner

Searched (CodeGraph and source): `shell-layout.tsx` (`ShellHosts`, `Host`,
`StatusReadout`, `SaveState`), `editor-main.ts` (`status.textContent` writes),
`editor-shell/controls/tooltip.ts`, `components/ui/control-icon-button.tsx`
(`useControlTooltip`), `components/ui/control-well.tsx` (`ControlRow`),
`panes/add/add-pane.tsx`, `editor-shell/canvas-dock.tsx`,
`indicator-manager/index.ts`, `indicator-manager/cursor-indicator.ts`,
`editor-session.ts`.

Found: the shell already owns cross-boundary state through small external
stores read with `useSyncExternalStore` — `SelectionStore`, `SheetStore`,
`FinderStore`, `PaneRequestStore` in `editor-shell/shell-stores.ts`. Panels that
are still imperative are mounted through `Host` nodes; the footer's status span
is the only one whose *content* is a single string. The tooltip's own docblock
says every caller is React except the selection inspector, and the inspector now
mounts React roots, so the stated reason for the DOM function is stale. The
transform readouts are the only elements the session creates outside React.

## Rung 2 — installed dependencies

Searched: `@base-ui/react@^1.8.0` in `packages/editor/package.json`; its
`tooltip` module source and types (`Root`, `Trigger`, `Portal`, `Positioner`,
`Popup`, `trigger/TooltipTrigger.js`, `positioner/TooltipPositioner.js`,
`docs/react/components/tooltip.md`); React's `useSyncExternalStore`.

Found: `Tooltip.Root` + `Tooltip.Trigger delay` + `Tooltip.Portal` +
`Tooltip.Positioner side sideOffset collisionPadding` already donate hover-open
with a delay, focus-open without one, Escape/outside-press dismissal, and
floating-ui positioning that measures the popup after its final width. This
repository used exactly that composition in `canvas-dock.tsx` before commit
`a3be139b1` replaced it with the DOM function. The component does not wire
`aria-describedby` itself, so the conversion keeps that one line.

## Rung 3 — native platform

Searched: DOM pointer/focus events, `createPortal`, `position: fixed`, the
existing `cursor-indicator.ts` geometry (offset 16px, edge clamp, `pointer-events:
none`).

Found: the platform supplies everything the readouts need except one owner for
the element; a React element can be positioned by writing `transform` through a
ref without a render.

## Rung 4 — public solutions

Searched: the Base UI tooltip documentation shipped with the installed version
(`docs/react/components/tooltip.md`: anatomy, `Tooltip.Trigger` delay, detached
triggers, controlled mode, positioner sizing) and the repository's own prior
Base UI composition (`a3be139b1^:editor-shell/canvas-dock.tsx`).

Found: the documented composition is Root → Trigger → Portal → Positioner →
Popup, exactly the shape the dock used. The docs' "controlled mode" is the hook
for keeping a single popup open, which the DOM module enforced with a module
singleton.

## Rung 5 — integration comparison

| Option | Fit | Unsolved work | Verdict |
|---|---|---|---|
| Base UI Tooltip component, trigger rendered by `Tooltip.Trigger render` | donates positioning/dismissal, matches the package already in use | one `aria-describedby` line, one module-level exclusive-open guard, jsdom test stubs | chosen |
| Keep the DOM function, wrap its calls in a React effect | no new dependency | the popup is still outside the React tree — the defect the issue names | rejected |
| Hand-rolled React popup with `createPortal` + the existing `place()` | fully React | reimplements positioning and dismissal the installed dependency already donates | rejected |
| Status line as context | idiomatic | provider needed across the bridge boundary the editor writes through | rejected |
| Status line as an external store beside `SheetStore` | matches the shell's existing seam; writable from `editor-main` before the tree mounts | one small class | chosen |
| Indicators as React state with x/y in state | one owner | a render per pointer move | rejected |
| Indicators as a store for text/visibility, position written through a ref | one owner, no render per frame | a ref bound per indicator | chosen |

## Rung 6 — smallest probe

The new jsdom suites are the probe: they mount each converted surface, open the
tooltip with real `focus()`, drive the Fabric events, and assert the popup and
readouts. Base UI's jsdom needs `ResizeObserver`, `getAnimations` and
`PointerEvent` stubs already supplied by other editor DOM suites for the same
dependency; the probe established which suites needed them added.

## Decision

The status message becomes a `StatusMessageStore` in `shell-stores.ts`, written
by `editor-main` and rendered by a footer component; the `Host` node and every
`textContent` write are deleted. The tooltip becomes `ControlTooltip`, a Base UI
composition in `editor-shell/controls/tooltip.tsx`, and `useControlTooltip`'s
callers render it around their existing trigger element; `tooltip.ts` and its
test are deleted. The transform readouts become an `IndicatorStore` published by
the same Fabric handlers (formatting stays in `indicator-manager/index.ts`), and
a React `CursorIndicator` renders the two elements inside the shell; position is
written through a ref, text and visibility through the store.
`cursor-indicator.ts` (the element factory) is deleted.

**The tooltip's layer belongs to the positioner.** 0004 raised `.editor-shell-tooltip`
to `90` because the DOM function owned and portalled the popup element itself.
Base UI's popup is a static child of a positioned `Tooltip.Positioner`, so the
`z-index` moves to `.editor-shell-tooltip-positioner`; a number on the popup
would be inert. The scale (`90` above the dialog pair `70`/`71` and the select
positioner `80`) and the `pointer-events: none` reasoning are unchanged. jsdom
cannot see stacking or portal layering, so the proof for this rule is a
browser check, not a unit test.
