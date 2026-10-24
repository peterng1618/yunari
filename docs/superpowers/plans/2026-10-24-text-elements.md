# Text and text box elements — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split the single text element into two Fabric classes — `IText` (auto width) and `Textbox` (fixed width) — chosen by a click-or-drag placement gesture, with the authored `wrap` flag removed and no conversion between the two.

**Architecture:** The persisted Fabric scene's object `type` becomes the only width-mode discriminator. `renderer-core` stays Fabric-free: its `PlanTextLayout.wrap` is derived from the class by the scene builder, never authored. The editor constructs and places the two classes through one text manager; the inspector projects each class's actual contract instead of offering controls the class cannot honour.

**Tech Stack:** TypeScript, Fabric 7.4 (`fabric/es`), React 19, Vitest + jsdom, Playwright, Biome.

**Spec:** [`../specs/2026-10-24-text-elements-design.md`](../specs/2026-10-24-text-elements-design.md)

**Activation:** this plan is queued, not active. `STATUS.md` must name it before Task 1.1 starts; no other implementation plan may be active at the same time.

## Global Constraints

- **The class is the model.** Fabric object `type` decides width mode. No authored `wrap` exists; old `wrap` keys are ignored, never migrated.
- **No conversion.** There is no Text ⇄ Text box command. A class change happens only when an author deletes and recreates.
- **Editable auto text is `IText`.** `FabricText` is display-only and serialises as `"Text"`. The player accepts it; the editor revives it as `IText`.
- **`renderer-core` stays Fabric/DOM-free.** `PlanTextLayout.wrap` is derived where the class is known; no Fabric import enters it.
- **Fabric JSON is the persisted scene.** No second scene tree, no version bump, no on-load migration pass.
- **Textbox-only behaviour stays explicit.** Box guard, authored height, vertical alignment, clipping, line capacity, width/height drag handles and the text rule in `selection-eligibility` keep naming `Textbox`.
- One owner per concept: text construction and placement are `text-manager`'s; the Add/context/footer surfaces arm through the session, never construct.
- Copy lives in `uiCopy`; the removed Wrap control's copy is deleted rather than orphaned. Add `Text box` as the fixed element's default name.
- The Runs editor's selected run is transient React state: never persisted, never an envelope key, never a history entry.
- `exactOptionalPropertyTypes` and `noUncheckedIndexedAccess` are on. Refuse invalid numeric input rather than coercing it.
- Stage explicit paths; no `git add -A`. Conventional Commit titles. No licence headers. 500 lines is a signal, 800 a stop.

## Review Focus

1. A drag that goes up or left must still produce a positive-size box at the upper-left corner, or the object is created inverted or with a negative size.
2. A click with pointer jitter, or a drag smaller than one scene unit, must create a Text — not a one-pixel Text box and not a vanished object.
3. Cancelling with Escape, a right press or a press outside the artboard must restore the canvas's cursor and target-finding state and leave no object, history entry or armed state behind.
4. A legacy `Textbox` carrying `wrap: false` must still wrap, and a save/reload must preserve each element's class and geometry.
5. Swapping the selection from a Text box to a Text must show the auto contract immediately: no stale Overflow, vertical align or editable Size row.
6. Selecting a run's number shows that run's fields and hides the others; `+` adds a run and selects it; removing the selected run leaves a remaining one selected.
7. A Text carries no width-drag or height-drag handle; a Text box keeps them.
8. Words typed into a just-placed text, then committed by leaving the edit, survive the repaint and a save/reload.

Each line's test is named in the owning task below.

---

## Phase 1 — The class is the width model

**Outcome:** Production code reads no authored `wrap`; plan-built and persisted scenes choose `IText` for auto and `Textbox` for fixed; legacy `"Text"` revives as `IText` in the editor; `addText` constructs the class the author will get; the placement gesture decides click versus drag.

### Task 1.1: Derive layout from the Fabric class

