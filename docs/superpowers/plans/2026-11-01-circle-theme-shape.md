# Circle Theme Shape Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a theme able to be a circle theme: a square artboard whose visible glass is the inscribed disc, with the four corners outside the glass.

**Architecture:** `artboard.shape` becomes persisted document data (`"rect"` absent, `"circle"`). The editor gains a Shape control, converts an existing rectangular theme in one undoable step, previews the disc, and draws a disc guide. The player and hardware panels render the disc by clipping the composition while keeping the existing display/surround rules for the background.

**Tech Stack:** TypeScript, Fabric, React (editor), Vitest, Playwright (existing). No new dependencies.

**Spec:** `docs/superpowers/specs/2026-11-01-circle-theme-shape-design.md`

## Global Constraints

- Run every npm command from `src/web/`. The repository root has no `package.json`.
- Node `>=22`; CI uses Node 24.
- No new runtime dependencies and no `THIRD-PARTY-NOTICES.md` change.
- `schemaVersion` stays `2.0.0`; `shape` is optional and absent means `"rect"`.
- `renderer-core` imports no Fabric and no DOM; the player never imports editor code; Fabric comes from `fabric/es`.
- Persist authored state only: shape is authored, the disc guide/preview crop is view.
- `npm run gate` must exit 0 and must not need the network.
- Biome formatting and the existing comment style (state the invariant, not the history).

## Review Focus

- A hand-edited envelope with `shape: "circle"` and unequal edges must be refused, not coerced (Task 2).
- Converting a theme with rotated, scaled, locked or grouped objects must preserve their geometry (Task 5).
- Undo after a conversion must restore the scene **and** the artboard in one step (Task 5).
- A rectangular theme on a round display must keep today's inscribed behaviour (Task 8).
- A circle theme's stored thumbnail must be a disc even when saved under a rectangular lens (Task 10).

---

### Task 1: Decision note 0052

**Files:**
- Create: `docs/decisions/0052-circle-theme-shape.md`

**Interfaces:**
- Produces: a decision note claiming the exact watched paths the later tasks write.

- [ ] **Step 1: Write the note using the template in `docs/decisions/README.md`**

Record all seven rungs. Required evidence:
- Rung 1: `renderer-core/src/artboard.ts` (`computeArtboardTransform`, `DisplayShape`), `artboard-presets.ts` (the `circle` ratio from commit `3a0bfc9f`), `scene.ts` circle presentation path, `display-lens.ts` circle lens.
- Rung 2: Fabric's canvas `clipPath` and `StaticCanvas.toCanvasElement`, `border-radius` clipping in `background-media.ts`.
- Rung 3: `CanvasRenderingContext2D`/`clipPath` and CSS `clip-path: circle()`.
- Rung 4: actual searches for round-display authoring safe-area models (e.g. Android Wear inset vs inscribed square, watch-face design guidelines) and record what each does.
- Rung 5: compare (a) a ratio entry, (b) today's inscribed-artboard display geometry, (c) a persisted artboard shape.
- Rung 6: state the probe that settled it — a 1:1 artboard through `computeArtboardTransform` with `shape: "circle"` yields `scale = viewport / hypot(w, h)`, i.e. the artboard is inscribed; the new rule is `viewport / w` for a square.
- Rung 7: the decision.

The `- **Paths:**` field must list, on continuation lines, exactly:
```
- **Paths:** `src/web/packages/renderer-core/src/theme/document.ts`,
  `src/web/packages/renderer-core/src/theme/envelope-semantics.ts`,
  `src/web/packages/renderer-core/src/theme/envelope-keys.ts`,
  `src/web/packages/scene-fabric/src/scene.ts`,
  `src/web/packages/editor/src/editor-session.ts`
```

- [ ] **Step 2: Verify the gate accepts the note**

