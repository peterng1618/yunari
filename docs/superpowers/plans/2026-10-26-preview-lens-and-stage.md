# Preview Lens and Stage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a preview ratio a scene-anchored virtual display, give the stage back to the shell, and let authors manage the preview-ratio catalogue.

**Architecture:** `display-lens.ts` becomes the catalogue owner: defaults, parsing, the active module-level list, and browser storage. The viewport derives the lens box in artboard units and camera-transforms it, so the frame, letterbox and display-bounded media move with the artwork. The editor shell paints the stage from the palette and the letterbox from the theme, and adds a guide frame plus a circular lens.

**Tech Stack:** TypeScript, React 19, Base UI, Fabric 7, Vitest, Playwright, Biome.

**Spec:** [`docs/superpowers/specs/2026-10-26-preview-lens-and-stage-design.md`](../specs/2026-10-26-preview-lens-and-stage-design.md)

## Global Constraints

- Work from `src/web/`. No new dependencies.
- `exactOptionalPropertyTypes` and `noUncheckedIndexedAccess` are on. Optional fields are omitted, never set to `undefined`.
- Refuse invalid numbers rather than coercing them to zero.
- Every visible string comes from `uiCopy`; no inline copy in a component.
- Every visible change needs a real-browser assertion, not only unit geometry.
- A watched mechanism path (reuse gate) needs its decision note before its first write.
- Run focused tests during a task; run `npm run gate` at the phase boundary.
- Commit explicit paths with a Conventional Commit title. Never `git add -A`.

## Review Focus

1. Removing the last preview ratio leaves a live lens id → the viewport clears the lens, re-fits, and the menu offers Fit without throwing.
2. A browser that refuses `localStorage` → the Previews tab still changes the session list, and no read or write throws.
3. Hand-edited storage with duplicates or garbage → invalid entries are dropped, duplicates keep their first position, and defaults are used only when the whole value is unreadable.
4. A circle lens over a non-square artboard → all four artboard corners lie on the disc, display media is clipped round, and the stage is still visible outside the disc.
5. Adding `19.5:9` or `16:9` again → refused with a visible reason, and a decimal ratio keeps its typed spelling.

## File Structure

- `packages/editor/src/display-lens.ts` — catalogue, parsing, active list, storage. Owns all preview-ratio rules.
- `packages/editor/src/display-lens.test.ts` — the catalogue's pure rules.
- `packages/editor/src/viewport-manager/index.ts` — scene-anchored lens box, shape-aware fit, catalogue subscription.
- `packages/editor/src/editor-shell.ts` — stage paint removal, letterbox paint, guide frame, circle screen, media bounds.
- `packages/editor/src/editor-shell/editor-shell.css` — stage texture, guide frame, circular screen.
- `packages/editor/src/editor-shell/settings.tsx` — the `previews` tab.
- `packages/editor/src/editor-shell/display-switch.tsx` — active catalogue and labels.
- `packages/editor/src/new-document-chooser.tsx` — size and preview decoupled.
- `packages/editor/src/ui-copy.ts` — tab and refusal copy.
- `packages/scene-fabric/src/background-media.ts` — optional display bounds and a circular clip.
- `src/web/tests/e2e/editor-display.spec.ts` — browser proof.

---

### Task 1: The preview-ratio catalogue

**Files:**
- Create: `docs/decisions/0119-a-preview-ratio-is-a-catalogue-entry-and-the-lens-is-scene-geometry.md`
- Modify: `packages/editor/src/display-lens.ts`
- Test: `packages/editor/src/display-lens.test.ts`