**Files:**
- Create: `docs/decisions/0098-a-text-element-is-its-fabric-class.md` (required before touching `adapter.ts` — reuse gate)
- Modify: `src/web/packages/renderer-core/src/theme/document.ts` — remove `TextContent.wrap`; make `box`, `overflow` and `verticalAlign` docs Textbox-specific
- Modify: `src/web/packages/renderer-core/src/scene/plan.ts` — document `PlanTextLayout.wrap` as derived
- Modify: `src/web/packages/renderer-core/src/theme/fabric-envelope-validate.ts` — text test accepts serialised `"Text"`
- Modify: `src/web/packages/scene-fabric/src/fabric-text.ts` — `authoredAlignment` derives wrap/overflow/verticalAlign from the class; `buildText` builds `IText` for auto
- Modify: `src/web/packages/scene-fabric/src/adapter.ts` — `classFor` maps auto text to `IText`
- Modify: `src/web/packages/scene-fabric/src/authored-box.ts` — comments state the box is Textbox-only
- Modify: `src/web/packages/editor/src/new-fabric-theme-objects.ts`, `new-fabric-theme-cards.ts` — stop authoring `wrap`
- Modify: `src/web/packages/editor/src/selection-inspector/runs.tsx` — `RunsProjection.wraps`; remove the Wrap control
- Modify: `src/web/packages/editor/src/selection-inspector/run-edits.ts` — `writeTextLayout` loses `wrap`
- Modify: `src/web/packages/editor/src/selection-inspector/per-kind-column.ts` — pass `wraps: target instanceof Textbox`
- Modify: `src/web/packages/editor/src/ui-copy.ts` — delete `inspectorFields.wrap`
- Tests: `scene-fabric/src/fabric-text.dom.test.ts`, `adapter.dom.test.ts`, `authored-box.dom.test.ts`, `persist.dom.test.ts`, `v2-text-tracking.dom.test.ts`; `renderer-core/src/theme/fabric-envelope-validate.test.ts`, `scene/plan.test.ts`; `editor/src/selection-inspector/runs.dom.test.ts`; `editor/src/ui-copy.test.ts`, `ui-copy-surfaces.test.ts`; editor fixtures that spell `wrap`

**Interfaces:**
- Consumes: existing `TextContent`, `PlanTextLayout`, `PlanTextObject`.
- Produces: `TextContent` without `wrap`; `authoredAlignment(object, authored)` deriving `wrap: object instanceof Textbox`, `overflow: Textbox ? authored.overflow ?? "clip" : "visible"`, `verticalAlign: Textbox ? authored.verticalAlign ?? "top" : "top"`; `buildText` and `classFor` choosing `IText` when the derived wrap is false; `RunsProjection.wraps: boolean`; `writeTextLayout` without a `wrap` patch.

- [ ] **Step 1: Write the decision note before the adapter edit**

Follow `docs/decisions/README.md`. Record the ruling: the Fabric class is the width-mode discriminator, authored wrap is removed, `PlanTextLayout.wrap` is derived, auto is `IText`, legacy `"Text"` revives as `IText`, no conversion. Name `scene-fabric/src/adapter.ts` as the claimed path and list the searches that ruled out a better owner.

- [ ] **Step 2: Write the failing tests**

Cover: a `Textbox` whose authored content carries `wrap: false` still wraps; an `IText` derives `wrap: false` and `overflow: "visible"`; `buildText` and `adapter.classFor` produce `IText` for auto and `Textbox` for fixed; the validator treats a serialised `type: "Text"` object as text; the inspector renders no Wrap control and the copy net no longer owns the word; no test or fixture needs `TextContent.wrap`.

- [ ] **Step 3: Run the focused suites and confirm red**

Run: `npx vitest run packages/scene-fabric/src/fabric-text.dom.test.ts packages/scene-fabric/src/adapter.dom.test.ts packages/renderer-core/src/theme/fabric-envelope-validate.test.ts`
Expected: FAIL on the class mapping and the legacy flag.

- [ ] **Step 4: Implement the derivation and remove the authored field**

Delete `wrap` from `TextContent`, the starter authoring, the Wrap control, its copy and its write, and every fixture that spells it. Derive the layout values in `authoredAlignment` and the `RunsProjection.wraps` flag from the class, and use `IText` in `buildText`/`classFor` for auto. Add `"Text"` to the validator's text test. Update the docblocks to current truth.

- [ ] **Step 5: Run the focused suites and typecheck**

Run: `npx vitest run packages/scene-fabric/src packages/renderer-core/src packages/editor/src/selection-inspector/runs.dom.test.ts packages/editor/src/ui-copy.test.ts packages/editor/src/ui-copy-surfaces.test.ts`
Run: `npm run typecheck`
Expected: PASS; no remaining reference to `TextContent["wrap"]`.

- [ ] **Step 6: Commit**

```bash
git add docs/decisions/0098-a-text-element-is-its-fabric-class.md src/web/packages/renderer-core/src src/web/packages/scene-fabric/src src/web/packages/editor/src/new-fabric-theme-objects.ts src/web/packages/editor/src/new-fabric-theme-cards.ts src/web/packages/editor/src/selection-inspector/runs.tsx src/web/packages/editor/src/selection-inspector/run-edits.ts src/web/packages/editor/src/selection-inspector/per-kind-column.ts src/web/packages/editor/src/ui-copy.ts
git commit -m "refactor(scene): derive text layout from the Fabric class"
```

