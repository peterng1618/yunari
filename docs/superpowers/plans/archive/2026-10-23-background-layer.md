# Background Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the background a persisted, selectable bottom layer with colour, media, bounds, fit, scale and position, rendered identically in the editor and the player.

**Architecture:** The background becomes a top-level envelope section (`background { color?, media? }`) while remaining a virtual layer: no Fabric object, no scene-JSON change. The layer tree appends one synthetic bottom row, the bridge holds a mutually exclusive background selection, the inspector gets a sibling column, and the existing DOM media layer is driven by one pure placement function shared with the glass sampler.

**Tech Stack:** TypeScript npm workspaces, React 19, Fabric 7.4, Vitest, Playwright, Biome.

**Spec:** [`docs/superpowers/specs/2026-10-23-background-layer-design.md`](../../specs/2026-10-23-background-layer-design.md)

## Global Constraints

- Run commands from `src/web/` unless a step names another directory. Run git from the repository root.
- Do not add a dependency.
- `schemaVersion` stays `2`. There is no converter, no fallback and no dual read of `artboard.background` / `artboard.backgroundMedia`.
- The background is never a Fabric object: it does not enter `canvas.getObjects()`, `serialiseScene`, object counts, or history.
- No transform handles; no canvas selection; the background row is select-only.
- Background colour is a palette token reference; the envelope validator refuses a literal; no free-colour picker.
- `exactOptionalPropertyTypes` and `noUncheckedIndexedAccess` are on: omit an optional property rather than assign `undefined`.
- Defaults are `fit: "cover"`, `scale: 1`, `offsetX: 0`, `offsetY: 0`; they must reproduce today's centred cover exactly.
- Ranges are refused, never clamped: `0.1 ≤ scale ≤ 10`, `-1 ≤ offset ≤ 1`.
- A file at 500 lines is a signal; 800 is a stop. No new generic utility folder.
- Conventional commits; stage explicit paths; never `git add -A`.
- A decision note must exist at `docs/decisions/0093-*` before the first write to a watchlisted path.
- Playwright runs use `--workers=1`. A `strictPort` failure means another run owns the port; do not kill it.

## Review Focus

1. **A theme with no `background` at all** — the row still exists, the renderer keeps its black fallback, and opening, selecting and saving do not crash. (Task 9, Task 5)
2. **A media source whose intrinsic size never arrives** — placement falls back to the box and never produces `NaN`. (Task 4, Task 5)
3. **Offsets that push the media fully outside the box** — the box shows the colour, and no negative-size draw or style is produced. (Task 4)
4. **A zero-size box** — a degenerate display rect produces zero rather than a division by zero. (Task 4, Task 5)
5. **An old-shape document** carrying `artboard.background` or `artboard.backgroundMedia` — refused with an unknown-key issue, with no partial paint. (Task 2)

---

## Task 1: Decision note 0093

The reuse gate refuses the first write to `renderer-core/src/theme/`, `scene-fabric/background-media.ts`, `scene-fabric/scene.ts`, `editor-shell/bridge.ts`, `editor-shell/layer-tree.ts` and `selection-inspector/view.ts` until a note claims them.

**Files:**
- Create: `docs/decisions/0093-the-background-is-a-virtual-layer.md`

**Interfaces:**
- Consumes: nothing.
- Produces: the note every later task relies on to pass the gate.

- [ ] **Step 1: Run the rung searches and record them**

Search, and write what was actually searched and found:

- Rung 1 — `background-media.ts`, `scene.ts`, `artboard-backdrop.ts`, `glass.ts`, `editor-shell.ts`, `layer-tree.ts`, `bridge.ts`, `selection-inspector/`.
- Rung 2 — `fabric` 7.4 (`FabricImage`, `FabricObject`, video support), `package.json` dependencies.
- Rung 3 — CSS `object-fit`, `object-position`, `transform`, `overflow: hidden`, `clip-path`; canvas `drawImage`; `HTMLVideoElement.requestVideoFrameCallback` and `loadedmetadata`.
- Rung 4 — real queries: "Fabric.js video background canvas", "Konva video layer background", "object-fit cover canvas drawImage", "design editor background layer bottom". Record what each project does.
- Rung 5 — comparison table of native DOM, Fabric object, and a new envelope layer.
- Rung 6 — probe: a 100×100 source in a 200×100 box, comparing `object-fit: cover/contain/fill` geometry with the computed placement rect and a `drawImage` destination. Record the measured values and whether they match.
- Rung 7 — build: the virtual layer, with the reason.

- [ ] **Step 2: Write the note**

Use `docs/decisions/README.md`'s template. The `Paths:` bullet must name every watchlisted path this work will touch, and the Decision section must record that `schemaVersion` stays 2 and an old document is refused rather than migrated.

- [ ] **Step 3: Verify the gate accepts the note**

Run from the repository root:

`echo '{"tool_input":{"file_path":"src/web/packages/scene-fabric/src/background-media.ts"}}' | node scripts/reuse-gate.mjs`

Expected: exit 0 with no refusal. The gate is a hook and reads the path from stdin JSON, not argv.

- [ ] **Step 4: Commit**

```bash
git add docs/decisions/0093-the-background-is-a-virtual-layer.md
git commit -m "docs(decisions): record the background as a virtual layer"
```

---

## Task 2: Envelope model, schema and validator

