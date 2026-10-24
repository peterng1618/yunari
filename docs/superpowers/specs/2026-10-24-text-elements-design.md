# Text and text box as separate Fabric elements

- **Status:** in progress. Plan: [`2026-10-24-text-elements.md`](../plans/2026-10-24-text-elements.md).

## Why

Yunari currently authors one text element with a `wrap` flag and always creates it
as Fabric's `Textbox`. That flag lies:

- The editor writes `wrap: false` into `yunariText`, but the live object stays a
  `Textbox`; nothing converts it, so Wrap Off changes no pixel until a reload.
- The player has the same shape: `authoredAlignment` reads the flag, but the
  object was already revived as its persisted class, so a `Textbox` with
  `wrap: false` still wraps.
- A plan-built scene does convert (`buildText`, `adapter.classFor`), so the same
  authored document renders as different Fabric classes depending on the path.

Fabric already owns this distinction with two editable classes: `IText` measures
its own width and never wraps; `Textbox` wraps inside a fixed width. The class is
persisted with the Fabric scene, so it is already the durable answer. The flag is
a second source of truth that loses.

The author also needs both behaviours. A strapline or a label should grow with
its text; a card's copy should wrap inside a fixed measure.

## Goals

- One element model per Fabric class: **Text** is an `IText`, **Text box** is a
  `Textbox`. The class is the only width-mode discriminator.
- The author chooses at creation: click places a Text, drag draws a Text box.
- Remove the authored `wrap` property and its inspector control.
- Show only controls that mean something for the selected class.
- Keep existing scenes rendering as they do now; no width-mode migration.

## Non-goals

- Converting an existing Text into a Text box, or the reverse. That is a separate
  future command, not a hidden side effect of a control.
- Changing shape, chart, group or image creation.
- New text styling, binding or sensor behaviour.
- Reworking Textbox vertical alignment, clipping or line capacity.

## Model

### Persisted class

The Fabric scene is the persisted scene, so its object `type` is the model:

| Element | Fabric class | Persisted `type` | Width | Height |
|---|---|---|---|---|
| Text | `IText` | `IText` / `i-text` | measured ink width | measured lines |
| Text box | `Textbox` | `Textbox` / `textbox` | authored box width | authored box height |

`FabricText` is the display-only base class; Fabric serialises it as
`type: "Text"` (its instance type is `text`). The player accepts it as an
auto-width Text; the editor does not create it, because Fabric puts editing on
`IText`, not on `FabricText`.

Loading an editor scene normalises a legacy `type: "Text"` object to `IText` so
it can be typed into, through the same revival path undo uses. That is not a width-mode conversion: geometry, runs and
styles are unchanged; only the class gains editing. The player keeps whichever
class it revives and renders both.

### Authored content

`TextContent` loses `wrap`:

- `box` stays, and is meaningful only on a Text box. A Text ignores it; the
  editor never writes it for an `IText`.
- `overflow` and `verticalAlign` stay, and are meaningful only on a Text box.
- `align` applies to both: a Text aligns its lines against its own measured
  width.
- `runs` are unchanged and work in both.

`PlanTextLayout.wrap` stays as a **derived** field: the plan builder sets it from
the element's class (`instanceof Textbox`), never from authored content. For a
Text, the derived layout is `wrap: false`, `overflow: "visible"`,
`verticalAlign: "top"`, no `maxLines`. Runtime code that branches on
`layout.wrap` keeps doing so; it is reading the class, not a flag.

`authoredAlignment` in `scene-fabric/fabric-text.ts` derives the same values from
the class and keeps reading authored `overflow`/`verticalAlign` only when the
object is a `Textbox`.

### Validation and persistence

- `fabric-envelope-validate.ts` recognises `Textbox` and `IText`, but its text
  test names `"FabricText"` rather than the serialised `"Text"`; this plan adds
  `"Text"` so a legacy auto-width object is validated as text. No new element
  type is introduced.
- The authored `wrap` key disappears. Old documents that still carry it are read
  normally and the key is ignored; it is not rejected, because the published
  schema allows arbitrary `yunariText` properties and rejecting would make old
  themes unopenable for no rendering difference.