### Task 1.2: Revive a legacy `"Text"` as `IText` in the editor

**Files:**
- Modify: `src/web/packages/scene-fabric/src/persist.ts` — `reviveScene` gains an explicit editor-only normalisation option
- Modify: `src/web/packages/editor/src/editor-shell.ts` — the mount and the history `revive` callback pass it
- Tests: `src/web/packages/scene-fabric/src/persist.dom.test.ts`; `src/web/packages/editor/src/editor-shell.dom.test.ts`

**Interfaces:**
- Consumes: `reviveScene`, `SerialisedScene`.
- Produces: `reviveScene(canvas, scene, resolveAsset?, paint?, options?: { readonly editableText?: boolean })`; when true, every nested serialised `type: "Text"` is revived as `"IText"` with all other keys untouched. Player callers omit it.

- [ ] **Step 1: Write the failing tests**

A scene containing `type: "Text"` revives as `FabricText` by default and as `IText` with `editableText: true`; geometry, `yunariText` runs and style survive the rewrite; undo after an edit of a legacy text leaves an `IText`, not a `FabricText`.

- [ ] **Step 2: Run and confirm red**

Run: `npx vitest run packages/scene-fabric/src/persist.dom.test.ts`
Expected: FAIL — no option and no rewrite.

- [ ] **Step 3: Implement the revival option and wire both editor paths**

Normalise a copy of the serialised object graph, including group children. Pass the option from the editor's initial revive and from the history manager's revive callback; leave the player's revive call unchanged.

- [ ] **Step 4: Run the suites**

Run: `npx vitest run packages/scene-fabric/src/persist.dom.test.ts packages/editor/src/editor-shell.dom.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/web/packages/scene-fabric/src/persist.ts src/web/packages/scene-fabric/src/persist.dom.test.ts src/web/packages/editor/src/editor-shell.ts src/web/packages/editor/src/editor-shell.dom.test.ts
git commit -m "feat(scene): revive legacy display text as editable text"
```

### Task 1.3: `addText` constructs the class the author chose

**Files:**
- Modify: `src/web/packages/editor/src/text-manager/index.ts`
- Modify: `src/web/packages/editor/src/editor-interaction.ts` — `textManager.addText` signature/return
- Modify: `src/web/packages/editor/src/editor-shell/session-facade.ts` if its type restates the manager's
- Tests: `src/web/packages/editor/src/text-manager/index.dom.test.ts`, `src/web/packages/editor/src/editor-shell.dom.test.ts`, `src/web/packages/editor/src/new-object-panel.dom.test.ts` fixtures

**Interfaces:**
- Consumes: `IText`, `Textbox`, `readonly` box dimensions.
- Produces: `interface TextCreationOptions { readonly text?: string; readonly box?: { readonly width: number; readonly height: number }; readonly [key: string]: unknown }`; `TextManager.addText(options?: TextCreationOptions): IText`.
- Behaviour: no `box` constructs an `IText`, writes no authored box, and installs no box guard; a `box` constructs a `Textbox`, installs `guardBoxWidth`, and writes both authored dimensions. The object is added, selected and saved once.

- [ ] **Step 1: Write the failing tests**

`addText({ text })` returns an `IText` with no `yunariText.box`; `addText({ text, box })` returns a `Textbox` whose authored box equals the request and whose first line fits; the id override and single save still hold; a `Textbox` created through the manager still wraps inside its box.

- [ ] **Step 2: Run and confirm red**

Run: `npx vitest run packages/editor/src/text-manager/index.dom.test.ts`
Expected: FAIL — auto still arrives as a `Textbox`.

- [ ] **Step 3: Implement the class choice**

Remove the unconditional `Textbox` construction and the `Textbox`-only return type. Guard and seed the authored box only on the fixed branch. Keep `seedAuthoredBox` as a Textbox-only helper, but a fixed creation passes its box directly rather than measuring one.

- [ ] **Step 4: Update the existing text tests**

Rewrite the "new text gets an authored box" case into the two class cases above; pass an explicit box wherever a test resizes a fixed text. Keep the double-click editing cases working against `IText` and `Textbox`.

- [ ] **Step 5: Run the focused suite and typecheck**

