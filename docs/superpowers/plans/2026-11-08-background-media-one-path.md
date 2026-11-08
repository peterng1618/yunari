# Background Media One-Path Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One pure resolver owns background-media geometry; every DOM, glass, transcode and panel-bake surface reads it.

**Architecture:** `renderer-core`'s `resolveBackgroundComposition` gains the authored geometry and returns the media area, masks, and the media's cover/visible/source-window rects. `scene-fabric`, both host panel encoders, the page-clip transcode and the player consume that one result. The four existing geometry implementations are deleted.

**Tech Stack:** TypeScript, Vitest, Fabric.js (scene-fabric only), ffmpeg (`ffmpeg-static`) for panel bakes.

**Spec:** `docs/superpowers/specs/2026-11-08-background-media-one-path-design.md`

## Global Constraints

- Run every npm command from `src/web/`. Node `>=22`.
- `npm run gate` must exit 0 and must not need the network. Record its exit code without a pipe.
- `renderer-core` imports no Fabric and no DOM.
- No schema, validator, editor-control or stored-value change. Offsets stay ±5 and saturate at the flush position.
- Delete superseded geometry code; no compatibility shims.
- `PANEL_CLIP_REVISION` 2 → 3 and `TRANSCODE_VERSION` v4 → v5.
- Decision note `docs/decisions/0028-background-media-one-path.md` must exist, with an exact `- **Paths:**` claim, before editing any watchlisted file (`renderer-core/src/theme/`, `scene-fabric/src/background-media.ts`, `host/src/panels/`).
- End commit messages with `Co-Authored-By: Claude Code <noreply@anthropic.com>`.
- Probe values used in tests: box `400×100` (4:1), source `160×90` (16:9).

## Review Focus

- **A source with the box's own aspect.** Area equals the box; scale and offset must still move it with no divide-by-zero and no duplicated crop.
- **Offset at the range's edge (±5).** It must saturate at the flush position, never move the area off-screen and never emit NaN into an ffmpeg expression.
- **Source size unknown.** The DOM must place the area, re-place on intrinsic load, and no encoder may receive a zero-sized `dest` or `crop`.
- **Area outside the box.** DOM and glass clip it; encoders use `dest` only, so no negative overlay coordinates and no out-of-bounds crop.
- **Band orientation on the wrong axis.** A wide source in a tall box (and the reverse) must keep the two ramps on the sides that actually meet the fill.

---

### Task 1: Resolver owner and decision note

**Files:**
- Create: `docs/decisions/0028-background-media-one-path.md`
- Modify: `src/web/packages/renderer-core/src/theme/background-composition.ts`
- Modify: `src/web/packages/renderer-core/src/index.ts:314-322`
- Test: `src/web/packages/renderer-core/src/theme/background-composition.test.ts`

**Interfaces:**
- Consumes: `Background`, `BackgroundAnchor`, `BackgroundMedia`, `BackgroundMediaComposition`, `DEFAULT_BACKGROUND_EXTENT`, `MIN/MAX_BACKGROUND_EXTENT`, `MIN/MAX_BACKGROUND_FADE`, `MIN/MAX_BACKGROUND_SCALE`, `MIN/MAX_BACKGROUND_OFFSET`, `BACKGROUND_MEDIA_DEFAULTS`.
- Produces:
  ```ts
  export interface BackgroundMediaGeometry { readonly scale: number; readonly offsetX: number; readonly offsetY: number }
  export function backgroundGeometry(media: { readonly scale?: number; readonly offsetX?: number; readonly offsetY?: number } | undefined): BackgroundMediaGeometry;
  export interface CompositionCrop { readonly x: number; readonly y: number; readonly width: number; readonly height: number }
  export interface CompositionMedia { readonly cover: CompositionRect; readonly dest: CompositionRect; readonly crop: CompositionCrop }
  export interface BackgroundComposition { readonly region: CompositionRect; readonly masks: readonly BackgroundMask[]; readonly media?: CompositionMedia }
  export function resolveBackgroundComposition(box, composition, source?, geometry?): BackgroundComposition;
  ```
  `geometry` is optional and defaults to `{ scale: 1, offsetX: 0, offsetY: 0 }`, so untouched callers keep compiling.