**Files:**
- Modify: `src/web/packages/renderer-core/src/theme/document.ts`
- Modify: `src/web/packages/renderer-core/src/theme/envelope-keys.ts`
- Modify: `schema/theme-document.schema.json`
- Modify: `src/web/packages/renderer-core/src/theme/envelope-semantics.ts`
- Modify: `src/web/packages/renderer-core/src/theme/fabric-envelope-validate.ts`
- Test: `src/web/packages/renderer-core/src/theme/envelope-semantics.test.ts`
- Test: `src/web/packages/renderer-core/src/theme/envelope-keys-disagreement.test.ts`
- Test: `src/web/packages/renderer-core/src/theme/fabric-envelope-schema-sync.test.ts`
- Test: `src/web/packages/renderer-core/src/theme/fabric-envelope-validate.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces, from `@yunari/renderer-core`:
  - `BACKGROUND_MEDIA_BOUNDS: readonly ["theme", "display"]`
  - `BackgroundMediaBounds`
  - `BACKGROUND_MEDIA_FITS: readonly ["cover", "contain", "fill"]`
  - `BackgroundMediaFit`
  - `MIN_BACKGROUND_SCALE = 0.1`, `MAX_BACKGROUND_SCALE = 10`
  - `MIN_BACKGROUND_OFFSET = -1`, `MAX_BACKGROUND_OFFSET = 1`
  - `BACKGROUND_MEDIA_DEFAULTS: { fit: "cover"; scale: 1; offsetX: 0; offsetY: 0 }`
  - `interface BackgroundMedia { assetId: string; bounds: BackgroundMediaBounds; fit?: BackgroundMediaFit; scale?: number; offsetX?: number; offsetY?: number }`
  - `interface Background { color?: StyleValue; media?: BackgroundMedia }`
  - `Artboard` without `background` or `backgroundMedia`.

- [ ] **Step 1: Write the failing tests**

In `envelope-semantics.test.ts`, replace the `background media` describe with:

```ts
describe("the background layer", () => {
  const withBackground = (background: unknown): Record<string, unknown> => ({
    ...baseEnvelope(),
    background,
  });

  it("accepts bounds, fit, scale and offsets", () => {
    expect(
      codes(
        withBackground({
          color: { ref: "palette.ink" },
          media: {
            assetId: "clip",
            bounds: "display",
            fit: "contain",
            scale: 1.4,
            offsetX: 0.25,
            offsetY: -0.1,
          },
        }),
      ),
    ).toEqual([]);
  });

  it("refuses an out-of-range scale and offsets", () => {
    for (const background of [
      { media: { assetId: "clip", bounds: "theme", scale: 0 } },
      { media: { assetId: "clip", bounds: "theme", scale: 11 } },
      { media: { assetId: "clip", bounds: "theme", offsetX: 2 } },
    ])
      expect(codes(withBackground(background))).toContain("out-of-range");
  });

  it("refuses an unknown key on the background and on its media", () => {
    expect(codes(withBackground({ rotation: 1 }))).toContain("unknown-field");
    expect(
      codes(
        withBackground({
          media: { assetId: "clip", bounds: "theme", rotation: 1 },
        }),
      ),
    ).toContain("unknown-field");
  });

  it("refuses the old artboard keys", () => {
    expect(
      codes({
        ...baseEnvelope(),
        artboard: {
          width: 10,
          height: 10,
          background: { ref: "palette.ink" },
        },
      }),
    ).toContain("unknown-field");
  });

  it("requires the media to resolve to an image, SVG or video", () => {
    expect(
      codes({
        ...baseEnvelope(),
        assets: [{ id: "clip", kind: "gif", path: "assets/a.gif" }],
        background: { media: { assetId: "clip", bounds: "theme" } },
      }),
    ).toContain("unresolved-asset-ref");
  });
});
```

In `envelope-keys-disagreement.test.ts`, add `background: [["$defs", "background"]]` to `ENVELOPE_BAGS` and extend the test document with a `background` bag so the root comparison covers it.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run packages/renderer-core/src/theme/envelope-semantics.test.ts packages/renderer-core/src/theme/envelope-keys-disagreement.test.ts`

Expected: FAIL — `background` is not a known root key and `codes(...)` reports `unknown-field`.

- [ ] **Step 3: Implement the model**

In `document.ts`, remove `background` and `backgroundMedia` from `Artboard`, replace `BACKGROUND_MEDIA_FITS` with the two sets and the range constants above, and add `BackgroundMedia` and `Background`. Keep the comment that explains the colour also paints the letterbox, rewritten for its new owner.

- [ ] **Step 4: Implement the key bags and the schema**

`envelope-keys.ts`:
- add `"background"` to `ENVELOPE_KEYS.envelope`;
- add `background: ["color", "media"]`;
- keep `backgroundMedia` with `["assetId", "bounds", "fit", "scale", "offsetX", "offsetY"]`.

`schema/theme-document.schema.json`:
- root `properties.background = { "$ref": "#/$defs/background" }`;
- `$defs.background`, `additionalProperties: false`, properties `color` (a `paletteReference`) and `media` (`$ref` the media def);
- `$defs.backgroundMedia`, required `["assetId", "bounds"]`, `bounds` enum `["theme", "display"]`, `fit` enum `["cover", "contain", "fill"]`, `scale` number `minimum: 0.1, maximum: 10`, offsets `minimum: -1, maximum: 1`;
- remove `background` and `backgroundMedia` from `$defs.artboard`.

- [ ] **Step 5: Implement validation**

`envelope-semantics.ts`: call `validateBackground(own, input["background"], input["assets"], globalKeys)` instead of the two artboard calls. It must check the `background` and `media` key bags with `envelopeKeysFor`, the `bounds` and `fit` enums, `finiteNumber` plus `out-of-range` for scale and offsets, the colour through the existing `validateStyleValue` at `/background/color`, and the asset through the existing rule at `/background/media/assetId`.

`fabric-envelope-validate.ts`: rename `artboardPaintReferences` to read `background["color"]` at `/background/color`; keep its palette check.

- [ ] **Step 6: Update the remaining renderer-core tests**

Run `npx vitest run packages/renderer-core/src/theme` and fix each failure by moving `artboard.background` to `background.color` and `artboard.backgroundMedia` to `background.media`, converting the old `fit: "theme" | "display"` to `bounds`. The test that refused a `scale` key now expects it accepted; replace its unknown key with `rotation`.

Expected: every renderer-core theme test passes.

- [ ] **Step 7: Commit**

```bash
git add schema/theme-document.schema.json src/web/packages/renderer-core/src/theme
git commit -m "feat(theme): move the background to a top-level layer"
```

