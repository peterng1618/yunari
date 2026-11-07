# 0124 — edit a referenced design token from its run row

- **Date:** 2026-11-08
- **Status:** accepted
- **Paths:** `src/web/packages/editor/src/components/ui/colour-picker.tsx`,
  `src/web/packages/editor/src/components/ui/use-colour-picker.ts`,
  `src/web/packages/editor/src/components/ui/control-select.tsx`,
  `src/web/packages/editor/src/components/ui/control-well.tsx`,
  `src/web/packages/editor/src/editor-session.ts`,
  `src/web/packages/editor/src/editor-shell/shell-layout.tsx`

## Problem

The selection inspector's run rows reference a type token and a paint token by
id. Editing the referenced token means changing document globals, not the run.
A second mutation or selection path would let the row, the Tokens pane and the
token inspector disagree about a token's value, its history entry and which
token is selected. The row also needs an "Add new token" entry that creates,
applies and reveals a token without restating creation or selection.

## Rung 1 — internal owner

Searched: `codegraph_explore` for `RunEditor RunRow chooseToken`,
`TokenInspectorActions TokenFields PaintFields`, `createPalettePanel PaintList`,
`createTypeTokenPanel`, `TokenSelectionStore`, `createShellLayout showLayers`,
and `createEditPorts runEdits`.

Found: `TokenInspectorActions` already owns every type-token write
(`panes/tokens/token-inspector.tsx`) and `paints.onChange` owns every paint-token
write; both route to `EditorDocument.setTypes` / `setPalette`. Creation was
inline in `PaintList.add` and `createTypeTokenPanel`'s `onAdd`. Selection is
`TokenSelectionStore.set`. Pane reveal already exists as
`PaneRequestStore.show("composition")` behind `ShellLayout.showLayers`. The
original colour popover body is embedded in `ColourPicker`; the family/weight
controls are embedded in `TokenFields`. What remains unsolved is extraction, not
new behaviour.

## Rung 2 — installed dependencies

Searched: the installed `@base-ui/react` 1.9.0 (declared `^1.8.0`) Popover
(`Popover.Root/Trigger/Portal/Positioner/Popup`, controlled `open`/`onOpenChange`)
and its `useDismiss`/`FloatingNode` source; `Select`'s option list and its
portalled popup; `ContextMenu`'s controlled portal.

Found: Base UI popovers anchor to their trigger through `Positioner`, return
focus to it on close, and `useDismiss` treats a node registered in the same
floating tree as inside. The installed source registers `Popover.Positioner` as
a `FloatingNode` and a `ContextMenu.Popup`'s node takes that positioner as its
parent, which suggests the preset context menu opened inside the row popover is
treated as a child and does not dismiss it. **That nested-menu case is
source-read, not exercised in a browser here**, so it is recorded as unverified;
the existing `menu !== undefined` guard in `ColourPicker` is kept until a
browser probe says it is unnecessary.

## Rung 3 — native platform

Searched: the HTML `popover` attribute and the Popover API; jsdom's support.

Found: the native Popover API provides top-layer display and light dismiss but
no trigger anchoring, focus return contract or nested-surface membership; jsdom
does not implement `:popover-open`, and the run suite already has to shim it for
Base UI. It leaves the integration work unsolved.

## Rung 4 — public solutions

Searched: Base UI Popover docs (`Popover.Root` `onOpenChange`, `handle` for an
external trigger, `defaultTriggerId`; animation close-phase actions) and the
Base UI `useDismiss` nested-floating-tree test/source; Radix UI Popover's
`Anchor`/`Portal` model; the `popover` attribute and `popoverTarget` API on MDN.

Found: Base UI and Radix both keep anchoring and dismiss semantics in the
popover primitive and expect controlled composition for nested surfaces; the
native attribute covers neither anchoring nor tree membership. Base UI is the
one already installed and already used by this file.

## Rung 5 — integration comparison

| Option | Fit | Unsolved work | Verdict |
|---|---|---|---|
| Reuse `ColourPicker` whole inside a second popover | Wrong: nests a trigger and a second popover | Two open layers, focus return to an inner trigger | Reject |
| Extract `ColourPicker`'s popup body and render it directly in the row popover | Fits: one picker state, no nested trigger | Move the preset-menu guard up to the wrapper | Accept |
| New inline colour UI for the row | Second mutation UI and validation | Duplicate draft/refusal behaviour | Reject |
| Native `popover` attribute | No anchoring or nested membership | Rewrite dismiss and focus handling | Reject |
| Re-implement creation in the row | Second id/duplicate rule | Drift from the pane's add | Reject |

## Rung 6 — smallest probe

Behaviour was already established by the existing `colour-picker.dom` and
`runs.dom.test` suites, which drive the real controls through Base UI. The
refactor keeps every `data-testid` and `data-yunari-*` hook, so those suites are
the probe that the extraction did not change behaviour.

## Decision

Extract the picker's popup body into `ColourPickerPanel` and the family/weight
controls into `TokenFaceFields`; render each directly inside one Base UI
`Popover` anchored at the run row's Edit trigger. Both surfaces call the same
`TokenInspectorActions` object the token inspector already receives — no second
mutation path. Creation moves to `addPaintToken` / `addTypeToken` in
`editor-session-tokens.ts`, and the Tokens pane and the run row both call them.
Selection stays `TokenSelectionStore.set`, and the Tokens pane is revealed
through a new `ShellLayout.showTokens()` that asks the same
`PaneRequestStore` as `showLayers`. The session runs creation and the run's new
reference inside `historyManager.suspend()` and settles one entry afterwards, so
the gesture is one undo step; the pane is revealed only when the run accepted
the reference.