- [ ] **Step 1: Write the decision note**

Work the seven rungs in `docs/decisions/README.md`: internal owner (this resolver and its five call sites), installed dependencies (ffmpeg filter behaviour for `crop`/`scale`/`overlay`, Fabric has no media geometry), native platform (CSS `object-fit`/`mask-image` and canvas `drawImage` number windows), public solutions (search current ffmpeg/canvas cover-crop patterns), integration comparison (one resolver vs per-surface maths), smallest probe (run the existing panel bake once and compare a filter graph by hand), decision. Claim exactly these files:

```markdown
- **Paths:** `src/web/packages/renderer-core/src/theme/background-composition.ts`,
  `src/web/packages/scene-fabric/src/background-media.ts`,
  `src/web/packages/host/src/panels/panel-video-composition.ts`,
  `src/web/packages/host/src/panels/turzx-video.ts`,
  `src/web/packages/host/src/panels/tur-usb-video.ts`
```

- [ ] **Step 2: Commit the note**

```bash
git add docs/decisions/0028-background-media-one-path.md
git commit -m "docs: record the one background-media geometry decision"
```

- [ ] **Step 3: Write the failing resolver tests**

Replace the existing test file with cases built on this helper:

```ts
const BOX = { width: 400, height: 100 };
const SOURCE = { width: 160, height: 90 };
const at = (geometry?: Partial<BackgroundMediaGeometry>) =>
  resolveBackgroundComposition(BOX, { anchor: "center" }, SOURCE, {
    scale: 1, offsetX: 0, offsetY: 0, ...geometry,
  });
```

Assertions (muted `toBeCloseTo` for fractional pixels):

```ts
it("keeps the simple background identical to the old cover at defaults", () => {
  const resolved = resolveBackgroundComposition(BOX, undefined, SOURCE);
  expect(resolved.region).toEqual({ left: 0, top: 0, width: 400, height: 100 });
  expect(resolved.media?.dest).toEqual({ left: 0, top: 0, width: 400, height: 100 });
  expect(resolved.media?.crop).toEqual({ x: 0, y: 25, width: 160, height: 40 });
  expect(resolved.masks).toEqual([]);
});

it("grows the simple area about the centre, which is the old zoom", () => {
  const resolved = resolveBackgroundComposition(BOX, undefined, SOURCE, { scale: 2, offsetX: 0, offsetY: 0 });
  expect(resolved.region).toEqual({ left: -200, top: -50, width: 800, height: 200 });
  expect(resolved.media?.crop).toEqual({ x: 40, y: 35, width: 80, height: 20 });
});

it("letterboxes a narrower source at the centre anchor", () => {
  const resolved = at();
  expect(resolved.region.left).toBeCloseTo(111.111, 3);
  expect(resolved.region.width).toBeCloseTo(177.778, 3);
  expect(resolved.media?.crop).toEqual({ x: 0, y: 0, width: 160, height: 90 });
});

it("keeps the full width and clips top and bottom at scale 2", () => {
  const resolved = at({ scale: 2 });
  expect(resolved.media?.dest.left).toBeCloseTo(22.222, 3);
  expect(resolved.media?.dest.width).toBeCloseTo(355.556, 3);
  expect(resolved.media?.crop).toEqual({ x: 0, y: 23, width: 160, height: 45 });
});

it("slides the centred area until it is flush and saturates", () => {
  const once = at({ offsetX: 1 });
  const far = at({ offsetX: 5 });
  expect(once.region.left).toBeCloseTo(222.222, 3);
  expect(far.region.left).toBeCloseTo(once.region.left, 6);
});

it("grows an edge band across the box and keeps it flush", () => {
  const resolved = resolveBackgroundComposition(BOX, { anchor: "left", extent: 0.5 }, SOURCE, { scale: 2, offsetX: 0, offsetY: 0 });
  expect(resolved.region).toEqual({ left: 0, top: 0, width: 400, height: 100 });
  expect(resolved.media?.crop).toEqual({ x: 0, y: 25, width: 160, height: 40 });
});

it("reports no media until the source size is known", () => {
  const resolved = resolveBackgroundComposition(BOX, { anchor: "center" }, undefined, { scale: 2, offsetX: 0, offsetY: 0 });
  expect(resolved.media).toBeUndefined();
  expect(resolved.region).toEqual({ left: -200, top: -50, width: 800, height: 200 });
});

it("moves the masks with the final area", () => {
  const resolved = resolveBackgroundComposition(BOX, { anchor: "center", fade: 0.25 }, SOURCE, { scale: 1, offsetX: 1, offsetY: 0 });
  expect(resolved.masks).toHaveLength(2);
  expect(resolved.masks[0]?.x1).toBeCloseTo(222.222, 3);
  expect(resolved.masks[0]?.x2).toBeCloseTo(322.222, 3);
  expect(resolved.masks[1]?.x1).toBeCloseTo(400, 6);
});

it("clamps authored geometry and refuses non-finite values", () => {
  expect(backgroundGeometry(undefined)).toEqual({ scale: 1, offsetX: 0, offsetY: 0 });
  expect(backgroundGeometry({ scale: 9, offsetX: -9, offsetY: Number.NaN })).toEqual({ scale: 5, offsetX: -5, offsetY: 0 });
});
```