Run: `npx vitest run packages/editor/src/text-manager packages/editor/src/editor-shell.dom.test.ts`
Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/web/packages/editor/src/text-manager src/web/packages/editor/src/editor-interaction.ts src/web/packages/editor/src/editor-shell/session-facade.ts
git commit -m "feat(editor): construct auto text and text boxes as their Fabric classes"
```

### Task 1.4: The placement gesture

**Files:**
- Modify: `src/web/packages/editor/src/text-manager/index.ts`
- Tests: `src/web/packages/editor/src/text-manager/index.dom.test.ts`

**Interfaces:**
- Consumes: `Canvas.getScenePoint`, the manager's existing canvas listeners.
- Produces:
  - `interface TextPlacement { readonly left: number; readonly top: number; readonly box?: { readonly width: number; readonly height: number } }`
  - `interface TextPlacementPort { readonly contained: (point: { readonly x: number; readonly y: number }) => boolean; readonly onPlace: (placement: TextPlacement) => void }`
  - `TextManager.beginPlacement(port: TextPlacementPort): void`
  - `PLACEMENT_DRAG_THRESHOLD = 4` (CSS pixels)
- Behaviour: one-shot; press converts through `getScenePoint`; travel is measured from client coordinates; under 4 px — or a normalised box dimension under 1 scene unit — is a click; otherwise the normalised rectangle is the box. Escape, a non-primary press and a press outside `contained` cancel. Arming saves and restores `skipTargetFind`, `selection` and `defaultCursor`; a dashed outline follows the drag on `after:render` and is never added to the canvas or history.

- [ ] **Step 1: Write the failing gesture tests**

Stub `canvas.getScenePoint` and fire `mouse:down`/`mouse:move`/`mouse:up`. Cover click, drag down-right, drag up-left (positive box at the upper-left), 3-pixel jitter (click), a drag whose box is under one unit (click), Escape, right press, outside-artboard press, and that a move creates no canvas object.

- [ ] **Step 2: Run and confirm red**

Run: `npx vitest run packages/editor/src/text-manager/index.dom.test.ts`
Expected: FAIL — `beginPlacement` does not exist.

- [ ] **Step 3: Implement the gesture state and outline**

Install the pointer/key listeners once in `createTextManager` and let `beginPlacement` only set the armed port and canvas state. Remove the listeners and restore state in `destroy`. Reuse the manager's `save` only when the port's `onPlace` constructs.

- [ ] **Step 4: Run the suite**

Run: `npx vitest run packages/editor/src/text-manager/index.dom.test.ts`
Expected: PASS, including the Review Focus 1–3 cases.

- [ ] **Step 5: Commit**

```bash
git add src/web/packages/editor/src/text-manager
git commit -m "feat(editor): place text by click or drag"
```

---

## Phase 2 — One arming route and an honest inspector

**Outcome:** Every creation surface arms the same gesture; the new object lands at the gesture with the right class, defaults and name; the inspector shows only controls the selected class can honour, the Runs section shows one run at a time behind numeric tabs, a Text carries no box-writing handles, and typing into a just-placed text is kept.

### Task 2.1: Arm from one route and insert at the gesture

**Files:**
- Modify: `src/web/packages/editor/src/new-object-panel.ts` — `NewObjectActions.addText`; `insertObject`'s text arm; `insertNewText` takes a `TextPlacement`
- Modify: `src/web/packages/editor/src/editor-session.ts` — Add pane actions and the facade's `addText` both arm; the placement callback constructs
- Modify: `src/web/packages/editor/src/new-object-defaults.ts` — text defaults accept the placement and box; fixed text names `Text box`
- Modify: `src/web/packages/editor/src/ui-copy.ts` — add `panels.textBox`
- Tests: `src/web/packages/editor/src/new-object-panel.dom.test.ts`, `src/web/packages/editor/src/editor-session.dom.test.ts`, `src/web/packages/editor/src/new-object-defaults.test.ts`

**Interfaces:**
- Consumes: `beginPlacement`, `TextPlacement`, `addText`.
- Produces: `NewObjectActions.addText: () => void`; `insertNewText(editor, globals, placement: TextPlacement): void`; `createNewTextDefaults(globals, text, placement, box?)` returning runs plus a box only when fixed.
- Behaviour: the Add tile, context menu and footer all call the session's one arming route. The gesture's `onPlace` is wrapped in `constructing`, so a refusal is reported at gesture end. Text no longer calls `nextNewObjectPlacement`; shapes, charts and cards keep it. The new object is selected, enters editing with all text selected (the existing deferred `requestAnimationFrame` behaviour), and is one history entry.

- [ ] **Step 1: Write the failing wiring tests**

Clicking the Add pane's Text tile arms and does not construct; `session.addText()` arms; a click placement calls `insertNewText` with the point and no box; a drag placement passes the box; fixed text is named `Text box` and auto text `Text`; a refused construction reports once and leaves no object; undo removes the created object in one step.

- [ ] **Step 2: Run and confirm red**

Run: `npx vitest run packages/editor/src/new-object-panel.dom.test.ts packages/editor/src/editor-session.dom.test.ts`
Expected: FAIL — the tile still inserts immediately.

- [ ] **Step 3: Implement the route**

Make `insertObject`'s text arm call `actions.addText()` (refusing when absent, as the card arm does). In `editor-session`, pass an arming action to the Add pane and use the same action for the facade's `addText`. The arming call supplies `contained` from `editor.artboard()` and `onPlace` that constructs through `constructing`. Remove the text branch's default placement.

- [ ] **Step 4: Run the focused suites and typecheck**

Run: `npx vitest run packages/editor/src/new-object-panel.dom.test.ts packages/editor/src/editor-session.dom.test.ts packages/editor/src/new-object-defaults.test.ts`
Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/web/packages/editor/src/new-object-panel.ts src/web/packages/editor/src/editor-session.ts src/web/packages/editor/src/new-object-defaults.ts src/web/packages/editor/src/ui-copy.ts src/web/packages/editor/src/new-object-panel.dom.test.ts src/web/packages/editor/src/editor-session.dom.test.ts src/web/packages/editor/src/new-object-defaults.test.ts
git commit -m "feat(editor): arm text placement from every creation surface"
```