---

## Task 3: Consumer and fixture sweep

**Files:**
- Modify: `src/web/packages/renderer-core/src/scene/plan.ts`
- Modify: `src/web/packages/editor/src/editor-document.ts`
- Modify: `src/web/packages/editor/src/palette-manager/index.ts`
- Modify: `src/web/packages/editor/src/new-fabric-theme.ts`
- Modify every file `rg` reports, including tests.
- Test: `src/web/packages/renderer-core/src/scene/plan.test.ts`
- Test: `src/web/packages/editor/src/editor-document.test.ts` (or the file that owns `holdsAsset`)

**Interfaces:**
- Consumes: `Background`, `BackgroundMedia`, `Artboard` from Task 2.
- Produces:
  - `planArtboard(artboard: Artboard, background: Background | undefined, globals: Globals, issues: PlanIssue[]): ScenePlan["artboard"]`
  - `reassignPaletteToken(canvas, background: Background | undefined, palette, id, replacement): { from: string; to: string; background: Background | undefined; palette: FabricPalette }`

- [ ] **Step 1: Write the failing tests**

In `plan.test.ts`, assert a resolved colour:

```ts
it("resolves the background colour through the palette", () => {
  expect(
    planArtboard(
      { width: 100, height: 100 },
      { color: { ref: "palette.ink" } },
      { palette: { ink: { name: "Ink", value: { kind: "solid", color: "#101216" } } } },
      [],
    ).background,
  ).toEqual({ kind: "solid", color: "#101216" });
});
```

In the palette-manager test that covers `reassignPaletteToken`, assert that a `background.color` reference to the deleted token is rewritten to the replacement.

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run packages/renderer-core/src/scene/plan.test.ts packages/editor/src/palette-manager`

Expected: FAIL — the new argument list does not compile and the old shape is read.

- [ ] **Step 3: Sweep the old shape**

Run from `src/web`:

`rg -n "backgroundMedia|artboard\.background" packages tests`

For every hit:
- a document fixture: `artboard: { ..., background: X }` becomes `background: { color: X }`;
- `artboard: { ..., backgroundMedia: M }` becomes `background: { media: M }`;
- `M.fit: "theme" | "display"` becomes `M.bounds`, and the new `fit` is absent unless the test is about object-fit;
- production code reads `background.color` / `background.media`.

`planArtboard` and every caller (the player's `envelopePlan`, editor boot, tests) take the extra `background` argument.

- [ ] **Step 4: Update the document and starter**

`editor-document.ts`:
- `holdsAsset` reads `this.#envelope.background?.media?.assetId`;
- `deletePalette` passes `this.#envelope.background`, writes the returned `background` into the envelope, and leaves the shell repaint to Task 6 (which adds the setter); it must not write any artboard background.

`new-fabric-theme.ts`: the starter writes `background: { media: { assetId, bounds: "theme" } }`.

`palette-manager/index.ts`: `reassignPaletteToken` reads and rewrites `background.color`, not `artboard.background`.

- [ ] **Step 5: Run the package suites**

Run: `npx vitest run packages/renderer-core packages/editor/src/palette-manager packages/editor/src/new-fabric-theme.test.ts packages/editor/src/editor-document.test.ts`

Expected: PASS. Workspace typecheck may still report the shell and renderer call sites that Tasks 5 and 6 change; record them and do not paper over them.

- [ ] **Step 6: Commit**

```bash
git add schema src/web/packages/renderer-core src/web/packages/editor
git commit -m "refactor(theme): read the background from its new owner"
```

---

## Task 4: Pure placement geometry

**Files:**
- Modify: `src/web/packages/scene-fabric/src/background-media.ts`
- Test: `src/web/packages/scene-fabric/src/background-media.placement.test.ts`

**Interfaces:**
- Consumes: `BackgroundMediaFit`, `BACKGROUND_MEDIA_DEFAULTS` from Task 2; the existing `MediaBox` from `background-media.ts`.
- Produces:

```ts
export interface PlacementInput {
  readonly box: { readonly width: number; readonly height: number };
  readonly source: { readonly width: number; readonly height: number } | undefined;
  readonly fit: BackgroundMediaFit;
  readonly scale: number;
  readonly offsetX: number;
  readonly offsetY: number;
}
export function placement(input: PlacementInput): MediaBox;
```

- [ ] **Step 1: Write the failing tests**

`background-media.placement.test.ts` (node environment, no DOM):

```ts
const BOX = { width: 200, height: 100 };
const SOURCE = { width: 100, height: 100 };

it("covers: max scale, cropped, centred", () => {
  expect(placement({ box: BOX, source: SOURCE, fit: "cover", scale: 1, offsetX: 0, offsetY: 0 }))
    .toEqual({ left: 0, top: -50, width: 200, height: 200 });
});

it("contains: min scale, letterboxed, centred", () => {
  expect(placement({ box: BOX, source: SOURCE, fit: "contain", scale: 1, offsetX: 0, offsetY: 0 }))
    .toEqual({ left: 50, top: 0, width: 100, height: 100 });
});

it("fills: both axes stretched", () => {
  expect(placement({ box: BOX, source: SOURCE, fit: "fill", scale: 1, offsetX: 0, offsetY: 0 }))
    .toEqual({ left: 0, top: 0, width: 200, height: 100 });
});

it("scale multiplies about the box centre", () => {
  expect(placement({ box: BOX, source: SOURCE, fit: "cover", scale: 1.5, offsetX: 0, offsetY: 0 }))
    .toEqual({ left: -50, top: -100, width: 300, height: 300 });
});

it("offset shifts by a fraction of the box", () => {
  expect(placement({ box: BOX, source: SOURCE, fit: "cover", scale: 1.5, offsetX: 0.25, offsetY: 0 }))
    .toEqual({ left: 0, top: -100, width: 300, height: 300 });
});

it("falls back to the box before the source has a size", () => {
  expect(placement({ box: BOX, source: undefined, fit: "contain", scale: 1, offsetX: 0, offsetY: 0 }))
    .toEqual({ left: 0, top: 0, width: 200, height: 100 });
});

it("refuses to produce NaN or negative sizes", () => {
  const zero = placement({ box: { width: 0, height: 0 }, source: SOURCE, fit: "cover", scale: 1, offsetX: 0, offsetY: 0 });
  for (const value of Object.values(zero)) expect(Number.isFinite(value)).toBe(true);
  const far = placement({ box: BOX, source: SOURCE, fit: "contain", scale: 1, offsetX: 1, offsetY: 1 });
  expect(far.width).toBeGreaterThan(0);
  expect(far.height).toBeGreaterThan(0);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run packages/scene-fabric/src/background-media.placement.test.ts`