Add the wide-source counterpart of the mask test with box `100×400` and source `160×90`: the two ramps sit on the top and bottom.

- [ ] **Step 4: Run the tests to verify they fail**

Run: `cd src/web && npx vitest run packages/renderer-core/src/theme/background-composition.test.ts`
Expected: FAIL — `backgroundGeometry` is not exported and `media` is absent.

- [ ] **Step 5: Implement the resolver**

In `background-composition.ts`:

- `backgroundGeometry(value)`: undefined or non-finite uses the default; finite values clamp to `MIN/MAX_BACKGROUND_SCALE` and `MIN/MAX_BACKGROUND_OFFSET`.
- `centreRect(box, source)` and `edgeBand(box, anchor, extent)` return the base area (the current `centre`/`edgeBand` maths, minus masks).
- `scaled(base, anchor, scale, box)`: `center`/simple scales width and height about the box centre; `left`/`right` scale width about the pinned edge and keep `height: box.height`; `top`/`bottom` scale height about the pinned edge and keep `width: box.width`.
- `slid(region, box, geometry)`: `travelX = |box.width − region.width| / 2`; `region.left += clamp(offsetX × box.width, ±travelX)`; same for Y.
- Masks are built from the final `region` with the existing expressions; `wide` (source aspect > box aspect) decides the axis for `center`. Source unknown at `center` returns no masks.
- `placeMedia(region, box, source)`: `factor = max(region.width/source.width, region.height/source.height)`; `cover` is the source scaled by `factor` and centred on the region; `dest = cover ∩ box` with width/height at least 1; `crop` is `round((dest.edge − cover.edge) / factor)` clamped to the source; crop width/height at least 1 and inside the source.
- `composition === undefined` uses the box as the base and always returns `masks: []`.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cd src/web && npx vitest run packages/renderer-core/src/theme/background-composition.test.ts && npm run typecheck`
Expected: PASS; typecheck reports no new errors.

- [ ] **Step 7: Export the new names**

In `renderer-core/src/index.ts`, extend the existing `background-composition.js` export block with `backgroundGeometry`, `type BackgroundMediaGeometry`, `type CompositionCrop`, `type CompositionMedia`.

- [ ] **Step 8: Commit**

```bash
git add src/web/packages/renderer-core
git commit -m "feat(renderer-core): resolve the media area, cover, dest and crop"
```

---

### Task 2: Device bakes share one filter

**Files:**
- Modify: `src/web/packages/host/src/panels/panel-video-composition.ts`
- Modify: `src/web/packages/host/src/panels/turzx-video.ts:63,148,317-370`
- Modify: `src/web/packages/host/src/panels/tur-usb-video.ts:87-108,143-194`
- Test: `src/web/packages/host/src/panels/turzx-video.test.ts`
- Test: `src/web/packages/host/src/panels/tur-usb-video.test.ts`

**Interfaces:**
- Consumes: Task 1's `resolveBackgroundComposition`, `backgroundGeometry`, `CompositionMedia`.
- Produces:
  ```ts
  export interface EncodeFilter { readonly filter: string; readonly complex: boolean; readonly durationSeconds?: number }
  export function panelFilter(box: { width: number; height: number }, placement: PanelVideoPlacement, source: VideoSourceFacts | undefined, rotation: PanelVideoRotation): EncodeFilter
  ```
  `box` is already the rotated box (`rotationBox(geometry, rotation)`).

- [ ] **Step 1: Write the failing bake tests**

In `turzx-video.test.ts`, replace the `panelCrop` import and tests with assertions on the shared `panelFilter`. Use `BOX = { width: 400, height: 100 }` and `SOURCE = { width: 160, height: 90 }`:

```ts
it("crops the plain bake to the visible area", () => {
  const filter = panelFilter(BOX, { offsetX: 0, offsetY: 0, scale: 2 }, SOURCE, { kind: "turn", turn: "none" });
  expect(filter).toMatchObject({ complex: false });
  expect(filter.filter).toBe("crop=80:20:40:35,scale=400:100:force_divisible_by=2");
});

