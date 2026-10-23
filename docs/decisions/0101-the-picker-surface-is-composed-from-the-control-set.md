# 0101 — The picker surface and its preset menu are composed from the control set

- **Date:** 2026-10-23
- **Status:** accepted
- **Paths:** `src/web/packages/editor/src/components/ui/colour-picker.tsx`,
  `src/web/packages/editor/src/components/ui/preset-context-menu.tsx`,
  `src/web/packages/editor/src/components/ui/gradient-editor.tsx`

## The problem

The rebuilt picker has to render a 2-D saturation × brightness area, hue and
alpha tracks, one text field, a preset library row and an eyedropper — inside
an editor that already owns one control vocabulary (§5), one copy table, one
primitive library and one live/settled state hook. A picker built from scratch
is how a second focus ring, a second swatch and a second text-commit rule
arrive. The preset row also needs a context menu that is controlled by a
pointer rect rather than a trigger element, which is the shape the canvas
menu already solved.

## Rung 1 — Yunari

Searched: `Popover.` and `ContextMenu.` under `packages/editor/src`,
`ControlText`, `ControlChoiceRow`, `ControlIconButton`, `RadioGroup`,
`useColourPicker`, `usePresetLibrary`, `nextTrackRatio`, `Track`.

Found: `editor-shell/canvas-context-menu.tsx` is a controlled
`ContextMenu.Root` with no `ContextMenu.Trigger`, anchored to a zero-sized
rect — the exact preset-menu shape. `control-choice-row.tsx` is the closed-set
row and `RadioGroup` owns its roving focus. `useColourPicker` (decision 0100)
owns live/settled, text refusal and the `EyeDropper` feature test.
`usePresetLibrary` is a `useSyncExternalStore` reader with `deletePreset`.
`ControlText` owns draft/Enter/Escape. The old `colour-picker.tsx` draws its
own two tracks and its own popover classes; its `Track` component is the only
prior art and its hex/neutral palette is what the rebuild replaces.

## Rung 2 — dependencies

Searched: every `package.json` under `src/web/packages`; `require.resolve`
for `react-colorful`, `@uiw/react-color`, `colord`, `@base-ui/react`,
`culori`, `lucide-react`.

Found: the first three are **absent**; `@base-ui/react`, `culori` and
`lucide-react` are installed. The installed set supplies the popover, radio
group, context menu, conversions and the pipette glyph. Nothing installed
draws a colour area or a preset row.

## Rung 3 — platform

Searched: `<input type="color">` and `EyeDropper` (already handled by 0100);
CSS gradients and `conic-gradient`; ARIA `slider` value semantics.

Found: `<input type="color">` has no alpha channel and no preset row, so it
cannot carry the theme's translucent paints. `EyeDropper` is feature-tested in
the hook. A checkerboard is a CSS `repeating-conic-gradient`, and the area is
two linear gradients. A 2-D slider has one `aria-valuenow`, so both channels
are announced through `aria-valuetext` — a platform limitation, not a design
choice.

## Rung 4 — ecosystem

Searched: npm metadata knowledge for `react-colorful@5.8.1`,
`@uiw/react-color@2.10.3`, `colord@2.10.0`; the ReUI picker block this work
follows (decision 0098) and the engine `026`/`027` decisions; the installed
`@base-ui/react` popover and context-menu primitives.

Found: every standalone picker library owns its DOM and state, so adopting one
replaces `ControlRow`/`ControlWell`/`ControlText` and loses the copy and
token gates. ReUI's block is the interaction model the spec follows but its
source is kept out, and it has no preset-library or context-menu row. Base UI
publishes the popover, radio and context-menu mechanics but no colour surface.
Nobody in this set solves "picker surface inside this control set with a
preset library row and a pointer-anchored delete menu".

## Rung 5 — comparison

| Option | Fit | Cost | Risk | Verdict |
|---|---|---|---|---|
| `<input type="color">` | Native | None | No alpha, no presets, no tokens | Rejected |
| `react-colorful` / `@uiw/react-color` | Complete picker | New dependency, own DOM, own state | Bypasses the control set and the copy/token gates | Rejected |
| Copy ReUI's block | Closest interaction | Vendored source, no tests | Ruled against (spec ruling 4/7) | Rejected |
| **Compose `Popover`, `RadioGroup`, `ControlText`, `ControlChoiceRow`, `ControlIconButton` and local area/track bodies over `useColourPicker`** | Uses the one vocabulary and the one state owner | ~250 lines + DOM tests | Small: the area and track bodies are paint plus the existing channel maths | **Accepted** |

## Rung 6 — probe

`node -e` over `src/web`: `react-colorful`, `@uiw/react-color` and `colord`
report absent; `@base-ui/react`, `culori` and `lucide-react` resolve. The
justification shape is probed by the DOM tests: a pointer gesture emits more
than one live value and exactly one settled value, an arrow key emits and
settles once, and a refused draft emits nothing while keeping the text. The
menu is probed by rendering it with and without a target.

## Decision

`colour-picker.tsx` composes the installed primitives and the control set
around `useColourPicker`, with a local area and a local channel track as paint
plus the existing keyboard/pointer wiring; `preset-context-menu.tsx` copies
the canvas menu's controlled, pointer-anchored `ContextMenu.Root`. Neither
introduces a dependency, a second state owner or a second control vocabulary.

`gradient-editor.tsx` is claimed only because it imports the parser this task
deletes and mounts the picker whose props this task changes; its own rebuild
is Task 8, and this note records no decision about that surface.