Expected: FAIL — `placement` is not exported.

- [ ] **Step 3: Implement `placement`**

One function: pick the scale(s) from `fit`; when `source` is undefined use `box` as the base rect; centre the base rect; multiply its dimensions by `scale`; shift the centre by `offset × box`; return finite, non-negative dimensions (a zero box returns zeros).

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run packages/scene-fabric/src/background-media.placement.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/web/packages/scene-fabric/src/background-media.ts src/web/packages/scene-fabric/src/background-media.placement.test.ts
git commit -m "feat(scene): place background media with bounds, fit and transform"
```

---

## Task 5: Media handle placement and remount guard

**Files:**
- Modify: `src/web/packages/scene-fabric/src/background-media.ts`
- Test: `src/web/packages/scene-fabric/src/background-media.dom.test.ts`

**Interfaces:**
- Consumes: `placement` from Task 4; `Background` from Task 2.
- Produces:

```ts
export interface BackgroundMediaOptions {
  readonly host: HTMLElement;
  readonly background: Background | undefined;
  readonly artboard: { readonly width: number; readonly height: number };
  readonly assets: readonly AssetReference[] | undefined;
  readonly resolveAsset: (assetId: string) => BackgroundMediaSource | undefined;
  readonly onMediaError?: (message: string) => void;
  readonly onFrame?: () => void;
}
export interface BackgroundMediaHandle {
  setBackground(background: Background | undefined): void;
  setArtboardSize(size: { readonly width: number; readonly height: number }): void;
  setBounds(bounds: MediaBounds): void;
  backdrop(): BackdropMedia | undefined;
  destroy(): void;
}
```

- [ ] **Step 1: Write the failing DOM tests**

In `background-media.dom.test.ts` add:

```ts
it("keeps the same video element when only the transform changes", () => {
  // mount with background.media { assetId: "loop", bounds: "theme" }
  const before = host.querySelector("video");
  handle.setBackground({ media: { assetId: "loop", bounds: "theme", scale: 1.5 } });
  expect(host.querySelector("video")).toBe(before);
});

it("replaces the element when the asset changes", () => {
  const before = host.querySelector("video");
  handle.setBackground({ media: { assetId: "other", bounds: "theme" } });
  expect(host.querySelector("video")).not.toBe(before);
});

it("sizes the child from the placement rect", () => {
  // 200×100 box, 100×100 source, cover, scale 1.5, offsetX 0.25
  expect(child.style.left).toBe("0px");
  expect(child.style.top).toBe("-100px");
  expect(child.style.width).toBe("300px");
  expect(child.style.height).toBe("300px");
});

it("clips at the display box when bounds is display", () => {
  // setBounds artboard 100×100 at (50, 50), display 400×300 at (0, 0)
  // expect the layer's left/top/width/height to be the display box
});
```

Use `Object.defineProperty(element, "videoWidth", { value: 100 })` and the same for `videoHeight`, then call `handle.setBounds` and `handle.setBackground` to drive placement. jsdom has no layout, so assert inline styles rather than rects.

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run packages/scene-fabric/src/background-media.dom.test.ts`

Expected: FAIL — `setBackground` and `setArtboardSize` do not exist.

- [ ] **Step 3: Implement the handle**

- The layer div is sized from `bounds[media.bounds]` with `overflow: hidden` (already).
- The child is `position: absolute`, `display: block`, and `left/top/width/height` come from `placement` with `box` = the layer's box size.
- `setBackground` compares `media.assetId` with the mounted one: on a change (or removal) tear down and remount; otherwise update the stored background and call `place()`.
- Re-run `place()` on `load` (image) and `loadedmetadata` (video), because the intrinsic size arrives after the first placement.
- `setArtboardSize` stores the size used by `backdrop()`'s artboard-unit conversion and re-places.
- Remove `object-fit: cover`.

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run packages/scene-fabric/src/background-media.dom.test.ts packages/scene-fabric/src/background-media.placement.test.ts`

Expected: PASS, including the pre-existing media tests updated to the new option shape.

- [ ] **Step 5: Commit**

```bash
git add src/web/packages/scene-fabric/src/background-media.ts src/web/packages/scene-fabric/src/background-media.dom.test.ts
git commit -m "fix(scene): re-place background media without restarting playback"
```

---

## Task 6: Scene, editor shell and player wiring

**Files:**
- Modify: `src/web/packages/scene-fabric/src/scene.ts`
- Modify: `src/web/packages/editor/src/editor-shell.ts`
- Modify: `src/web/packages/editor/src/editor-main.ts` (only if the shell cannot derive the background from its envelope)
- Modify: `src/web/packages/player/src/main.ts`
- Test: `src/web/packages/editor/src/editor-shell.dom.test.ts`
- Test: `src/web/packages/player/src/artboard-clip.dom.test.ts`
- Test: `src/web/packages/player/src/main.dom.test.ts`

**Interfaces:**
- Consumes: the handle from Task 5; `Background` from Task 2.
- Produces:
  - `SceneArtboard = Pick<Artboard, "width" | "height" | "contentFit">`
  - `FabricSceneOptions.background?: Background`
  - `FabricSceneHandle.updateBackground(background: Background | undefined): void`
  - `EditorShell.setBackground(background: Background | undefined): void`

- [ ] **Step 1: Write the failing tests**

In `editor-shell.dom.test.ts`:

```ts
it("paints the background colour on the host and sizes the media layer", async () => {
  // mount with envelope.background = { color: { value: "#112233" }, media: { assetId: "loop", bounds: "theme" } }
  expect(host.style.background).toBe("rgb(17, 34, 51)");
  expect(host.querySelector("[data-yunari-background-media]")).toBeTruthy();
});