Run from the repository root: `node scripts/reuse-gate.mjs --self-test`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add docs/decisions/0052-circle-theme-shape.md
git commit -m "docs(decisions): a circle theme is a persisted artboard shape"
```

---

### Task 2: Persisted shape and validation

**Files:**
- Modify: `src/web/packages/renderer-core/src/artboard.ts`
- Modify: `src/web/packages/renderer-core/src/theme/document.ts`
- Modify: `src/web/packages/renderer-core/src/theme/envelope-keys.ts`
- Modify: `src/web/packages/renderer-core/src/theme/envelope-semantics.ts`
- Modify: `src/web/packages/renderer-core/src/index.ts`
- Modify: `schema/theme-document.schema.json`
- Test: `src/web/packages/renderer-core/src/theme/envelope-semantics.test.ts`
- Test: `src/web/packages/renderer-core/src/theme/fabric-envelope-schema-sync.test.ts`
- Test: `src/web/packages/renderer-core/src/artboard.test.ts`

**Interfaces:**
- Produces: `export type ArtboardShape = "rect" | "circle"`; `Artboard.shape?: ArtboardShape`; `export function artboardTransformShape(themeShape: ArtboardShape | undefined, displayShape: DisplayShape): DisplayShape`.

- [ ] **Step 1: Write the failing validator tests**

In `envelope-semantics.test.ts`:
- an envelope with `artboard: {width: 1080, height: 1080, shape: "circle"}` validates;
- `shape: "rect"` validates;
- absent validates;
- `artboard: {width: 1080, height: 900, shape: "circle"}` produces one issue with code `"out-of-range"` at `/artboard/height`, message mentioning square;
- `shape: "round"` produces `"invalid-enum"` at `/artboard/shape`.

In `artboard.test.ts`:
- `artboardTransformShape("circle", "circle")` === `"rect"` (a circle theme lays out by the rect rules);
- `artboardTransformShape("circle", "rect")` === `"rect"`;
- `artboardTransformShape("rect", "circle")` === `"circle"`;
- `artboardTransformShape(undefined, "rect")` === `"rect"`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd src/web && npx vitest run packages/renderer-core/src/theme/envelope-semantics.test.ts packages/renderer-core/src/artboard.test.ts`
Expected: FAIL — unknown `shape` key / missing export.

- [ ] **Step 3: Implement**

`artboard.ts`:
```ts
export type ArtboardShape = "rect" | "circle";
export type DisplayShape = ArtboardShape;
export function artboardTransformShape(
  themeShape: ArtboardShape | undefined,
  displayShape: DisplayShape,
): DisplayShape;
```
The helper returns `"rect"` when `themeShape === "circle"`, else `displayShape`. Document why: the disc masks a circle theme after a rect layout; every other theme keeps the display's own geometry.

`theme/document.ts`: add `readonly shape?: ArtboardShape` to `Artboard`, importing the type from `../artboard.js`.

`envelope-keys.ts`: `artboard: ["width", "height", "contentFit", "shape"]`.

`envelope-semantics.ts` `validateArtboard`: `issues.enumValue(value["shape"], ["rect", "circle"], "/artboard/shape", "shape")`; then if `shape === "circle"` and both dimensions are finite positive numbers and different, add one `"out-of-range"` issue at `/artboard/height` with a message naming the square rule.

`index.ts`: export `ArtboardShape`.

`schema/theme-document.schema.json`: add `"shape": { "enum": ["rect", "circle"], "description": "…circle requires width === height (validated at runtime)" }`.

- [ ] **Step 4: Update the schema/keys sync tests**

Extend `fabric-envelope-schema-sync.test.ts` so the `artboard` property set includes `shape` and its enum matches `["rect", "circle"]`.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd src/web && npx vitest run packages/renderer-core/src/theme packages/renderer-core/src/artboard.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/web/packages/renderer-core schema/theme-document.schema.json
git commit -m "feat(renderer-core): persist an artboard's circle shape"
```

---

### Task 3: Presets and copy

**Files:**
- Modify: `src/web/packages/editor/src/artboard-presets.ts`
- Modify: `src/web/packages/editor/src/display-lens.ts`
- Modify: `src/web/packages/editor/src/ui-copy.ts`
- Test: `src/web/packages/editor/src/artboard-presets.test.ts`

**Interfaces:**
- Consumes: `ArtboardShape` from renderer-core.
- Produces: `ArtboardRatioId` without `"circle"` and with `"1:1"`; `ArtboardPresetShape` (renamed from the local `ArtboardShape`); `uiCopy.artboardShapes = { rect, circle }`; `uiCopy.artboardRatios["1:1"]`.

- [ ] **Step 1: Write the failing preset tests**

In `artboard-presets.test.ts`:
- `ARTBOARD_RATIOS.map(r => r.id)` equals `["16:9", "19.5:9", "4:3", "1:1"]`;
- `artboardSize("1:1", "1080p", "landscape")` equals `{width: 1080, height: 1080}`;
- `artboardPresetFor({width: 1080, height: 1080})` returns ratio `"1:1"`;
- `nearestArtboardPreset({width: 1080, height: 1080}).ratio` is `"1:1"`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd src/web && npx vitest run packages/editor/src/artboard-presets.test.ts`
Expected: FAIL — `"circle"` still present / `"1:1"` missing.