### Task 2.2: The inspector states the class's remaining contract

**Files:**
- Modify: `src/web/packages/editor/src/selection-inspector/runs.tsx` — hide Overflow and vertical align when `wraps` is false
- Modify: `src/web/packages/editor/src/selection-inspector/view.ts` — `PairHalfView.readOnly`
- Modify: `src/web/packages/editor/src/selection-inspector/per-kind-column.ts` — Size halves read-only for auto text
- Modify: `src/web/packages/editor/src/selection-inspector/index.ts` — width/height writes only for `Textbox`
- Modify: `src/web/packages/editor/src/components/ui/control-number.tsx`, `control-pair.tsx` — a read-only half renders its value and commits nothing
- Tests: `selection-inspector/runs.dom.test.ts`, `index.dom.test.ts`, `column.dom.test.tsx`, `inspector.dom.test.tsx`; `components/ui/control-number.dom.test.tsx`; `accessible-names.dom.test.ts`

**Interfaces:**
- Consumes: the live `FabricObject`; `Textbox`; `RunsProjection.wraps` from Task 1.1.
- Produces: `PairHalfView.readOnly?: boolean`; geometry width/height on a non-`Textbox` refuses the write instead of scaling or writing a box.
- Behaviour: auto text shows Runs, Align, text fields, Position X/Y and read-only measured W/H; it hides Overflow, vertical align and every box write. Fixed text keeps Overflow, vertical align and editable W/H.

- [ ] **Step 1: Write the failing inspector tests**

An `IText` has no Overflow or vertical-align control and its W/H inputs are read-only (typing commits nothing); a `Textbox` keeps both; width/height writes on an `IText` change neither the box nor the scale; selecting a Text box then a Text shows the auto contract with no stale control.

- [ ] **Step 2: Run and confirm red**

Run: `npx vitest run packages/editor/src/selection-inspector packages/editor/src/components/ui/control-number.dom.test.tsx`
Expected: FAIL — the box controls still render for auto text.

- [ ] **Step 3: Implement the class-derived inspector**

Gate Overflow/vertical align on `wraps`, add the read-only half path, and branch the geometry funnel on `Textbox`. Update fixtures that build a `RunsView` by hand.

- [ ] **Step 4: Run the suites and review the live control set**

Run: `npx vitest run packages/editor/src/selection-inspector packages/editor/src/components/ui packages/editor/src/accessible-names.dom.test.ts`
Expected: PASS, including Review Focus 5.

- [ ] **Step 5: Commit**

```bash
git add src/web/packages/editor/src/selection-inspector src/web/packages/editor/src/components/ui/control-number.tsx src/web/packages/editor/src/components/ui/control-pair.tsx
git commit -m "feat(inspector): show only the selected text class's controls"
```

### Task 2.3: Show one run at a time behind numeric tabs