it("setBackground re-paints without remounting the scene", async () => {
  const before = host.querySelector("canvas");
  shell.setBackground({ color: { value: "#445566" } });
  expect(host.querySelector("canvas")).toBe(before);
  expect(host.style.background).toBe("rgb(68, 85, 102)");
});
```

In `artboard-clip.dom.test.ts`, update the envelope and assert the clip still survives revival with a `background` bag present.

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run packages/editor/src/editor-shell.dom.test.ts packages/player/src/artboard-clip.dom.test.ts`

Expected: FAIL — the shell has no `setBackground` and the media mount still reads an artboard.

- [ ] **Step 3: Implement the scene**

`scene.ts`:
- narrow `SceneArtboard`;
- add `background` to `FabricSceneOptions` and `updateBackground` to the handle;
- pass `background` and the artboard size to `mountBackgroundMedia`;
- `updateBackground` calls `media?.setBackground(background)` and re-renders;
- `updateArtboard` calls `media?.setArtboardSize` and re-fits.

`player/src/main.ts`: pass `background: theme.background` beside `artboard`.

`player/src/hosted-plan.ts` (or the module that builds the plan): pass `theme.background` to `planArtboard`.

- [ ] **Step 4: Implement the editor shell**

`editor-shell.ts`:
- `let currentBackground = envelope?.background;`
- `applyArtboardPaint(editor, host, artboard, background, globals, memo)` reads `background.color` and decides the plate with `background?.media === undefined`;
- `mountMedia` passes `{ background: currentBackground, artboard: currentArtboard, ... }`;
- `setArtboard` calls `media?.setArtboardSize(currentArtboard)` then `placeMedia()`; it no longer calls `media.update`;
- add `setBackground(nextBackground)` to the returned object and the interface: store it, `paintArtboard()`, `media?.setBackground(currentBackground)`, `placeMedia()`;
- `setBackgroundMedia` still remounts (asset declarations changed).

Then close the loop left by Task 3: `EditorDocument.deletePalette` calls `shell.setBackground(background)` after writing the envelope, so a palette deletion repaints the new colour.

- [ ] **Step 5: Run the focused suites**

Run: `npx vitest run packages/scene-fabric packages/editor/src/editor-shell.dom.test.ts packages/player`

Expected: PASS.

- [ ] **Step 6: Typecheck the workspace**

Run: `npm run typecheck`

Expected: exit 0. Fix any remaining call site that still passes `backgroundMedia` on an artboard.

- [ ] **Step 7: Commit**

```bash
git add src/web/packages/scene-fabric/src/scene.ts src/web/packages/editor/src/editor-shell.ts src/web/packages/editor/src/editor-main.ts src/web/packages/player/src
git commit -m "feat(render): drive the background layer from its own state"
```

---

## Task 7: Glass sampling follows the placement

**Files:**
- Modify: `src/web/packages/scene-fabric/src/background-media.ts`
- Test: `src/web/packages/scene-fabric/src/background-media.dom.test.ts`

**Interfaces:**
- Consumes: `placement` from Task 4; the handle from Task 5.
- Produces: no new public surface; `backdrop().paint` draws the placed rect.

- [ ] **Step 1: Write the failing test**

```ts
it("draws the placed rect, not a cover crop, when the media is contained", () => {
  const calls: unknown[][] = [];
  const ctx = { drawImage: (...args: unknown[]) => calls.push(args) } as unknown as CanvasRenderingContext2D;
  // 200×100 device rect, 100×100 source, contain, scale 1, offsetX 0.25
  const painted = handle.backdrop()!.paint(
    ctx,
    { left: 0, top: 0, width: 200, height: 100 },
    { left: 0, top: 0, width: 200, height: 100 },
  );
  expect(painted).toBe(true);
  // source full 0,0,100,100 → destination 100,25,100,100
  expect(calls[0]?.slice(-4)).toEqual([100, 25, 100, 100]);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run packages/scene-fabric/src/background-media.dom.test.ts -t "placed rect"`

Expected: FAIL — the old cover crop draws a cropped source.

- [ ] **Step 3: Implement the paint**

Compute `placement` with the box being the layer's own `rect` (the `device` rect is that same box scaled by the caller — `glass.ts` `backdropFor` passes `media.rect` through the plane), map its edges into the context by `device.width / rect.width` and `device.height / rect.height`, subtract `region.left`/`region.top`, and draw the full source into that destination. Delete `mediaDrawArgs` (and its barrel export) and update the tests that named it.

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run packages/scene-fabric`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/web/packages/scene-fabric/src/background-media.ts src/web/packages/scene-fabric/src/background-media.dom.test.ts
git commit -m "fix(glass): sample the background's placed rect"
```

---

## Task 8: Player browser evidence

**Files:**
- Modify: `src/web/tests/e2e/host-theme.ts` (or the fixture builder it exports)
- Create: `src/web/tests/e2e/background-layer.spec.ts`
- Modify: `docs/evidence/screenshots/README.md` only if a registered capture action changes

**Interfaces:**
- Consumes: the player rendering from Task 6, glass from Task 7.
- Produces: browser proof of the visible transform and the clip.

- [ ] **Step 1: Write the failing browser test**

Build a theme with an image background (`bounds: "theme"`, `fit: "contain"`, `scale: 1.4`, `offsetX: 0.25`) and a glass panel over it. Assert:

- the layer's client rect equals the artboard screen rect;
- the media child's client rect equals the placement rect within 1px;
- where the media does not cover, a sampled screenshot pixel equals the background colour;
- the media is clipped: no child pixel appears outside the layer's rect.

Take the screenshot as evidence, not as a golden file.

- [ ] **Step 2: Run to verify failure**

Rebuild what the test serves, then run:

`npm run build:player && npx playwright test tests/e2e/background-layer.spec.ts --workers=1`

Expected: FAIL — no background layer is rendered.

- [ ] **Step 3: Make it pass**

If it fails for a product reason, fix the owning task rather than the assertion. If it fails because the fixture serves an old bundle, rebuild.

- [ ] **Step 4: Run again**

Run: `npx playwright test tests/e2e/background-layer.spec.ts --workers=1`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/web/tests/e2e
git commit -m "test(player): prove the background transform and its clip"
```

---

## Task 9: Layer row and selection

**Files:**
- Modify: `src/web/packages/editor/src/editor-shell/layer-tree.ts`
- Modify: `src/web/packages/editor/src/editor-shell/bridge.ts`
- Modify: `src/web/packages/editor/src/panes/composition/composition-pane.tsx`
- Modify: `src/web/packages/editor/src/panes/composition/kind-mark.tsx`
- Modify: `src/web/packages/editor/src/editor-shell/icons.ts`
- Modify: `src/web/packages/editor/src/ui-copy.ts`
- Test: `src/web/packages/editor/src/editor-shell/layer-tree.test.ts`
- Test: `src/web/packages/editor/src/editor-shell/bridge.dom.test.ts`
- Test: `src/web/packages/editor/src/editor-shell/layer-panel.dom.test.tsx`

**Interfaces:**
- Consumes: nothing from earlier tasks except the document identity.
- Produces:
  - `BACKGROUND_LAYER_ID = "$background"`
  - `backgroundRow(input: { readonly selected: boolean }): LayerRow`
  - `EditorShellBridge.backgroundSelected(): boolean`
  - `EditorShellSnapshot.activeKind` includes `"background"`

- [ ] **Step 1: Write the failing tests**

`layer-tree.test.ts`:

```ts
it("places the background last and below every object", () => {
  const rows = projectLayers({ root: [rect()], selected: [], expanded: new Set() });
  const withBackground = [...rows, backgroundRow({ selected: false })];
  expect(withBackground.at(-1)?.id).toBe("$background");
  expect(withBackground.at(-1)?.kind).toBe("background");
});

it("keeps the background row when the theme has no background at all", () => {
  expect(backgroundRow({ selected: false }).visible).toBe(true);
});
```

`bridge.dom.test.ts`:

```ts
it("selecting the background clears the Fabric selection", () => {
  bridge.selectLayer("$background");
  expect(canvas.getActiveObject()).toBeUndefined();
  expect(bridge.backgroundSelected()).toBe(true);
  expect(bridge.layers().at(-1)?.selected).toBe(true);
});

it("any object selection clears the background", () => {
  bridge.selectLayer("$background");
  bridge.selectLayer(rectId);
  expect(bridge.backgroundSelected()).toBe(false);
});