- [ ] **Step 3: Implement**

- `ArtboardRatioId = "16:9" | "19.5:9" | "4:3" | "1:1"`; `ARTBOARD_RATIOS` entry `{ id: "1:1", ratio: 1 }`.
- Rename the local `ArtboardShape` type to `ArtboardPresetShape` in `artboard-presets.ts` and update the import in `display-lens.ts`.
- `ui-copy.ts`: `artboardRatios` drops `circle` and adds `"1:1": "1:1"`; add `artboardShapes: { rect: "Rectangle", circle: "Circle" }` in the same word block.
- Update the `accessible-names` and `ui-copy-surfaces` tests only where they enumerate the removed/added option.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd src/web && npx vitest run packages/editor/src/artboard-presets.test.ts packages/editor/src/accessible-names.dom.test.ts packages/editor/src/ui-copy-surfaces.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/web/packages/editor/src
git commit -m "feat(editor): a square ratio is 1:1; circle becomes a shape"
```

---

### Task 4: Creation flow

**Files:**
- Modify: `src/web/packages/editor/src/new-document-chooser.tsx`
- Modify: `src/web/packages/editor/src/new-fabric-theme.ts`
- Modify: `src/web/packages/editor/src/editor-main.ts`
- Modify: `src/web/packages/editor/src/display-lens.ts`
- Test: `src/web/packages/editor/src/new-document-chooser.dom.test.ts`
- Test: `src/web/packages/editor/src/new-fabric-theme.test.ts` (create if absent)

**Interfaces:**
- Consumes: `ArtboardShape`, `Artboard`, `ArtboardPresetShape`.
- Produces: `NewDocumentAnswer = { size: ArtboardSize; shape: ArtboardShape; display: string | undefined }`; `createBlankFabricTheme(artboard: Artboard)`; `lensMatching(shape: ArtboardPresetShape, themeShape?: ArtboardShape)`.

- [ ] **Step 1: Write the failing tests**

`new-document-chooser.dom.test.ts`:
- opening the chooser at a square artboard reads Shape = Circle? No — shape is document data: opening at `{width: 1080, height: 1080, shape: "circle"}` reads Shape `Circle`; at a square rect artboard reads `Rectangle`;
- choosing Shape = Circle then Create answers `shape: "circle"` and a square `size` at the current resolution;
- choosing Shape = Circle hides the Ratio and Orientation selects;
- choosing Shape = Rectangle after Circle keeps the square size and shows both selects again.

`new-fabric-theme.test.ts`:
- `createBlankFabricTheme({width: 1080, height: 1080, shape: "circle"})` has `artboard.shape === "circle"`;
- `createBlankFabricTheme({width: 1080, height: 1080})` omits the key entirely.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd src/web && npx vitest run packages/editor/src/new-document-chooser.dom.test.ts packages/editor/src/new-fabric-theme.test.ts`
Expected: FAIL — no Shape control / no `shape` field.

- [ ] **Step 3: Implement**

Chooser:
- `current?: Artboard` (was `ArtboardSize`) so the opening shape is read; `chooseArtboardSize(current?: Artboard)`.
- `const [shape, setShape] = useState<ArtboardShape>(current?.shape ?? "rect")`.
- Shape `ControlSelect` (`data-yunari-new-document-shape`) above Ratio, options from `uiCopy.artboardShapes`.
- `setShape` writes: Circle → `adopt({width: side, height: side})` with `side = Math.min(chosen.width, chosen.height)`; Rectangle → keep `chosen`.
- While `shape === "circle"`, do not render the Ratio and Orientation selects. Resolution remains; its `derive` uses `ratio: "1:1"`, `orientation: "landscape"`.
- `answer()` returns `{size: chosen, shape, display}`.
- Opening display: `lensMatching(nearest, shape)?.id`, where `lensMatching` returns the first landscape circle lens when `themeShape === "circle"`, and the existing rect match otherwise.
- Update the `uiCopy.newDocument` copy tests and the accessible-name list for the new select.

`createBlankFabricTheme(artboard: Artboard)` writes `artboard: {width, height, ...(shape === "circle" ? {shape: "circle" as const} : {})}`.