**Files:**
- Modify: `src/web/packages/editor/src/selection-inspector/runs.tsx` — `RunEditor` renders the layout controls, then a tab strip, then only the selected run
- Modify: `src/web/packages/editor/src/ui-copy.ts` — `inspectorFields.runTab(index)`; `addRun` becomes the `+` button's accessible name
- Tests: `selection-inspector/runs.dom.test.ts`, `runs.dom.test.tsx`, `inspector.dom.test.tsx`, `column.dom.test.tsx`, `accessible-names.dom.test.ts`

**Interfaces:**
- Consumes: `RunsView.runs` and `RunEdits.addRun`/`removeRun` (Task 1.1/2.2 already changed the projection and the class gating).
- Produces: `uiCopy.inspectorFields.runTab(index: number): string` → `Run <1-based index>`; each `Tabs.Tab` carries `data-yunari-run-tab="<1-based index>"` and its accessible name from `runTab`; the existing `data-yunari-run-add` stays on the `+` button.
- Behaviour: Base UI's existing `Tabs` primitive (`@base-ui/react/tabs`, already used by the asset finder and settings) owns the tab semantics. Tab order is run order; only the selected run's fields render below the strip. The selected run is React-local, keyed by `RunRowView.id`, never persisted, never a history entry. `+` calls `edits.addRun()` and selects the newly added run (last). A selection whose id disappears (its run was removed) falls back to the first remaining run, so a selected tab always names a row. `Remove run N` stays in the selected run's panel and keeps its existing copy. The strip wraps rather than scrolls; Align and the class-gated Overflow/vertical align stay above it, and notes stay below.

- [ ] **Step 1: Write the failing tab tests**

Cover: every run has a numbered tab and only the selected run's fields render; clicking tab 2 shows run 2's fields and hides run 1's; `+` adds a run and selects it; removing the selected run leaves a remaining one selected; the tab's accessible name is `Run N`; keyboard arrows move between tabs; the selection produces no history entry and no dirty state.

- [ ] **Step 2: Run and confirm red**

Run: `npx vitest run packages/editor/src/selection-inspector/runs.dom.test.ts packages/editor/src/selection-inspector/runs.dom.test.tsx`

Expected: FAIL — every run still renders stacked.

- [ ] **Step 3: Implement the tab strip**

Wrap the run rows in `Tabs.Root`/`Tabs.List`/`Tabs.Tab`/`Tabs.Panel`; add the `+` button after the list; keep the run row component unchanged apart from living inside the panel. Update the accessible-name census and any fixture that counts rendered run fields.

- [ ] **Step 4: Run the suites**

Run: `npx vitest run packages/editor/src/selection-inspector packages/editor/src/accessible-names.dom.test.ts`

Expected: PASS, including Review Focus 6.

- [ ] **Step 5: Commit**

```bash
git add src/web/packages/editor/src/selection-inspector/runs.tsx src/web/packages/editor/src/ui-copy.ts src/web/packages/editor/src/selection-inspector/runs.dom.test.ts src/web/packages/editor/src/selection-inspector/runs.dom.test.tsx src/web/packages/editor/src/selection-inspector/inspector.dom.test.tsx src/web/packages/editor/src/selection-inspector/column.dom.test.tsx src/web/packages/editor/src/accessible-names.dom.test.ts
git commit -m "feat(inspector): show one text run at a time behind numeric tabs"
```

### Task 2.4: A Text carries no box-writing handles

Found by Task 3.2's browser proof: Fabric's default object controls include `ml`, `mr`, `mt` and `mb`, and `controls-manager` gives them to every object, so a Text offers drag handles that write a box it does not have.

**Files:**
- Modify: `src/web/packages/editor/src/controls-manager/index.ts` — `IText` gets its own control set: corners and rotation only
- Tests: `src/web/packages/editor/src/controls-manager/index.test.ts`, `index.dom.test.ts`

**Interfaces:**
- Consumes: `controlsUtils.createObjectDefaultControls()`, `applyOverrides`.
- Produces: `IText.ownDefaults.controls` without `ml`/`mr`/`mt`/`mb`; `Textbox.ownDefaults.controls` unchanged (all nine).

- [ ] **Step 1: Write the failing test**

An `IText` exposes `tl`/`tr`/`bl`/`br`/`mtr` and none of `ml`/`mr`/`mt`/`mb`; a `Textbox` keeps all nine; a `Rect` keeps Fabric's defaults.

- [ ] **Step 2: Run and confirm red**

Run: `npx vitest run packages/editor/src/controls-manager`

Expected: FAIL — an `IText` carries the four edge handles.