it("bakes the composed area at dest and overlays it at dest", () => {
  const filter = panelFilter(BOX, { offsetX: 0, offsetY: 0, scale: 2, composition: { anchor: "center" } }, SOURCE, { kind: "turn", turn: "none" });
  expect(filter.complex).toBe(true);
  expect(filter.filter).toContain("crop=160:45:0:23,scale=356:100:force_divisible_by=2");
  expect(filter.filter).toContain("overlay=x=22:y=0");
  expect(filter.filter).not.toContain("overlay=x=-");
});
```

In `tur-usb-video.test.ts`, assert that `panelH264Args(..., placement, "none", SOURCE)` produces the same plain `-vf` value and that an advanced placement produces `-filter_complex`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd src/web && npx vitest run packages/host/src/panels/turzx-video.test.ts packages/host/src/panels/tur-usb-video.test.ts`
Expected: FAIL — `panelFilter` is not exported; `panelCrop` only returns a source window.

- [ ] **Step 3: Implement the shared filter in `panel-video-composition.ts`**

Delete `panelCrop`. Add `panelFilter(box, placement, source, rotation)`:

- `composition = resolveBackgroundComposition(box, placement.composition, source, backgroundGeometry(placement))`.
- Composed (`placement.composition !== undefined || placement.fill !== undefined`): `composeFilterGraph` with the same resolved geometry; `durationSeconds: composedSeconds(source)`.
- Plain: when `composition.media` exists, `crop=…,scale=box.width:box.height:force_divisible_by=2`; when it does not, the aspect-unknown `scale=…increase:force_divisible_by=2,crop=box` fallback. Append `flipFilter(placement)` and the turn/angle suffix.
- In `composeFilterGraph`, use `composition.media.dest` for the output size and overlay position, and `composition.media.crop` for the source window. Delete the `Math.max(0, …)` clamps. Map masks onto `dest` with `maskSource(mask, dest.left, dest.top, width, height)`. When `media` is absent, keep a `dest = region ∩ box` fallback.

- [ ] **Step 4: Wire both devices to it**