`editor-main.ts` `onNew`: pass `{...answer.size, ...(answer.shape === "circle" ? {shape: "circle" as const} : {})}`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd src/web && npx vitest run packages/editor/src/new-document-chooser.dom.test.ts packages/editor/src/new-fabric-theme.test.ts packages/editor/src/display-lens.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/web/packages/editor/src
git commit -m "feat(editor): create a circle theme from the new-theme chooser"
```

---

### Task 5: Conversion and undoable artboard

**Files:**
- Create: `src/web/packages/editor/src/artboard-conversion.ts`
- Modify: `src/web/packages/editor/src/history-manager/index.ts`
- Modify: `src/web/packages/editor/src/editor-interaction.ts`
- Modify: `src/web/packages/editor/src/editor-shell.ts`
- Modify: `src/web/packages/editor/src/editor-document.ts`
- Modify: `src/web/packages/editor/src/editor-session.ts`
- Modify: `src/web/packages/editor/src/artboard-panel.ts`
- Modify: `src/web/packages/editor/src/panes/document/document-pane.tsx`
- Modify: `src/web/packages/editor/src/panes/document/artboard-fields.tsx`
- Test: `src/web/packages/editor/src/artboard-conversion.test.ts`
- Test: `src/web/packages/editor/src/history-manager/index.test.ts`
- Test: `src/web/packages/editor/src/artboard-panel.dom.test.ts`

**Interfaces:**
- Consumes: `ArtboardShape`, `Artboard`.
- Produces: `circleConversion(artboard: Artboard): ArtboardConversion` where `ArtboardConversion = { artboard: Artboard; scale: number }`; `EditorDocument.setArtboardShape(shape: ArtboardShape): void`; `HistoryEnvelopePort` with `read/write` over `{ globals, artboard }`.

- [ ] **Step 1: Write the failing conversion math test**

`artboard-conversion.test.ts`:
```ts
circleConversion({ width: 1920, height: 1080 })
  // -> { artboard: { width: 1080, height: 1080, shape: "circle" },
  //      scale: 1080 / Math.hypot(1920, 1080) }