it("cannot be mixed into a multi-selection", () => {
  bridge.selectLayers([rectId, "$background"]);
  expect(bridge.backgroundSelected()).toBe(true);
  expect(canvas.getActiveObject()).toBeUndefined();
});
```

`layer-panel.dom.test.tsx`:

```ts
it("does not let the background row start a drag or open a rename", () => {
  const row = container.querySelector('[data-yunari-layer="$background"]')!;
  expect(row.getAttribute("draggable")).toBe("false");
  fireEvent.doubleClick(row);
  expect(row.querySelector("input")).toBeNull();
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run packages/editor/src/editor-shell/layer-tree.test.ts packages/editor/src/editor-shell/bridge.dom.test.ts packages/editor/src/editor-shell/layer-panel.dom.test.tsx`

Expected: FAIL — `backgroundRow`, `$background` and `backgroundSelected` do not exist.

- [ ] **Step 3: Implement the projection row**

`layer-tree.ts`: add the id constant, the `background` arms to `LayerKind`, `LayerMark` and `LayerRole`, and `backgroundRow`. Every switch over `LayerKind` gains the arm. The name is `uiCopy.panels.layerKinds.background`; the role word is `uiCopy.panels.layerRoles.background`; `icons.ts` gains `BACKGROUND_GLYPH`; `kind-mark.tsx` draws it.

- [ ] **Step 4: Implement selection**

`bridge.ts`:
- `let backgroundSelected = false;`
- the three selection events call `settleSelection()` which clears the flag and notifies; the other events still call `notify`;
- `layers()` appends `backgroundRow({ selected: backgroundSelected })`;
- `selectLayers(ids)`: if any id is `$background`, `canvas.discardActiveObject()`, set the flag, notify and return; otherwise clear the flag;
- `selectLayer` keeps routing through `selectLayers`;
- `snapshot()` reports `activeKind: "background"`, `selectedCount: 1`, `locked: false`, `target()` still `undefined`;
- add `backgroundSelected()` to the interface and returned object.

`composition-pane.tsx`: for `row.kind === "background"` — `draggable={false}`, no drag handlers, no double-click/F2 rename, no entry or affordance controls, Space selects, and `data-context` is never false.

- [ ] **Step 5: Run to verify pass**

Run: `npx vitest run packages/editor/src/editor-shell/layer-tree.test.ts packages/editor/src/editor-shell/bridge.dom.test.ts packages/editor/src/editor-shell/layer-panel.dom.test.tsx`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/web/packages/editor/src/editor-shell src/web/packages/editor/src/panes/composition src/web/packages/editor/src/ui-copy.ts
git commit -m "feat(editor): list and select the background layer"
```

---

## Task 10: Background inspector column and percent display

**Files:**
- Create: `src/web/packages/editor/src/selection-inspector/background-column.ts`
- Modify: `src/web/packages/editor/src/selection-inspector/view.ts`
- Modify: `src/web/packages/editor/src/selection-inspector/per-kind-column.ts`
- Modify: `src/web/packages/editor/src/selection-inspector/column.tsx`
- Modify: `src/web/packages/editor/src/editor-shell/icons.ts`
- Test: `src/web/packages/editor/src/selection-inspector/background-column.test.ts`
- Test: `src/web/packages/editor/src/selection-inspector/column.dom.test.tsx` (or the existing column test)

**Interfaces:**
- Consumes: `Background`, `BACKGROUND_MEDIA_BOUNDS`, `BACKGROUND_MEDIA_FITS`, the range constants and `BACKGROUND_MEDIA_DEFAULTS` from Task 2.
- Produces:
  - `SelectionKind` includes `"background"`; `KIND_WORD` and `KIND_GLYPHS` cover it.
  - `percent?: boolean` on the number `FieldView` arm and on `PairHalfView`.
  - `backgroundColumn(input: { background: Background | undefined; assets: readonly AssetReference[]; globals: FabricGlobals | undefined }): readonly ColumnSectionView[]`
  - the dispatchable field ids `background.color`, `background.media`, `background.bounds`, `background.fit`, `background.scale`, `background.offsetX`, `background.offsetY`; the offsets are a pair row whose halves carry the last two ids.

- [ ] **Step 1: Write the failing tests**

`background-column.test.ts`:

```ts
it("asks Content for colour and media, and Position for bounds, fit, scale and offsets", () => {
  const sections = backgroundColumn({ background: undefined, assets: [], globals: undefined });
  expect(sections.map((section) => section.id)).toEqual(["content", "position"]);
  expect(sections[0]?.fields.map((field) => field.id)).toEqual([
    "background.color",
    "background.media",
  ]);
  expect(sections[1]?.fields.map((field) => field.id)).toEqual([
    "background.bounds",
    "background.fit",
    "background.scale",
    "background.offsetX-offsetY",
  ]);
  expect(
    sections[1]?.fields.find((field) => field.id === "background.offsetX-offsetY"),
  ).toMatchObject({
    control: "pair",
    halves: [
      { id: "background.offsetX" },
      { id: "background.offsetY" },
    ],
  });
});

it("shows scale and offsets as percentages", () => {
  const sections = backgroundColumn({
    background: { media: { assetId: "a", bounds: "theme", scale: 1.4, offsetX: 0.25 } },
    assets: [],
    globals: undefined,
  });
  const scale = sections[1]?.fields.find((field) => field.id === "background.scale");
  expect(scale).toMatchObject({ control: "number", value: 1.4, percent: true });
});
```

In the column DOM test:

```ts
it("renders 1.4 as 140% and commits 0.25 for an entered 25", () => {
  // mount the Position section with a percent number field
  // expect the input's value to be "140"
  // type "25" in an offset half and expect the commit port to receive 0.25
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run packages/editor/src/selection-inspector/background-column.test.ts`

Expected: FAIL — the module does not exist.

- [ ] **Step 3: Implement the column**

Content: a `swatch` for `background.color` (`value` is the stored ref or `""`, `colour` is the resolved token or `"transparent"`, options are `paletteTokenOptions` plus the blank reading) and a `select` for `background.media` (blank plus `image`/`svg`/`video` assets).

Position: `select` for bounds (default `"theme"`), `select` for fit (default `"cover"`), `number` for scale (`value` stored, `percent: true`, `min: 10`, `max: 1000`), and a `pair` row `background.offsetX-offsetY` whose halves are `background.offsetX` and `background.offsetY`, both `percent: true`. `PairHalfView` has no bounds of its own, so the write boundary refuses a fraction outside `-1..1`.

- [ ] **Step 4: Implement percent rendering and the kind**

`view.ts`: add `"background"` to `SELECTION_KINDS` and `KIND_WORD`; add `percent?: boolean` to the number arm and `PairHalfView`; add `KIND_GLYPHS.background` in `icons.ts`.

`column.tsx`: for a `percent` field or half, display `value * 100` and commit `entered / 100`; the boundary still receives the fraction.

`per-kind-column.ts`: the selection kind union grows; `selectionKindOf` never returns `"background"`, and the `KIND_WORD` record makes that totality explicit.

- [ ] **Step 5: Run to verify pass**

Run: `npx vitest run packages/editor/src/selection-inspector`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/web/packages/editor/src/selection-inspector src/web/packages/editor/src/editor-shell/icons.ts
git commit -m "feat(inspector): describe the background layer"
```

---

## Task 11: Inspector wiring, document setter and Document-pane cleanup

**Files:**
- Modify: `src/web/packages/editor/src/selection-inspector/index.ts`
- Modify: `src/web/packages/editor/src/editor-session.ts`
- Modify: `src/web/packages/editor/src/editor-document.ts`
- Modify: `src/web/packages/editor/src/artboard-panel.ts`
- Modify: `src/web/packages/editor/src/panes/document/artboard-fields.tsx`
- Modify: `src/web/packages/editor/src/panes/document/document-pane.tsx`
- Test: `src/web/packages/editor/src/selection-inspector/index.dom.test.ts`
- Test: `src/web/packages/editor/src/panes/document/artboard-fields.dom.test.tsx`
- Test: `src/web/packages/editor/src/artboard-panel.dom.test.ts`

**Interfaces:**
- Consumes: Task 9's `backgroundSelected()`, Task 10's `backgroundColumn`, Task 6's `EditorShell.setBackground`, Task 2's `Background`.
- Produces: `EditorDocument.setBackground(background: Background | undefined): void`.

- [ ] **Step 1: Write the failing tests**

`index.dom.test.ts`:

```ts
it("describes the background when the bridge says it is selected", () => {
  // background selected, background = { media: { assetId: "loop", bounds: "theme" } }
  expect(column.textContent).toContain("Background");
  expect(root.querySelector('[data-yunari-background]')).toBeTruthy();
});

it("writes a background edit through the document setter and no Fabric field", () => {
  // commit field id "background.scale" with 1.4
  expect(onBackgroundChange).toHaveBeenCalledWith(
    expect.objectContaining({ media: expect.objectContaining({ scale: 1.4 }) }),
  );
  expect(editor.historyManager.saveState).not.toHaveBeenCalled();
});
```

`artboard-fields.dom.test.tsx`: assert `data-yunari-artboard-background`, `data-yunari-background-asset` and `data-yunari-background-media-fit` are gone, and the size controls remain.

`artboard-panel.dom.test.ts`: assert `setGlobals` and `setAssets` are gone from the panel's contract.

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run packages/editor/src/selection-inspector/index.dom.test.ts packages/editor/src/panes/document/artboard-fields.dom.test.tsx packages/editor/src/artboard-panel.dom.test.ts`

Expected: FAIL — the background selection renders "Nothing selected" and the Document pane still has the controls.

- [ ] **Step 3: Branch the inspector**

`selection-inspector/index.ts` gains four options: `backgroundSelected?: () => boolean`, `background?: () => Background | undefined`, `assets?: () => readonly AssetReference[]`, `onBackgroundChange?: (next: Background | undefined) => void`.

In `render()`:
- when `backgroundSelected()` is true, publish a view built from `backgroundColumn(...)` with subject `{ name: uiCopy.panels.layerKinds.background, kind: "background", key: undefined }`, `locked: false`, and an edits port whose `commit` switches on the seven background field ids, writes a whole new `Background` through `onBackgroundChange`, increments the revision and re-renders;
- `preview`/`cancelPreview` are no-ops for background fields (the controls commit on change);
- otherwise the existing Fabric path runs unchanged.

The dispatcher must route by id prefix, so a background field id can never reach `writeField`.

- [ ] **Step 4: Add the document setter and wire the session**

`editor-document.ts`:

```ts
setBackground(background: Background | undefined): void {
  // omit the key rather than set undefined, for exactOptionalPropertyTypes
  // write the envelope, call the shell's setBackground, and mark dirty
}
```

`editor-session.ts`: pass the four inspector options from the shell and the live document; `background()` pulls `this.#document.envelope.background` so it cannot go stale.

`deletePalette`: write the `background` returned by `reassignPaletteToken` and call `shell.setBackground`.

- [ ] **Step 5: Remove the Document-pane controls**

`artboard-fields.tsx`: delete the colour, media and fit selects and their commit functions; drop `assets` and `globals` props. `document-pane.tsx` and `artboard-panel.ts` drop those props and the `setGlobals`/`setAssets` methods; remove their two callers in `editor-document.ts` and `editor-session.ts`. Keep the size, presets and note.

- [ ] **Step 6: Run to verify pass**

Run: `npx vitest run packages/editor/src/selection-inspector packages/editor/src/panes/document packages/editor/src/artboard-panel.dom.test.ts packages/editor/src/editor-shell.dom.test.ts`

Expected: PASS.

- [ ] **Step 7: Typecheck and commit**

Run: `npm run typecheck`; expected exit 0.

```bash
git add src/web/packages/editor/src
git commit -m "feat(inspector): write the background layer from its column"
```

---

## Task 12: Close-out — full gate, docs, evidence, status

**Files:**
- Modify: `STATUS.md`
- Modify: `docs/architecture/ownership.md` (the artboard/media authoring rows)
- Modify: `DESIGN.md` only if it names the Document pane as the owner of colour/media
- Modify: `docs/evidence/screenshots/README.md` only if a registered capture action changed

**Interfaces:**
- Consumes: every earlier task.
- Produces: a green gate and current documentation.

- [ ] **Step 1: Update the owners**

`docs/architecture/ownership.md`: the artboard row keeps board size and presets; add the background layer's owner (`panes/document` for the artboard, `selection-inspector/background-column.ts` for colour/media/fit/transform); keep `scene-fabric/src/background-media.ts` as the renderer owner. Search `DESIGN.md` for "background media" and update only contradictory current text.

- [ ] **Step 2: Run the full gate and record its exit code**

From `src/web`:

`npm run gate > /c/tmp/yunari-background-gate.log 2>&1; echo "exit=$?"`

Expected: `exit=0`. Read the log on failure. Do not pipe the gate into `tail`; the pipeline would report `tail`'s status.

- [ ] **Step 3: Run the browser suites that cover the change**

Rebuild, then run the background spec and the player spec with one worker:

`npm run build:player && npx playwright test tests/e2e/background-layer.spec.ts tests/e2e/host-player.spec.ts --workers=1`

Expected: PASS.

- [ ] **Step 4: Update STATUS**

Set the objective to this plan, list the active work as its phases, summarize this commit in "Last completed change" (at most five bullets, one line each), and move the R2 store plan to queued. Put the catalogue smoke-theme reseed under blockers/unverified.

Run: `npm run status:check`; expected exit 0.

- [ ] **Step 5: Commit**

```bash
git add STATUS.md docs/architecture/ownership.md docs/evidence/screenshots/README.md DESIGN.md
git commit -m "docs: close the background-layer plan"
```

If a docs file was unchanged, omit it from `git add`.

---

## Self-review notes

- Spec coverage: persisted model (Task 2), validation (Task 2), consumer sweep (Task 3), placement (Task 4), handle lifecycle (Task 5), scene/editor/player wiring (Task 6), glass (Task 7), visible evidence (Task 8), row and selection (Task 9), inspector column and percent (Task 10), wiring and Document-pane cleanup (Task 11), gate and docs (Task 12). Every spec section maps to a task.
- The decision note (Task 1) precedes every watchlisted write.
- Types used across tasks: `Background`/`BackgroundMedia` (Task 2), `placement` (Task 4), `setBackground`/`setArtboardSize` (Task 5), `EditorShell.setBackground` (Task 6), `BACKGROUND_LAYER_ID`/`backgroundRow`/`backgroundSelected()` (Task 9), `backgroundColumn` (Task 10), `EditorDocument.setBackground` (Task 11).