- `turzx-video.ts`: delete `panelFilter`, `plainFilter` and `EncodeFilter`; call `panelFilter(rotationBox(BOX, rotation), placement, readVideoFacts(bytes), rotation)`. Keep `encodeArgs`; bump `TRANSCODE_VERSION` to `"v5"`.
- `tur-usb-video.ts`: delete `panelFilter`; in `panelH264Args` build `const filter = panelFilter(rotationBox(geometry, rotation), placement, source, rotation)` and keep the existing `-vf` / `-filter_complex` branch. Remove imports that are now unused.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd src/web && npx vitest run packages/host/src/panels/turzx-video.test.ts packages/host/src/panels/tur-usb-video.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/web/packages/host/src/panels
git commit -m "refactor(host): one panel filter for USB and TURZX bakes"
```

---

### Task 3: One geometry for the page, the glass and the page clip

**Files:**
- Modify: `src/web/packages/scene-fabric/src/background-media.ts`
- Modify: `src/web/packages/scene-fabric/src/index.ts:24-34`
- Modify: `src/web/packages/host/src/themes/theme-media.ts:58,126-211,435-476`
- Modify: `src/web/packages/host/src/themes/video-frame.ts:124-305`
- Delete: `src/web/packages/scene-fabric/src/background-media.placement.test.ts`
- Test: `src/web/packages/scene-fabric/src/background-media.dom.test.ts`
- Test: `src/web/packages/scene-fabric/src/glass.dom.test.ts`
- Test: `src/web/packages/host/src/themes/theme-media.test.ts`
- Test: `src/web/packages/host/src/themes/video-frame.test.ts`

**Interfaces:**
- Consumes: Task 1's resolver and `backgroundGeometry`; Task 2 is independent of this task.
- Produces: `PanelClipTarget` becomes `{ readonly crop: CompositionCrop; readonly output: { readonly width: number; readonly height: number } }`.

- [ ] **Step 1: Write the failing DOM and glass tests**

In `background-media.dom.test.ts`, with a `400×100` artboard, `160×90` source adverts and a simple background:

```ts
it("places a live element at the cover rect inside the grown area", () => {
  // scale 2, offset 0
  expect(regionLayer.style.width).toBe("800px");
  expect(regionLayer.style.left).toBe("-200px");
  expect(child.style.width).toBe("800px");
  expect(child.style.height).toBe("450px");
  expect(child.style.top).toBe("-125px");
});

it("places a host-baked clip at the visible dest", () => {
  // same theme with a video backgroundSource; centre anchor, scale 2
  expect(child.style.width).toBe("355.556px");
  expect(child.style.height).toBe("100px");
  expect(child.style.top).toBe("50px");
});
```

In `glass.dom.test.ts`, assert the `drawImage` call uses the cover rect mapped into device pixels (the current whole-source five-argument call) and that the region/masks reported by `backdrop()` match the DOM.

- [ ] **Step 2: Run them to verify they fail**

Run: `cd src/web && npx vitest run packages/scene-fabric/src/background-media.dom.test.ts packages/scene-fabric/src/glass.dom.test.ts`
Expected: FAIL — the child is still placed by `placement()`.

- [ ] **Step 3: Consume the resolver in `background-media.ts`**

- `place()` calls `resolveBackgroundComposition({ width: box.width, height: box.height }, activeBackgroundComposition(background), child ? intrinsic(child) : undefined, backgroundGeometry(media))`; style the region layer and masks from it.
- Live element: `cover` translated by `−region.left/top`. Host-baked clip (`framed`): `dest` translated the same way. Both fall back to the region when `composition.media` is undefined.
- `backdrop()` passes `backgroundGeometry(background?.media)`; `paint()` draws the whole source into `composition.media.cover` (mapped with the existing region/device scales) instead of calling `placement`.
- Delete `PlacementInput`, `placement`, `panFloor`, `boundedScale`, `bounded`, `geometry()`, and remove `placement`/`PlacementInput` from `scene-fabric/src/index.ts`.
- Delete `background-media.placement.test.ts`.

- [ ] **Step 4: Run them to verify they pass**

Run: `cd src/web && npx vitest run packages/scene-fabric/src/background-media.dom.test.ts packages/scene-fabric/src/glass.dom.test.ts packages/scene-fabric/src/background-media.fallback.dom.test.ts packages/scene-fabric/src/background-poster.dom.test.ts packages/scene-fabric/src/artboard-backdrop.dom.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing page-clip tests**