- No theme-version bump and no migration pass. A saved `Textbox` with
  `wrap: false` already rendered wrapped, and will keep rendering wrapped.
- `box` validation is unchanged. A box on a Text is tolerated on load and
  ignored; the editor does not write one.

## Creation: one Text tool, click versus drag

The Add pane's Text tile, the canvas context menu's Text entry and the footer's
text action stay one action. They stop inserting immediately and instead arm a
one-shot placement gesture, because the pointer, not the menu, now decides the
element and where it lands.

### Arming

- Every surface arms through one call owned by the session's text route: the
  canvas context menu and footer already call `session.addText()`, and the Add
  pane's text tile stops constructing and arms the same route. They cannot drift
  into two placement states.
- While armed, the canvas cursor is a crosshair and canvas object selection is
  suppressed: the next primary press is the gesture, not a selection.
- Escape, a non-primary press, or a primary press outside the artboard cancels
  the gesture, disarms and creates nothing. A non-primary press does not also
  open the canvas context menu.
- After a completed gesture the tool disarms. It does not stay armed for a second
  text object.

### Gesture

- Press and release points are converted to scene units with Fabric's
  `canvas.getScenePoint`, so zoom and pan do not change the result.
- While the pointer moves, a transient dashed outline follows the rectangle the
  Text box would take. It is editor chrome, never persisted and never in
  history; a click shows no outline because there is nothing to draw yet.
- **Click** — pointer travel below **4 CSS pixels**: create a Text (`IText`)
  with its top-left at the press point. It has no authored box and takes its
  measured width and height.
- **Drag** — travel at or above 4 CSS pixels: create a Text box (`Textbox`)
  whose authored box is the normalised rectangle between press and release. The
  rectangle's top-left is the object's top-left; dragging up or left is
  normalised rather than refused. A drag whose normalised width or height is
  below 1 scene unit is treated as a click.
- Power-of-two rounding, artboard clamping and snapping are not part of this
  gesture; the author gets the rectangle they drew.

### Result

- Both classes start with the literal `New text` and the default type preset and
  paint a new object already receives.
- Both are selected and enter editing with all text selected, exactly as a new
  text does today. A Text measures itself as the author types; a Text box keeps
  the drawn width and wraps.
- The whole gesture is one history entry.
- A construction refusal (for example a theme with no usable palette reference)
  is reported through the error manager at gesture completion, creates nothing
  and leaves the tool disarmed. The arming step itself cannot fail.
- Default names are `Text` for a Text and `Text box` for a Text box, so layer
  rows that still carry their default name say which element the author has.

## Element contracts

### Text (`IText`)

- Width and height are measurements, refreshed by the text pass. No authored
  box, no clip path, no line capacity.
- Editing grows and shrinks the object as its content changes.
- Resize is scaling only: the default corner controls. The width-drag and
  height-drag handles that write an authored box are absent, because there is no
  box to write.
- Inspector shows: Runs, Align, the text fields (type preset, colour, reads),
  Add run, Font face, Position X/Y, measured W/H (read-only), Layer rotation and
  opacity.
- Inspector hides: Wrap, Overflow, vertical align, editable W/H, and the
  height-drag handle.

### Text box (`Textbox`)

- Width is the wrap measure; height is the authored box height. Text reflows
  inside the width and is clipped or ellipsised by the authored height and the
  overflow policy.
- Editing does not move the box.
- Resize keeps today's behaviour: edge drags write the authored box, corner
  drags scale.
- Inspector shows everything it shows today except Wrap: Runs, Align, vertical
  align, Overflow, editable W/H, text fields, Position, Layer.

### Shared

- Both are the same layer kind, `text`, with the same glyph. The kind word stays
  `Text`; the default object name carries the distinction.
- Runs, sensor bindings, authoring tokens, type presets, colours and font faces
  behave identically in both.
- The inspector's `SelectionView` already carries the derived layout; controls
  branch on `layout.wrap`, not on a new authored field.

## Ownership

- `packages/editor/src/text-manager/` owns text construction, gesture state and
  the class choice. Nothing else constructs a text object.
- `new-object-panel.ts` keeps the one construction entry point and the
  `constructing` refusal owner; it now completes at gesture end.