- [ ] **Step 3: Assign the Text's own set**

Take the object-control set this file already builds, delete the four edge handles, and assign it to `IText.ownDefaults` as a NEW defaults object — the same way `Line` is handled, because writing `controls` onto the inherited object would take the handles off every Fabric object.

- [ ] **Step 4: Run the suite and typecheck**

Run: `npx vitest run packages/editor/src/controls-manager packages/editor/src/selection-inspector`
Run: `npm run typecheck`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/web/packages/editor/src/controls-manager
git commit -m "fix(editor): give a text corners and rotation only"
```

### Task 2.5: Typing into a just-placed text is kept

Found by Task 3.2's browser proof: the words typed over an object's authoring view are written to `yunariText.runs` only by the handler `onDoubleClick` installs per object, so a text created by the placement gesture enters editing with no such handler and the next repaint restores the placeholder.

**Files:**
- Modify: `src/web/packages/editor/src/text-manager/index.ts` — one canvas-level `text:editing:exited` handler owns the commit, instead of a per-double-click `once`
- Tests: `src/web/packages/editor/src/text-manager/index.dom.test.ts`; `new-object-panel.dom.test.ts` if its editing case asserts the old path

**Interfaces:**
- Consumes: Fabric's canvas `text:editing:exited`, `keepTypedText`, `save`, `repaint`.
- Produces: no new public API. Behaviour: the words typed over an authoring view are written to the authored run and saved once, whether editing began by double-click or by construction; the token comparison that ignores an unchanged edit and the multi-run refusal keep working.

- [ ] **Step 1: Write the failing test**

Create a text without any double-click, `enterEditing()`, set a new `text`, `exitEditing()`: `yunariText.runs[0].text` holds the typed words and `save` was called once. Keep the double-click cases (an unchanged edit writes nothing; a multi-run refusal warns once and repaints).

- [ ] **Step 2: Run and confirm red**

Run: `npx vitest run packages/editor/src/text-manager/index.dom.test.ts`

Expected: FAIL — the authored run still holds the placeholder.

- [ ] **Step 3: Move the exit handling to the manager's canvas listeners**

Record the painted view when editing starts, and commit on `text:editing:exited` for any text, not only a double-clicked one. Remove the listener in `destroy`; do not leave two handlers that both save.

- [ ] **Step 4: Run the suites and typecheck**

Run: `npx vitest run packages/editor/src/text-manager packages/editor/src/new-object-panel.dom.test.ts packages/editor/src/editor-shell.dom.test.ts`
Run: `npm run typecheck`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/web/packages/editor/src/text-manager src/web/packages/editor/src/new-object-panel.dom.test.ts
git commit -m "fix(editor): keep the words typed into a new text"
```

---

## Phase 3 — Browser proof, documentation and gate

**Outcome:** The author journey is proven in a browser; every existing e2e insertion site uses the gesture; the design record states current truth; the full gate is green.

### Task 3.1: Update e2e insertion to the gesture

**Files:**
- Modify: `src/web/tests/e2e/rebuild-driver.ts` — shared `placeText(page, point?)`; `insert(page, "Text", "text")` uses it
- Modify: `src/web/tests/e2e/asset-finder.spec.ts`, `editor.spec.ts`, `host-player.spec.ts`, `reference-theme.spec.ts` — direct Text-button sites place at a known artboard point
- Modify: `src/web/tests/e2e/editor.spec.ts` — delete the Wrap Off case and any `data-yunari-text-wrap` selector

**Interfaces:**
- Consumes: the armed gesture, `readScene`, the editor bridge.
- Produces: `placeText(page: Page, point?: { x: number; y: number }): Promise<void>` — clicks the Add pane's Text tile, then clicks the canvas at the point (default: artboard centre) and waits for one new object.

- [ ] **Step 1: Add the helper and update the shared insert**

`insert(page, "Text", "text")` must arm then place; other groups keep the existing immediate path.

- [ ] **Step 2: Update the direct sites**

Replace each "click Text then assert" with `placeText`, keeping each test's existing assertions and adding a class assertion where the test's intent depends on it.

- [ ] **Step 3: Run the affected specs**

Run: `npx playwright test tests/e2e/editor.spec.ts tests/e2e/reference-theme.spec.ts --grep "text"`
Expected: PASS. If a shared port is owned by another run, stop that run rather than changing the port.

- [ ] **Step 4: Commit**