**Interfaces:**
- Consumes: `ARTBOARD_ORIENTATIONS`, `ArtboardOrientation`, `ArtboardShape` from `artboard-presets.js`.
- Produces:
  - `type PreviewShape = "rect" | "circle"`
  - `interface PreviewRatio { id; width; height; shape }`
  - `DEFAULT_PREVIEW_RATIO_TOKENS: readonly string[]`
  - `PREVIEW_RATIO_STORAGE_KEY = "yunari.editor.preview-ratios"`
  - `parsePreviewRatio(input: string): PreviewRatio` (throws `RangeError`)
  - `normalisePreviewRatioTokens(value: unknown): readonly string[]`
  - `readPreviewRatioTokens(storage: Storage | undefined): readonly string[]`
  - `writePreviewRatioTokens(storage, tokens): void`
  - `clearPreviewRatioTokens(storage): void`
  - `interface DisplayLens { id; aspect; orientation; shape: PreviewShape }`
  - `previewLenses(tokens: readonly string[]): readonly DisplayLens[]`
  - `activePreviewLenses(): readonly DisplayLens[]`
  - `activePreviewRatioTokens(): readonly string[]`
  - `defaultPreviewLens(): DisplayLens | undefined`
  - `resolveLens(id: string): DisplayLens | undefined`
  - `lensMatching(shape: ArtboardShape): DisplayLens | undefined`
  - `setActivePreviewRatios(tokens: readonly string[]): void`
  - `subscribeLenses(listener: () => void): () => void`
  - `previewCatalogueKey(): string`
  - `lensBox(lens, artboard): { left; top; width; height }`
  - `displayLensGroups(leading): readonly { orientation; lenses }[]`

- [ ] **Step 1: Write the decision note**

Write `docs/decisions/0119-a-preview-ratio-is-a-catalogue-entry-and-the-lens-is-scene-geometry.md` from the template. Paths: `packages/editor/src/display-lens.ts`, `packages/editor/src/viewport-manager/index.ts`, `packages/editor/src/editor-shell.ts`, `packages/editor/src/editor-shell/editor-shell.css`. Record the searches actually made: the existing `display-lens.ts` derivation, `palette.ts`/`bindings.ts` for the storage-key rule, `screenRect` for host-space framing, the shell mockup's stage gradient, and the decision that the lens is camera state (`§67`), not document content.

- [ ] **Step 2: Write the failing tests**

Replace the derivation tests in `display-lens.test.ts` with these cases:

```ts
it("parses integer pairs into a reduced id", () => {
  expect(parsePreviewRatio("32:18")).toMatchObject({ id: "16:9", width: 16, height: 9 });
});

it("keeps a decimal edge as typed", () => {
  expect(parsePreviewRatio(" 19.5:9 ")).toMatchObject({ id: "19.5:9", width: 19.5, height: 9 });
});

it("parses Circle as a 1:1 disc", () => {
  expect(parsePreviewRatio("Circle")).toEqual({ id: "Circle", width: 1, height: 1, shape: "circle" });
});

it.each(["", "16", "16:0", "-1:9", "a:b", "1:2:3", "NaN:9", "16:9:extra"])(
  "refuses %s",
  (input) => expect(() => parsePreviewRatio(input)).toThrow(RangeError),
);

it("drops invalid entries and keeps the first duplicate", () => {
  expect(normalisePreviewRatioTokens(["16:9", "nope", "16:9", "Circle", 7])).toEqual(["16:9", "Circle"]);
});

it("reads defaults when the key is absent or unreadable", () => {
  expect(readPreviewRatioTokens(undefined)).toEqual(DEFAULT_PREVIEW_RATIO_TOKENS);
  expect(readPreviewRatioTokens(storageReturning("not json"))).toEqual(DEFAULT_PREVIEW_RATIO_TOKENS);
});

it("keeps an authored empty list as empty", () => {
  expect(readPreviewRatioTokens(storageReturning("[]"))).toEqual([]);
});

it("derives one landscape lens and a portrait twin only for a wide ratio", () => {
  const lenses = previewLenses(["16:9", "1:1", "Circle"]);
  expect(lenses.map((lens) => lens.id)).toEqual(["16:9", "9:16", "1:1", "Circle"]);
});

it("marks only Circle as a disc", () => {
  expect(previewLenses(["1:1", "Circle"]).map((lens) => lens.shape)).toEqual(["rect", "circle"]);
});

it("boxes the artboard in a lens of the lens aspect", () => {
  expect(lensBox({ aspect: 1, shape: "rect" }, { width: 1600, height: 900 }))
    .toEqual({ left: 0, top: -350, width: 1600, height: 1600 });
});

it("boxes a circle lens at the artboard diagonal", () => {
  const side = Math.hypot(1600, 900);
  const box = lensBox({ aspect: 1, shape: "circle" }, { width: 1600, height: 900 });
  expect(box.width).toBeCloseTo(side, 9);
  expect(box.left).toBeCloseTo((1600 - side) / 2, 9);
});
```