- `scene-fabric/fabric-text.ts` derives layout from the class and keeps
  `isTextObject` as the generic test.
- Textbox-only geometry stays explicitly Textbox-only: `guardBoxWidth`,
  `assertBox`, `writeAuthoredBoxDimension`, vertical alignment, clipping, line
  capacity, the width-drag measurer, the height handles and the text rule in
  `selection-eligibility`. None gains an implicit `instanceof IText` branch.
- `scene-fabric/src/adapter.ts` maps the derived `layout.wrap` to `IText` or
  `Textbox`, so plan-built and persisted scenes use the same classes. This is a
  reuse-gate path: a decision note is required before the first edit.
- `scene-fabric`'s `reviveScene` owns the legacy `"Text"` to `"IText"` rewrite
  through an editor-only option, so the mount and undo normalise identically.
  The player revives persisted classes and does not convert on render.
- `docs/architecture/ownership.md` gains the placement owner and the two element
  contracts. The docblocks in `document.ts` (`TextContent`), `authored-box.ts`
  and `fabric-text.ts` that describe the box as text's owner become
  Textbox-specific; they are current-truth comments, not history.

## Removal list

- `TextContent.wrap`.
- The Wrap segmented control, its copy and its writes in `runs.tsx`/`run-edits.ts`.
- `authored.wrap` reads in `authoredAlignment`.
- Tests and fixtures that author `wrap`, and the e2e case that asserts Wrap Off.
- The `nextNewObjectPlacement` call from text insertion (it stays for cards,
  charts and shapes).

## Verification

### Unit and DOM

- Click gesture creates an `IText` at the press point, with no authored box and
  no width write.
- Drag gesture creates a `Textbox` with the normalised box, including drags up
  and left; a sub-4-pixel drag creates a Text; a sub-1-unit box is treated as a
  click.
- Escape, non-primary press and an outside-artboard press create nothing and
  disarm.
- Both results are selected, editing and have all text selected; the creation is
  one history entry; undo removes it in one step.
- The inspector renders no Wrap control on either class, hides Overflow,
  vertical align and editable W/H on a Text, and keeps them on a Text box.
- Geometry writes refuse a width or height write on a Text.
- `authoredAlignment` derives wrap, overflow and vertical alignment from the
  class; a legacy authored `wrap` has no effect.
- Loading a `Textbox` with `wrap: false` keeps a `Textbox` and wraps.
- Loading a legacy `FabricText` in the editor yields an editable `IText` with
  unchanged geometry, runs and styles.

### Browser

- Add → Text → click on the artboard creates a Text that grows while typing and
  has no width/height handles.
- Add → Text → drag creates a Text box at the drawn rectangle, wraps inside it,
  and keeps the box while typing.
- Escape during placement leaves the document unchanged.
- Save, reload and reopen preserves both classes and their geometry.
- The same two objects render through the player unchanged.
- A plan-built scene produces `IText` for auto and `Textbox` for fixed.

### Red proof

Each of these must fail before the change and pass after:

- A click-created text is a `Textbox` (or a drag-created text is an `IText`).
- The inspector still renders a Wrap control.
- A `Textbox` still honours an authored `wrap: false`.

## Acceptance

- Text and Text box are distinguishable only by their Fabric class in persisted
  data; no authored wrap flag exists.
- Click places auto-width Text; drag places a fixed Text box; the author never
  chooses a mode from a control.
- No Wrap control exists in the inspector or the model.
- An existing theme renders unchanged, with every `Textbox` still fixed and
  every legacy text still auto-width; only a legacy `FabricText` changes class,
  and only when the editor saves it again.
- The player and the editor agree on each element's class and layout.

## Risks

- **Two contracts, one panel.** Hiding controls by class is load-bearing; a
  control left visible on the wrong class reintroduces the lying-control defect
  this spec removes.
- **Gesture ownership.** A placement listener in more than one surface would
  create two text objects per click. One owner, one state.
- **Legacy class normalisation.** Reviving `FabricText` as `IText` changes the
  persisted type on the next save. It is the only class rewrite in scope; it
  must not touch geometry or runs.
- **Tests built on selectors.** Many text tests assume `textbox`; each must say
  which element it is testing rather than relying on the old default.