In `theme-media.test.ts`, a composed 16:9 theme on a `400×100` panel at scale 2 must call `transcode` with:

```ts
expect(transcode).toHaveBeenCalledWith(
  expect.any(Uint8Array),
  { crop: { x: 0, y: 23, width: 160, height: 45 }, output: { width: 356, height: 100 } },
  undefined,
);
```

and the clip name must change when scale changes. In `video-frame.test.ts`, the request `{ crop: { x: 0, y: 23, width: 160, height: 45 }, output: { width: 356, height: 100 } }` encodes at the source window's own size (never upscaled), so the filter is `crop=160:45:0:23,scale=160:44:flags=lanczos`.

- [ ] **Step 6: Run them to verify they fail**

Run: `cd src/web && npx vitest run packages/host/src/themes/theme-media.test.ts packages/host/src/themes/video-frame.test.ts`
Expected: FAIL — `transcode` still receives `{ width: region.width, height: region.height, offsetX, offsetY, scale }`.

- [ ] **Step 7: Implement the page-clip path**

- `theme-media.ts`: replace `backgroundGeometryOf` with `backgroundGeometry(media)`. In `panelVideo`, resolve with the geometry, return `undefined` when `composition.media` is absent, and pass `{ crop: media.crop, output: { width: max(1, round(media.dest.width)), height: max(1, round(media.dest.height)) } }` to `transcode`. Delete the local `bounded` if it becomes unused. Bump `PANEL_CLIP_REVISION` to `3`.
- `video-frame.ts`: replace `PanelClipTarget` with the `crop`/`output` shape; delete `cropPlan`, `bounded`, `clamp`, `evenWithin` if unused; validate `crop` integers, positive sizes and `crop` inside the source; run `crop=…,scale=…:flags=lanczos`. Keep the never-upscale rule by even-flooring `output` against the crop size.

- [ ] **Step 8: Run them to verify they pass**

Run: `cd src/web && npx vitest run packages/host/src/themes/theme-media.test.ts packages/host/src/themes/video-frame.test.ts packages/host/src/server.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/web/packages/scene-fabric src/web/packages/host/src/themes
git commit -m "refactor: consume the one media geometry on every page surface"
```

---

### Task 4: Whole-gate verification and stale-path check

**Files:**
- Inspect only: every path above.

- [ ] **Step 1: Prove no geometry copy survived**

Run: `cd src/web && grep -rn "panFloor\|1 + 2 \* Math.abs\|panelCrop\|cropPlan\|backgroundGeometryOf\|PlacementInput" packages --include=*.ts --include=*.tsx | grep -v "\.test\."`
Expected: no output.

- [ ] **Step 2: Run the gate and record its exit code**

Run: `cd src/web && npm run gate > /tmp/yunari-gate.log 2>&1; echo "EXIT=$?"`
Expected: `EXIT=0`. If not, read the log.

- [ ] **Step 3: Build both bundles for the browser**

Run: `cd src/web && npm run build`
Expected: exit 0.

- [ ] **Step 4: Commit any test or doc adjustments**

```bash
git add src/web docs
git commit -m "test: hold every surface to the one media geometry"
```

- [ ] **Step 5: Ask for the human visual check**

Report the gate exit code and ask the user to look at the 16:9-on-4:1 theme at 200% in the editor, on the USB Lian Li panel and on a TURZX panel. Do not call the revision last-known-good until they have watched the glass.