Add `const storageReturning = (value: string): Storage => ({ getItem: () => value } as unknown as Storage);` beside the tests. Keep the existing `screenRect` refusal test.

- [ ] **Step 3: Run the tests and verify they fail**

Run: `npm test -- packages/editor/src/display-lens.test.ts`
Expected: FAIL — `parsePreviewRatio is not exported`.

- [ ] **Step 4: Implement the catalogue**

In `display-lens.ts`:

- Delete `Upright`, `ratioOf`, `DISPLAY_LENSES`, `DEFAULT_DISPLAY_LENS`, `displayLensIdForShape`, `displayLens`.
- `parsePreviewRatio`: trim; `Circle` (case-insensitive) returns the disc; otherwise split on `:` into exactly two parts, `Number` each, require finite and `> 0`; require equality for a circle (never authored as an aspect); if both are integers, divide by `gcd`, else keep the trimmed numeric text.
- `normalisePreviewRatioTokens`: non-array → defaults; map each entry through the parser, dropping failures; dedupe by `id`, first wins.
- Storage helpers: `getItem`/`setItem`/`removeItem` in `try/catch`; absent key → defaults; `JSON.parse` failure or non-array → defaults; an empty array stays empty. Writes the array verbatim; `clear` removes the key.
- `previewLenses`: for each token, a landscape lens; add the portrait twin when `width > height`; `aspect = width / height` or its reciprocal; square and circle produce one lens only.
- Active list: module-level `let active = previewLenses(DEFAULT_PREVIEW_RATIO_TOKENS)`, `let revision = 0`, `const listeners = new Set<() => void>()`. `setActivePreviewRatios` computes `previewLenses(normalisePreviewRatioTokens(tokens))`, replaces only when the token list or lens list actually differs, then increments `revision` and notifies. `previewCatalogueKey` returns `String(revision)`.
- `lensMatching(shape)` finds a lens whose `shape === "rect"` and whose `orientation` and `aspect` match `shape`'s; returns `undefined` rather than throwing.
- `lensBox`: rect uses the spec formula; circle uses `side = Math.hypot(w, h)` centred.

- [ ] **Step 5: Run the tests and verify they pass**

Run: `npm test -- packages/editor/src/display-lens.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/web/packages/editor/src/display-lens.ts src/web/packages/editor/src/display-lens.test.ts docs/decisions/0119-a-preview-ratio-is-a-catalogue-entry-and-the-lens-is-scene-geometry.md
git commit -m "feat(editor): own the preview-ratio catalogue"
```

---

### Task 2: The viewport frames a scene-anchored display

**Files:**
- Modify: `packages/editor/src/viewport-manager/index.ts`
- Test: `packages/editor/src/viewport-manager/viewport.test.ts`

**Interfaces:**
- Consumes: `activePreviewLenses`, `defaultPreviewLens`, `resolveLens`, `lensBox`, `subscribeLenses`, `PreviewShape` from Task 1.
- Produces:
  - `ViewportManager.displayShape(): PreviewShape | undefined`
  - `displayScreenRect()` returns the camera-transformed `lensBox`, not a host rect.
  - `framingBox` is host-space and shape-aware only for a circle fit.

- [ ] **Step 1: Write the failing tests**

Add to `viewport.test.ts`:

```ts
it("moves the display box with the camera after a zoom", () => {
  const camera = createCamera({ width: 800, height: 600, artboard: { width: 1600, height: 900 } });
  camera.showDisplay("16:9");
  const fitted = camera.displayScreenRect();
  camera.zoomBy(1.5);
  const zoomed = camera.displayScreenRect();
  expect(zoomed?.left).not.toBeCloseTo(fitted?.left ?? 0, 6);
  expect(zoomed?.width).toBeCloseTo((fitted?.width ?? 0) * 1.5, 6);
});

it("moves the display box by the pan delta", () => {
  const camera = createCamera({ width: 800, height: 600, artboard: { width: 1600, height: 900 } });
  camera.showDisplay("16:9");
  camera.zoomBy(2);
  const before = camera.displayScreenRect();
  camera.panBy(40, -25);
  const after = camera.displayScreenRect();
  expect(after?.left).toBeCloseTo((before?.left ?? 0) + 40, 6);
  expect(after?.top).toBeCloseTo((before?.top ?? 0) - 25, 6);
});

it("inscribes the artboard diagonal in a circle lens", () => {
  const camera = createCamera({ width: 800, height: 600, artboard: { width: 1600, height: 900 } });
  camera.showDisplay("Circle");
  const board = camera.artboardScreenRect();
  const screen = camera.displayScreenRect();
  expect(screen?.width).toBeCloseTo(Math.min(800, 600), 6);
  expect(Math.hypot(board.width, board.height)).toBeCloseTo(screen?.width ?? 0, 6);
});

it("clears a lens removed from the catalogue", () => {
  const camera = createCamera({ width: 800, height: 600, artboard: { width: 1600, height: 900 } });
  camera.showDisplay("16:9");
  setActivePreviewRatios(["4:3"]);
  expect(camera.display()).toBeUndefined();
  resetPreviewRatios();
});

it("opens on the first landscape lens or Fit", () => {
  setActivePreviewRatios(["9:16"]);
  expect(createCamera({ width: 800, height: 600, artboard: { width: 1600, height: 900 } }).display()).toBeUndefined();
  resetPreviewRatios();
});
```

Use the file's existing camera/artboard helpers; add `resetPreviewRatios` that calls `setActivePreviewRatios(DEFAULT_PREVIEW_RATIO_TOKENS)` and a `beforeEach(resetPreviewRatios)`. Update tests that imported `DEFAULT_DISPLAY_LENS` to use `defaultPreviewLens()?.id`.

- [ ] **Step 2: Run the tests and verify they fail**

Run: `npm test -- packages/editor/src/viewport-manager/viewport.test.ts`
Expected: FAIL — `showDisplay("Circle")` throws or the zoom case stays pinned.

- [ ] **Step 3: Implement the scene-anchored box**

- Replace the `DEFAULT_DISPLAY_LENS` import with `defaultPreviewLens`, `resolveLens`, `lensBox`, `subscribeLenses`.
- Construct `let lens = defaultPreviewLens()?.id`.
- `framingBox`: circle lens → `screenRect(viewport, 1)`; otherwise `screenRect(viewport, lens.aspect)`.
- `fitScaleFor(box)`: circle → `box.width / Math.hypot(board.width, board.height)`; otherwise the existing contain scale.
- `displayScreenRect`: resolve the lens; `box = lensBox(lens, artboard())`; read `canvas.viewportTransform` and return `{ left: vpt[4] + box.left * vpt[0], top: vpt[5] + box.top * vpt[3], width: box.width * vpt[0], height: box.height * vpt[3] }`.
- `displayShape: () => (lens === undefined ? undefined : resolveLens(lens)?.shape)`.
- `showDisplay(id)`: `lens = id === undefined ? undefined : resolveLens(id)?.id; zoomToFit()`.
- `zoomBy`: centre on `displayScreenRect()` when present, else the host rect.
- Subscribe to `subscribeLenses`: when the active lens id no longer resolves, set `lens = undefined`, `zoomToFit()`. Store the unsubscribe and call it in `destroy`.

- [ ] **Step 4: Run the tests and verify they pass**

Run: `npm test -- packages/editor/src/viewport-manager/viewport.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/web/packages/editor/src/viewport-manager/index.ts src/web/packages/editor/src/viewport-manager/viewport.test.ts
git commit -m "fix(editor): anchor the preview lens to the scene"
```

---

### Task 3: The stage, the letterbox, the guide frame and a circular screen