```
- a square 1080 artboard converts to itself with `scale = 1080 / Math.hypot(1080, 1080)`;
- a circle artboard passed in is returned unchanged.

- [ ] **Step 2: Write the failing panel test**

In `artboard-panel.dom.test.ts`, with a rectangular artboard:
- choosing Shape = Circle commits one artboard whose `shape` is `"circle"`, `width === height`, and whose canvas objects are scaled by `side / hypot(w, h)` and centred — use a `Rect` at a known origin and assert its `left`, `top`, `scaleX`;
- choosing Shape = Rectangle on a circle artboard commits an artboard without `shape`;
- the Ratio and Orientation selects are absent while the artboard is circle;
- editing one size field on a circle artboard writes both edges.

In `history-manager/index.test.ts`:
- a port restored from an entry hands back the artboard captured with the scene;
- undo after a scene + artboard change restores both.

- [ ] **Step 3: Run the tests to verify they fail**

Run: `cd src/web && npx vitest run packages/editor/src/artboard-conversion.test.ts packages/editor/src/history-manager/index.test.ts packages/editor/src/artboard-panel.dom.test.ts`
Expected: FAIL — module/export missing.

- [ ] **Step 4: Implement `circleConversion`**

`side = Math.min(artboard.width, artboard.height)`; `scale = side / Math.hypot(artboard.width, artboard.height)`; returns `{ artboard: { width: side, height: side, shape: "circle" }, scale }`. If already circle, return `{ artboard, scale: 1 }`.

- [ ] **Step 5: Extend history to the envelope**

- `HistoryEnvelopePort` replaces `HistoryGlobalsPort`:
  `read(): { globals: FabricGlobals | undefined; artboard: Artboard }`,
  `write(state): void`.
- `HistoryEntry` stores `artboard`; `captureWith`, `sameEntry` and the fingerprint include it.
- Rename `attachGlobals` to `attachEnvelope` and `HistoryGlobalsPort` to
  `HistoryEnvelopePort` across `src/web/packages/editor/src`. There are ~87
  references, most of them the `historyManager: { attachGlobals: () => {} }`
  stub in tests; rename them with a project-wide search/replace, then confirm
  `git grep attachGlobals` is empty.
- Update `editor-interaction.ts` and `editor-shell.ts`.
- `editor-document.ts` attaches `read: () => ({ globals: this.#envelope.globals, artboard: this.#envelope.artboard })` and `write: (state) => { this.#restoreGlobals(state.globals); this.setArtboard(state.artboard); }`.

- [ ] **Step 6: Implement `EditorDocument.setArtboardShape`**

- Same shape → return.
- `"rect"`: write the envelope without `shape`, `shell.setArtboard`, redraw the panel.
- `"circle"`: `const release = historyManager.suspend(); try { for each canvas object: left' = side/2 + (left − w/2)·scale, top' likewise, scaleX *= scale, scaleY *= scale, setCoords(); write the envelope; shell.setArtboard; panel render; } finally { release(); } historyManager.save(); shell.editor.viewport.zoomToFit();`
- The object loop uses the canvas's top-level objects only; the plate and clip are not objects.

- [ ] **Step 7: Wire the Shape control**

- `ArtboardFields` gains `onShapeChange: (shape: ArtboardShape) => void`; renders the Shape select above Ratio from `uiCopy.artboardShapes`.
- When `artboard.shape === "circle"`: hide Ratio and Orientation; the Resolution select derives with `"1:1"`/`"landscape"`; `ControlPair` edits write both edges.
- `DocumentPane` passes `onShapeChange`; `ArtboardPanel`'s options gain `onShapeChange`; `editor-session` wires it to `this.#document.setArtboardShape`.

- [ ] **Step 8: Run the tests to verify they pass**

Run: `cd src/web && npx vitest run packages/editor/src/artboard-conversion.test.ts packages/editor/src/history-manager packages/editor/src/artboard-panel.dom.test.ts packages/editor/src/editor-document`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/web/packages/editor/src
git commit -m "feat(editor): convert a theme to a circle in one undoable step"
```

---

### Task 6: Editor viewport geometry

**Files:**
- Modify: `src/web/packages/editor/src/viewport-manager/index.ts`
- Test: `src/web/packages/editor/src/viewport-manager/viewport.test.ts`

**Interfaces:**
- Consumes: `ArtboardShape`, `artboardTransformShape`.
- Produces: the viewport input's `artboard` reading includes `shape?: ArtboardShape`; circle themes fit by the rect rule and their display screen is the artboard's screen rect under a circle lens.

- [ ] **Step 1: Write the failing viewport tests**

- A 1080² artboard with `shape: "circle"` under a circle lens in a 400×400 host fits at `400 / 1080` (fills the box), not `400 / hypot(1080, 1080)`.
- A 1080² **rect** artboard under a circle lens keeps the diagonal fit (`400 / hypot(1080, 1080)`).
- A circle theme under a circle lens: `displayScreenRect()` equals `artboardScreenRect()`.
- A circle theme under a rect lens: `displayScreenRect()` is the rect lens box.
- A circle theme under Fit: `displayScreenRect()` is `undefined`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd src/web && npx vitest run packages/editor/src/viewport-manager/viewport.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

- `ViewportManagerInput.artboard` returns `{ width, height, shape?: ArtboardShape }`.
- `fitScaleFor`: `const shape = artboardTransformShape(themeShape, active?.shape ?? "rect")`; use the diagonal rule only when `active?.shape === "circle"` **and** the theme is not circle; otherwise the rect contain rule. Simplest exact rule: if `themeShape === "circle"` use `Math.min(box.width / board.width, box.height / board.height)`; else keep the existing branch.
- `displayScreenRect`: when `themeShape === "circle"` and the active lens is circle, return `artboardScreenRect()`; otherwise the existing `lensBox` path.
- `displayShape()`: unchanged (the lens's own shape).

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd src/web && npx vitest run packages/editor/src/viewport-manager`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/web/packages/editor/src/viewport-manager
git commit -m "feat(editor): a circle theme fills a circle lens instead of shrinking"
```

---

### Task 7: Editor disc preview and guide

**Files:**
- Modify: `src/web/packages/editor/src/editor-shell.ts`
- Modify: `src/web/packages/editor/src/editor-shell/editor-shell.css`
- Test: `src/web/packages/editor/src/editor-shell.dom.test.ts`

**Interfaces:**
- Consumes: `Artboard.shape`, the viewport from Task 6.
- Produces: a canvas clip that is a `Circle` under a circle lens for a circle theme; a `[data-yunari-theme-disc]` guide element; circle-clipped theme-bounded media.

- [ ] **Step 1: Write the failing shell tests**

- A circle artboard + circle lens: `canvas.clipPath` is a Fabric `Circle` with radius `min(w, h) / 2` at the artboard centre; `[data-yunari-theme-guide]` is hidden and `[data-yunari-theme-disc]` is hidden.
- A circle artboard + rect lens: `canvas.clipPath` is a `Rect`; `[data-yunari-theme-disc]` is visible, and its geometry matches the artboard's inscribed circle in canvas coordinates.
- A circle artboard + Fit: the disc guide is visible.
- A 1080² **rect** artboard + circle lens: the clip stays a `Rect` (today's inscribed behaviour).
- Theme-bounded media on a circle artboard has `border-radius: 50%`; display-bounded media does not.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd src/web && npx vitest run packages/editor/src/editor-shell.dom.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

- Extract `artboardClip(artboard, crop: boolean)` returning a `Rect` or a `Circle` (`radius = min(w,h)/2`, centre origin, `absolutePositioned`, `excludeFromExport`).
- `applyArtboardPaint`'s clip memo key includes the crop flag; `placeScreen` re-applies the clip when the crop state changes (lens change), then `requestRenderAll()`.
- Crop state: `currentArtboard.shape === "circle" && resolveLens(viewport.display())?.shape === "circle"`.
- Add a `disc` element beside `guide`:
  ```ts
  disc.dataset["yunariThemeDisc"] = "";
  ```
  geometry: centred on `artboardScreenRect()`, side `min(rect.width, rect.height)`, `borderRadius = "50%"`. Style it in `editor-shell.css` with the same dashed/faint rule as `[data-yunari-theme-guide]` by sharing the selector list.
- `disc.hidden` is `currentArtboard.shape !== "circle" || crop`.
- `placeMedia`: when `currentArtboard.shape === "circle"`, pass `radius: "circle"` on the `artboard` box.
- Repaint the disc from `placeScreen` (it already runs on every camera change) and from `setArtboard`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd src/web && npx vitest run packages/editor/src/editor-shell.dom.test.ts packages/editor/src/artboard-clip.dom.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/web/packages/editor/src/editor-shell.ts src/web/packages/editor/src/editor-shell/editor-shell.css src/web/packages/editor/src/editor-shell.dom.test.ts
git commit -m "feat(editor): crop a circle theme to its disc and guide the rect preview"
```

---

### Task 8: Scene rendering

**Files:**
- Modify: `src/web/packages/scene-fabric/src/scene.ts`
- Test: `src/web/packages/scene-fabric/src/scene.dom.test.ts`
- Test: `src/web/packages/scene-fabric/src/artboard-backdrop.dom.test.ts`

**Interfaces:**
- Consumes: `ArtboardShape`, `artboardTransformShape`.
- Produces: `FabricSceneOptions.themeShape?: ArtboardShape`.

- [ ] **Step 1: Write the failing scene tests**

- Circle theme (`themeShape: "circle"`, artboard 100×100, host 200×200, rect presentation): the canvas viewport scale is `2` (the artboard fills the box), `element.style.clipPath` is `circle(100px at 100px 100px)`, and `[data-yunari-artboard-plate]` has `clipPath: circle(50% at 50% 50%)`.
- Circle theme on a 300×200 host: the disc is centred at the artboard's screen centre and its radius is `100px` (min side / 2 × scale), not the host's short edge.
- Rect theme on a circle presentation keeps the inscribed scale (`200 / hypot(100, 100)`).
- Theme-bounded media receives a `circle` radius; display-bounded media does not.
- `updatePresentation` after a circle-theme mount keeps the theme mask.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd src/web && npx vitest run packages/scene-fabric/src/scene.dom.test.ts`
Expected: FAIL — unknown option / no clip.

- [ ] **Step 3: Implement**

- `FabricSceneOptions.themeShape?: ArtboardShape`; default `"rect"`.
- `fit()`: pass `shape: artboardTransformShape(themeShape, presentation.shape)` to `computeArtboardTransform`.
- `applyPresentation`: compute `masked`, `radius = Math.min(board.width, board.height) * transform.scale / 2`, `cx = transform.offsetX + board.width * transform.scale / 2`, `cy = transform.offsetY + board.height * transform.scale / 2`.
  - rect branch: `element.style.clipPath = masked ? `circle(${radius}px at ${cx}px ${cy}px)` : ""`; keep `host.style.background = paint`.
  - circle branch: keep the existing screen fill and clip; when masked, the disc coincides.
  - `applyBoardPlate`: when masked, `plateElement.style.clipPath = "circle(50% at 50% 50%)"`; otherwise `""`.
- `fit()` media bounds: `artboard: { ..., ...(masked ? { radius: "circle" } : {}) }`.
- Glass backdrop surface: `shape: masked ? "circle" : presentation.shape`, box `displayBox(w, h, shape)`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd src/web && npx vitest run packages/scene-fabric`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/web/packages/scene-fabric/src
git commit -m "feat(scene): render a circle theme as the disc inscribed in its artboard"
```

---

### Task 9: Player wiring

**Files:**
- Modify: `src/web/packages/player/src/main.ts`
- Test: `src/web/packages/player/src/main.dom.test.ts`

**Interfaces:**
- Consumes: `FabricSceneOptions.themeShape`.
- Produces: the player passes the loaded envelope's `artboard.shape` to `mountFabricScene`.

- [ ] **Step 1: Write the failing player test**

In `main.dom.test.ts`, serve an envelope with `artboard: {width: 100, height: 100, shape: "circle"}` and a rectangular presentation (the existing fetch stub returns `{}` for the presentation route). Assert `document.querySelector("[data-yunari-artboard-plate]")` has a `clipPath` starting with `circle(`.

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd src/web && npx vitest run packages/player/src/main.dom.test.ts -t "circle"`
Expected: FAIL.

- [ ] **Step 3: Implement**

Add `themeShape: theme.artboard.shape ?? "rect"` to the `mountFabricScene` options in `startHostedTheme` (the mount at `main.ts:273`). Do not change presentation updates: the mask belongs to the document and survives them.

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd src/web && npx vitest run packages/player/src/main.dom.test.ts -t "circle"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/web/packages/player/src
git commit -m "feat(player): mount a circle theme with its artboard shape"
```

---

### Task 10: Circle thumbnails

**Files:**
- Modify: `src/web/packages/editor/src/thumbnail-capture.ts`
- Modify: `src/web/packages/editor/src/editor-document.ts` (the `#capture` call)
- Test: `src/web/packages/editor/src/thumbnail-capture.dom.test.ts`

**Interfaces:**
- Consumes: `ArtboardShape`.
- Produces: `captureCanvas(canvas, backdrop, maxEdge, suspendViewState, shape?: ArtboardShape)` and `captureThumbnail(canvas, maxEdge, backdrop, suspendViewState, shape?: ArtboardShape)`.

- [ ] **Step 1: Write the failing thumbnail test**

Mount a canvas whose artboard is 100×100 with a red rectangle over it and a blue backdrop paint. Call `captureCanvas(canvas, backdrop, 640, undefined, "circle")` and read pixels:
- centre pixel is red;
- the four corners are blue (the backdrop), not red.

Also assert the canvas's live `clipPath` is restored to what it was before the call.

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd src/web && npx vitest run packages/editor/src/thumbnail-capture.dom.test.ts`
Expected: FAIL — no `shape` parameter.

- [ ] **Step 3: Implement**

In `captureCanvas`, when `shape === "circle"`: save `canvas.clipPath`; set `new Circle({ radius: Math.min(width, height) / 2, left: width / 2, top: height / 2, originX: "center", originY: "center", absolutePositioned: true, excludeFromExport: true })`; capture; restore in `finally` before compositing. Import `Circle` from `fabric/es`.

`editor-document.ts` `#capture`: pass `this.#envelope.artboard.shape ?? "rect"`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd src/web && npx vitest run packages/editor/src/thumbnail-capture.dom.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/web/packages/editor/src/thumbnail-capture.ts src/web/packages/editor/src/editor-document.ts src/web/packages/editor/src/thumbnail-capture.dom.test.ts
git commit -m "fix(editor): capture a circle theme's thumbnail as its disc"
```

---

### Task 11: Docs and the green gate

**Files:**
- Modify: `docs/product.md`
- Modify: `docs/architecture.md` (only if it describes the artboard fields)
- Modify: `docs/decisions/0052-circle-theme-shape.md` (status: accepted)

**Interfaces:**
- Consumes: everything above.
- Produces: documentation that states the current rule.

- [ ] **Step 1: Update the docs**

- `docs/product.md`, Authoring: state that a theme's artboard is rectangular or circular, and that a circular theme's glass is the disc inscribed in its square canvas.
- `docs/architecture.md`: where the theme envelope is described, mention `artboard.shape` and the absent-means-rect rule.

- [ ] **Step 2: Run the full gate**

Run from `src/web`, redirecting to a file **outside the repository** (e.g.
`$env:TEMP\yunari-gate.log` in PowerShell or `"$TMPDIR"` in Bash) and read the
exit code from the shell, not from a pipe. Do not pipe the gate: the pipe's exit
code hides the gate's.
Expected: `0`. If non-zero, read the log and fix before committing.

- [ ] **Step 3: Commit**

```bash
git add docs/product.md docs/architecture.md docs/decisions/0052-circle-theme-shape.md
git commit -m "docs: a circle theme's glass is the disc inscribed in its artboard"
```

---

### Task 12: Preview ratio catalogue

**Files:**
- Modify: `src/web/packages/editor/src/editor-shell/settings.tsx`
- Modify: `src/web/packages/editor/src/display-lens.ts`
- Modify: `src/web/packages/editor/src/ui-copy.ts`
- Test: `src/web/packages/editor/src/display-lens.test.ts`
- Test: `src/web/packages/editor/src/editor-shell/settings.dom.test.tsx`

**Interfaces:**
- Consumes: `parsePreviewRatio`, `previewLenses`, `activePreviewRatioTokens`, `setActivePreviewRatios`.
- Produces: `parsePreviewRatio` preserves the entered spelling (no GCD rename); `previewRatioKey(ratio)` (the long-over-short aspect, orientation-insensitive); the Previews tab has no Shape control and accepts `Circle` typed into the one field.

- [ ] **Step 1: Write the failing tests**

`display-lens.test.ts`:
- `parsePreviewRatio("21:9").id === "21:9"` and `parsePreviewRatio("7:3").id === "7:3"` (no renaming);
- `parsePreviewRatio("32:18").id === "32:18"`;
- `parsePreviewRatio("circle").id === "Circle"`;
- `previewRatioKey` equal for `21:9` and `7:3`, and for `16:9` and `9:16`;
- `normalisePreviewRatioTokens(["21:9", "7:3"])` keeps only `["21:9"]` (first wins);
- `setActivePreviewRatios(["16:9", "32:18"])` makes `activePreviewRatioTokens()` hold one token.

`settings.dom.test.tsx`:
- the Previews tab renders no `[data-yunari-preview-ratio-shape]` control;
- typing `Circle` and pressing Add adds the `Circle` token;
- adding `7:3` when `21:9` is present shows a refusal naming both (`7:3` and `21:9`) and does not add it;
- adding `9:16` when `16:9` is present is refused naming `16:9`;
- adding a ratio re-sorts the list widest-first, with `Circle` last.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd src/web && npx vitest run packages/editor/src/display-lens.test.ts packages/editor/src/editor-shell/settings.dom.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement the catalogue rules**

`display-lens.ts`:
- `parsePreviewRatio` keeps `${rawWidth}:${rawHeight}` as `id` for every non-circle token; delete the GCD normalisation and its helper if unused.
- Add `export function previewRatioKey(ratio: PreviewRatio): number` returning `Math.max(width, height) / Math.min(width, height)`; `Circle` returns `1`.
- `normalisePreviewRatioTokens` drops a token whose key equals an earlier accepted token's key.
- `setActivePreviewRatios` already normalises; no second rule.

`settings.tsx`:
- Delete the `shape` state, the `ControlSegmented` block, and the circle-specific refusal; always render the text field.
- `add`: parse the draft (which may be `Circle`), then refuse when any existing token's `previewRatioKey` equals the new one, with `setReason(uiCopy.settings.previewRatioEquivalent(existingToken, ratio.id))`.
- On success, `commit(sortPreviewTokens([...tokens, ratio.id]))`.
- Add `sortPreviewTokens(tokens)` locally (or in `display-lens.ts`): rect tokens by aspect descending, then `Circle` tokens, ties by token text.
- `removeRatio`/`reset` unchanged.

`ui-copy.ts`: remove `previewRatioShape`, `previewRatioRect`, `previewRatioCircle` (dead), remove `previewRatioDuplicate` if it becomes unused, and add:
`previewRatioEquivalent: (entered, existing) => \`${entered} is the same shape as ${existing}, which is already in the list.\``

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd src/web && npx vitest run packages/editor/src/display-lens.test.ts packages/editor/src/editor-shell/settings.dom.test.tsx packages/editor/src/accessible-names.dom.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/web/packages/editor/src
git commit -m "feat(editor): preview ratios keep their names, refuse equivalents and sort on add"
```

---

## Self-Review Notes

- Every spec section maps to a task: data model → 2; creation → 3, 4; conversion/undo → 5; editor preview → 6, 7; output → 8, 9; thumbnails → 10; docs/gate → 11; decision note → 1.
- The Review Focus tests are placed: unequal circle edges → Task 2; converted transformed objects → Task 5; undo → Task 5; rect theme on a round display → Task 8; circle thumbnail under a rect lens → Task 10.
- Naming is consistent: `ArtboardShape`, `artboardTransformShape`, `circleConversion`, `themeShape`, `setArtboardShape`, `HistoryEnvelopePort`, `[data-yunari-theme-disc]`.
- Task 12 is a user-requested addition outside the spec: the preview-ratio catalogue loses its Shape control, keeps entered ratio names, refuses an equivalent shape with a reason, and sorts on add.