```bash
git add src/web/tests/e2e/rebuild-driver.ts src/web/tests/e2e/asset-finder.spec.ts src/web/tests/e2e/editor.spec.ts src/web/tests/e2e/host-player.spec.ts src/web/tests/e2e/reference-theme.spec.ts
git commit -m "test(e2e): place text through the click-or-drag gesture"
```

### Task 3.2: Prove click, drag, cancel, reload and player parity

**Files:**
- Create: `src/web/tests/e2e/text-elements.spec.ts`
- Modify: `src/web/tests/e2e/host-player.spec.ts` if the player parity reads the saved envelope there rather than the preview

**Interfaces:**
- Consumes: `placeText`, `readScene`, `saveEnvelope`, the player route.
- Produces: browser evidence for the changed authoring contract; no new production interface.

- [ ] **Step 1: Write the failing browser cases**

- Add → Text → click creates an instance of type `i-text`, grows while typing, its `ml`/`mr` controls scale rather than writing a width, and it exposes no `mt`/`mb` edge handles while the drag-created Text box keeps them.
- Typing on the canvas into a just-placed Text, then leaving the edit, keeps the words through the repaint and a reload (Task 2.5); no case may be pinned as an expected failure.
- The click-created Text exposes no `mt`/`mb` edge handles (edge controls are Textbox-only), while the drag-created Text box keeps them.
- Add → Text → drag creates a `textbox` at the drawn rectangle, wraps inside it, keeps the box while typing, and its `ml`/`mr` controls use `changeWidth`.
- Escape during placement leaves the scene and the history unchanged.
- Save, reload and reopen preserves both classes and their geometry.
- A legacy `Textbox` with `wrap: false` still wraps, and a legacy `"Text"` object opens editable as `IText`.
- The player renders both saved objects without changing either class.

- [ ] **Step 2: Run and confirm red**

Run: `npx playwright test tests/e2e/text-elements.spec.ts`
Expected: FAIL against the pre-fix bundle — rebuild the editor before each run.

- [ ] **Step 3: Confirm green on the rebuilt bundle**

Run: `npm run build`
Run: `npx playwright test tests/e2e/text-elements.spec.ts`
Expected: PASS. Read the rendered inspector and the transient outline yourself; a screenshot is evidence, not a golden file.

- [ ] **Step 4: Commit**

```bash
git add src/web/tests/e2e/text-elements.spec.ts src/web/tests/e2e/host-player.spec.ts
git commit -m "test(e2e): prove text and text box authoring"
```

### Task 3.3: Documentation, status and the full gate

**Files:**
- Modify: `docs/architecture/ownership.md` — placement owner, two element contracts, the revival option
- Modify: `docs/superpowers/specs/2026-10-24-text-elements-design.md` — Status becomes `implemented` only when the Acceptance evidence is written
- Modify: `STATUS.md` — current objective, active work, last completed change, next, blockers

**Interfaces:**
- Consumes: the previous tasks' evidence.
- Produces: a truthful current-truth record and a gate result with an exit code.

- [ ] **Step 1: Update the ownership map and any stale docblocks**

Name `text-manager` as the construction/gesture owner, `TextContent.box` as Textbox-only, and `reviveScene`'s editor-only normalisation. Remove comments that still call `wrap` the class decider.

- [ ] **Step 2: Run the full gate**

Run: `npm run gate`
Expected: exit code 0. Record the command and the code; a piped command reports the pipe's status, so read `$?` directly.

- [ ] **Step 3: Update STATUS.md and the spec's status**

Replace STATUS's "Last completed change" with 1–5 one-line bullets for this work; run `npm run status:check` from `src/web/`. Add the Acceptance evidence to the spec in the same commit that sets `implemented`.

- [ ] **Step 4: Commit**

```bash
git add docs/architecture/ownership.md docs/superpowers/specs/2026-10-24-text-elements-design.md STATUS.md
git commit -m "docs(text): record the text class model and close the plan"
```

---

## Acceptance

- No production code reads or writes authored `wrap`; a legacy `wrap: false` on a `Textbox` is ignored and wraps.
- Auto text is `IText`, fixed text is `Textbox`, and the persisted Fabric `type` is the only width-mode discriminator.
- Click places a Text, drag places a Text box, and every creation surface arms the same gesture; Escape and a non-primary press leave no trace.
- The inspector offers no Wrap control and no control the selected class cannot honour.
- The Runs section shows one numbered tab per run with `+` adding and selecting a run; only the selected run's fields and its Remove action are shown.
- An editor-opened legacy `"Text"` is editable `IText`; the player still renders the class the scene carries.
- The full gate exits 0 and the spec's Acceptance section records what was observed.