**Files:**
- Modify: `packages/editor/src/editor-shell.ts`
- Modify: `packages/editor/src/editor-shell/editor-shell.css`
- Modify: `packages/scene-fabric/src/background-media.ts`
- Test: `packages/editor/src/editor-shell.dom.test.ts`, `packages/scene-fabric/src/background-media.dom.test.ts`

**Interfaces:**
- Consumes: `ViewportManager.displayShape()` from Task 2; `resolveLens` from Task 1.
- Produces:
  - `MediaBounds.display?: MediaBox`
  - `MediaBox.radius?: "circle"`
  - `[data-yunari-theme-guide]`

- [ ] **Step 1: Write the failing tests**

In `editor-shell.dom.test.ts`:

```ts
it("paints the stage from the palette, not the theme", async () => {
  const shell = await mountEditor({ background: { color: "#ff0000" } });
  const host = shell.root.querySelector<HTMLElement>("#canvas-host");
  expect(host?.style.background).toBe("");
});

it("paints the display letterbox with the theme colour", async () => {
  const shell = await mountEditor({ background: { color: "#ff0000" } });
  const screen = shell.root.querySelector<HTMLElement>("[data-yunari-display-screen]");
  expect(screen?.style.background).toBe("rgb(255, 0, 0)");
});

it("shows the guide when the lens and the artboard aspects differ", async () => {
  const shell = await mountEditor({ artboard: { width: 1600, height: 900 } });
  shell.viewport.showDisplay("1:1");
  const guide = shell.root.querySelector<HTMLElement>("[data-yunari-theme-guide]");
  expect(guide?.hidden).toBe(false);
  shell.viewport.showDisplay(undefined);
  expect(guide?.hidden).toBe(true);
});
```

In `background-media.dom.test.ts`:

```ts
it("falls back to the artboard when there is no display box", () => {
  const handle = mount({ bounds: { artboard: box(10, 20, 100, 50) } });
  expect(layer(handle).style.width).toBe("100px");
});

it("rounds a circular display box", () => {
  const handle = mount({ bounds: { artboard: box(0, 0, 100, 50), display: { ...box(0, 0, 50, 50), radius: "circle" } } });
  expect(layer(handle).style.borderRadius).toBe("50%");
});
```

- [ ] **Step 2: Run the tests and verify they fail**

Run: `npm test -- packages/editor/src/editor-shell.dom.test.ts packages/scene-fabric/src/background-media.dom.test.ts`
Expected: FAIL — the host still carries `rgb(255, 0, 0)`; no guide element exists.

- [ ] **Step 3: Implement**

`editor-shell.ts`:

- Delete `host.style.background = cssArtboardPaint(paint) ?? "#000"` from `applyArtboardPaint`.
- Declare `let screen: HTMLElement | undefined` before `paintArtboard`; in `paintArtboard`, after resolving, set `if (screen !== undefined) screen.style.background = cssArtboardPaint(artboardPaint) ?? "#000";`.
- Create the screen as today; set its radius from `editor.viewport.displayShape() === "circle" ? "50%" : ""` in `placeScreen`, and repaint its background there from the kept `artboardPaint`.
- Create a guide element `data-yunari-theme-guide`, append it to `container`, and in `placeScreen` position it at `artboardScreenRect()`; hide it when `display() === undefined` or `Math.abs(lens.aspect - board.width / board.height) <= 1e-6`.
- `placeMedia`: pass `display` only when `displayScreenRect()` is defined, and set `radius: "circle"` on that box when `displayShape() === "circle"`. Under Fit pass only `artboard`.

`background-media.ts`:

- `MediaBounds.display` becomes optional; `MediaBox` gains `radius?: "circle"`.
- `place()` uses `bounds?.display ?? bounds?.artboard` for a display-bounded layer, and sets `layer.style.borderRadius = box.radius === "circle" ? "50%" : ""`.

`editor-shell.css`:

- Delete `--yunari-canvas-bg` and the stage's `background: var(--yunari-canvas-bg)`.
- Give `.editor-shell-stage` the spec's `repeating-linear-gradient` over `var(--stage)`.
- Add the guide rule: absolute, 1px dashed `var(--yunari-subdued)`, reduced opacity, `pointer-events: none`, `z-index: 2`, `box-sizing: border-box`.
- Let `[data-yunari-display-screen]` sit above the stage texture (`z-index: 0`) and keep its solid outline.

- [ ] **Step 4: Run the tests and verify they pass**

Run: `npm test -- packages/editor/src/editor-shell.dom.test.ts packages/scene-fabric/src/background-media.dom.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/web/packages/editor/src/editor-shell.ts src/web/packages/editor/src/editor-shell/editor-shell.css src/web/packages/editor/src/editor-shell.dom.test.ts src/web/packages/scene-fabric/src/background-media.ts src/web/packages/scene-fabric/src/background-media.dom.test.ts
git commit -m "fix(editor): the stage belongs to the shell, the letterbox to the theme"
```

---

### Task 4: The Previews settings tab

**Files:**
- Modify: `packages/editor/src/editor-shell/settings.tsx`
- Modify: `packages/editor/src/editor-shell/shell-layout.tsx`
- Modify: `packages/editor/src/editor-shell/icons.ts` (only if `FIT_GLYPH` is not already exported)
- Modify: `packages/editor/src/ui-copy.ts`
- Test: `packages/editor/src/editor-shell/settings.dom.test.tsx`

**Interfaces:**
- Consumes: Task 1's catalogue and storage functions.
- Produces: `SettingsTab` gains `"previews"`; `SETTINGS_TABS` order is `appearance`, `previews`, `keyboard`, `connections`, `about`.

- [ ] **Step 1: Write the failing tests**

```ts
it("adds a rect ratio and offers both orientations", async () => {
  const tab = await openPreviews();
  await chooseShape(tab, "Rect");
  await typeRatio(tab, "21:9");
  await pressAdd(tab);
  expect(rows(tab).map((row) => row.textContent)).toEqual([
    "16:9 9:16", "19.5:9 9:19.5", "4:3 3:4", "1:1", "Circle", "7:3 3:7",
  ]);
});

it("refuses a duplicate with a worded reason", async () => {
  const tab = await openPreviews();
  await typeRatio(tab, "16:9");
  await pressAdd(tab);
  expect(reason(tab)).toBe(uiCopy.settings.previewRatioDuplicate);
  expect(rows(tab)).toHaveLength(5);
});

it("removes the last ratio and says Fit remains", async () => {
  const tab = await openPreviews();
  for (const row of rows(tab)) await remove(row);
  expect(rows(tab)).toHaveLength(0);
  expect(tab.textContent).toContain(uiCopy.settings.previewRatiosEmpty);
});

it("resets by removing the key", async () => {
  const tab = await openPreviews();
  await typeRatio(tab, "21:9");
  await pressAdd(tab);
  await pressReset(tab);
  expect(storage.getItem(PREVIEW_RATIO_STORAGE_KEY)).toBeNull();
  expect(rows(tab)).toHaveLength(5);
});
```

Add one test where `storage` is `undefined`: the list changes in the session and no call throws.

- [ ] **Step 2: Run the tests and verify they fail**

Run: `npm test -- packages/editor/src/editor-shell/settings.dom.test.tsx`
Expected: FAIL — no Previews tab.

- [ ] **Step 3: Implement**

`ui-copy.ts` under `settings`: `previews: "Previews"`, `previewRatiosHeading`, `previewRatiosHint`, `previewRatioAdd`, `previewRatioShape`, `previewRatioRect`, `previewRatioCircle`, `previewRatioField`, `previewRatioRemove`, `previewRatioReset`, `previewRatioDuplicate`, `previewRatioInvalid`, `previewRatiosEmpty`, `previewRatiosSessionOnly`.

`settings.tsx`:

- Add `"previews"` to `SettingsTab`, `SETTINGS_TABS`, and `SETTINGS_TAB_GLYPHS` (reuse `FIT_GLYPH`).
- `PreviewsTab({ storage })`: read `activePreviewRatioTokens()`; subscribe with `useSyncExternalStore(subscribeLenses, previewCatalogueKey)`.
- Each row shows the derived ids from `previewLenses([token])`, plus a Remove button. Data hooks `data-yunari-preview-ratio` and `data-yunari-preview-ratio-remove`.
- Add row: `ControlSegmented` Rect/Circle, a text input for Rect (`data-yunari-preview-ratio-input`), and an Add button (`data-yunari-preview-ratio-add`).
- Add: parse; on `RangeError` show `previewRatioInvalid`; on duplicate id show `previewRatioDuplicate`. Success: `next = [...current, ratio.id]`, write storage, `setActivePreviewRatios(next)`.
- Remove: `next = current.filter(token => parsePreviewRatio(token).id !== id)`, write, set active.
- Reset: `clearPreviewRatioTokens(storage)`, `setActivePreviewRatios(DEFAULT_PREVIEW_RATIO_TOKENS)`; disabled while the list already equals defaults.
- Empty list: render `previewRatiosEmpty`.
- `storage === undefined`: still call `setActivePreviewRatios`; show `previewRatiosSessionOnly`.

`shell-layout.tsx`: in `createShellLayout`, after `readStorage()`, call `setActivePreviewRatios(readPreviewRatioTokens(storage))`. Do it before any editor mounts.

- [ ] **Step 4: Run the tests and verify they pass**

Run: `npm test -- packages/editor/src/editor-shell/settings.dom.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/web/packages/editor/src/editor-shell/settings.tsx src/web/packages/editor/src/editor-shell/shell-layout.tsx src/web/packages/editor/src/editor-shell/settings.dom.test.tsx src/web/packages/editor/src/editor-shell/icons.ts src/web/packages/editor/src/ui-copy.ts
git commit -m "feat(editor): manage preview ratios in settings"
```

---

### Task 5: One catalogue in both pickers, and browser proof

**Files:**
- Modify: `packages/editor/src/editor-shell/display-switch.tsx`
- Modify: `packages/editor/src/new-document-chooser.tsx`
- Test: `src/web/tests/e2e/editor-display.spec.ts`
- Modify: `src/web/tests/e2e/editor-display.spec.ts`

**Interfaces:**
- Consumes: `activePreviewLenses`, `defaultPreviewLens`, `lensMatching`, `subscribeLenses`, `previewCatalogueKey` from Task 1; Task 2/3 behaviour.
- Produces: menu and chooser read the active catalogue; `uiCopy.display.displays` is deleted.

- [ ] **Step 1: Write the failing browser test**

Extend `editor-display.spec.ts`:

```ts
test("the stage is the shell's and the letterbox is the theme's", async ({ page }) => {
  await openEditor(page);
  const stage = await stageStyle(page);
  expect(stage.backgroundImage).toContain("repeating-linear-gradient");
});

test("a display-bounded background follows zoom and pan", async ({ page }) => {
  await openEditor(page);
  await chooseDisplay(page, "16:9");
  const before = await mediaGeometry(page);
  await page.keyboard.press("Control+=");
  const zoomed = await mediaGeometry(page);
  expect(zoomed.left).not.toBeCloseTo(before.left, 3);
  expect(zoomed.width / before.width).toBeCloseTo(zoomed.zoom / before.zoom, 3);
  await panBy(page, 40, -20);
  const panned = await mediaGeometry(page);
  expect(panned.left - zoomed.left).toBeCloseTo(40, 3);
});

test("the guide frame marks a mismatched artboard", async ({ page }) => {
  await openEditor(page);
  await chooseDisplay(page, "1:1");
  const guide = page.locator("[data-yunari-theme-guide]");
  await expect(guide).toBeVisible();
  await chooseDisplay(page, "16:9");
  await expect(guide).toBeHidden();
});

test("a circle lens puts the artboard corners on the disc", async ({ page }) => {
  await openEditor(page);
  await chooseDisplay(page, "Circle");
  const { board, screen } = await geometry(page);
  const centre = { x: screen.left + screen.width / 2, y: screen.top + screen.height / 2 };
  const radius = screen.width / 2;
  for (const corner of corners(board)) {
    const distance = Math.hypot(corner.x - centre.x, corner.y - centre.y);
    expect(distance).toBeCloseTo(radius, 1);
  }
  await expect(page.locator("[data-yunari-display-screen]")).toHaveCSS("border-radius", "50%");
});

test("settings add, remove and reset ratios", async ({ page }) => {
  await openEditor(page);
  await openSettings(page, "Previews");
  await addRatio(page, "21:9");
  await expect(displayMenuItems(page)).toContainText(["7:3", "3:7"]);
  await removeRatio(page, "7:3");
  await resetRatios(page);
  await expect(displayMenuItems(page)).toContainText(["16:9", "9:16", "19.5:9", "9:19.5", "4:3", "3:4", "1:1", "Circle"]);
});

test("an empty catalogue leaves Fit as the only menu entry", async ({ page }) => {
  await openEditor(page);
  await openSettings(page, "Previews");
  await resetRatios(page);
  for (const row of await ratioRows(page)) await removeRow(page, row);
  await closeSettings(page);
  expect(await displayMenuItems(page)).toEqual([uiCopy.display.fit]);
  await expect(page.locator("[data-yunari-display-screen]")).toBeHidden();
});

test("the chooser does not resize when a preview is picked", async ({ page }) => {
  await openEditor(page);
  const size = await openNewDocument(page);
  await pickPreview(page, "19.5:9");
  expect(await chooserSize(page)).toBe(size);
});
```

Add the helpers in the same file using the existing bridge: `mediaGeometry` reads `[data-yunari-background-media]` and the camera; `panBy` drags the stage or calls `bridge.editor.viewport.panBy`; `chooseDisplay` opens `[data-yunari-zoom]` and clicks the radio labelled with the ratio; `openSettings` opens the gear and the tab.

- [ ] **Step 2: Run the browser test and verify it fails**

Run: `npm run test:e2e -- tests/e2e/editor-display.spec.ts`
Expected: FAIL — the menu has no `Circle`, the stage's image is not a gradient, the media rect stays pinned.

- [ ] **Step 3: Implement the pickers**

`display-switch.tsx`:

- Delete the `uiCopy.display.displays` lookup; `lensItem` uses `lens.id`.
- Subscribe to the catalogue: `useSyncExternalStore(subscribeLenses, previewCatalogueKey)`.
- `groups = displayLensGroups(orientation)`; omit a group with no lenses.
- Keep Fit as the first radio item. A catalogue with no lens renders Fit, the two camera items and no group.

`new-document-chooser.tsx`:

- Delete the display's Custom entry and the size rewrite in `pickDisplay`. Keep `CUSTOM` and `CUSTOM_READING`: the technical size selects still use them to read "not a preset".
- `display` state is `string | undefined`, initialized to `lensMatching(nearest)?.id`.
- `pickDisplay(id)` only sets the preview; `id === ""` means Fit (`undefined`).
- `displayOptions()` lists Fit, then the active groups, then no Custom entry; labels are lens ids.
- The technical controls are always visible (remove `hidden`); the free width/height pair is always visible; the size readout stays.
- `answer()` returns `{ size: chosen, display }`.

`ui-copy.ts`: delete `display.displays`.

- [ ] **Step 4: Run the browser test and verify it passes**

Run: `npm run test:e2e -- tests/e2e/editor-display.spec.ts`
Expected: PASS.

- [ ] **Step 5: Run the phase gate**

Run: `npm run gate`
Expected: exit 0. If a check fails, fix it before the close-out commit.

- [ ] **Step 6: Update `STATUS.md` and commit**

Replace the "Last completed change" bullets with 1–5 bullets for this plan (scene-anchored lens, shell stage, letterbox, guide frame, catalogue/settings). Keep the file to the five allowed sections and run `npm run status:check`.

```bash
git add STATUS.md
git commit -m "docs(status): close the preview lens and stage plan"
```

The controller merges the branch into `main` locally after this commit. The implementer does not merge or push.
