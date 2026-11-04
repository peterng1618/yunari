# Background composition implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a theme place its background media in a region of its bounds box, paint the rest with a palette fill, and fade the media into that fill with a linear or radial ramp — on the browser player and in the TURZX baked clip.

**Architecture:** The composition is document state on `Background`. One pure resolver in `renderer-core` turns it into a region rect and a mask line; `scene-fabric` turns that into DOM (fill layer, region wrapper, CSS mask) and into the glass backdrop; the host turns the same resolved values into an ffmpeg filter graph for the panel clip. The media layer stays `[data-yunari-background-media]` so the panel overlay capture hides the whole composition.

**Tech Stack:** TypeScript, Fabric, Vitest, ffmpeg-static 6.1.1 (`gradients`, `geq`, `maskedmerge`), Vite.

**Spec:** `docs/superpowers/specs/2026-11-04-background-composition-design.md`

## Global Constraints

- Local commits only. Do not push, publish or merge to a remote.
- Run npm commands from `src/web/`. The repository root has no `package.json`.
- `npm run gate` must exit 0 before the branch is reported done.
- Every runtime dependency added must get a notice in `THIRD-PARTY-NOTICES.md`. This plan adds none.
- Comments and docs state current invariants, not history.
- Refuse invalid values at the trust boundary; never clamp an authored inset or blend into range.
- Fabric JSON is the only scene model; this feature does not touch `scene`.
- `renderer-core` stays Fabric- and DOM-free.
- Match surrounding comment density and naming.

## Review Focus

- A fill layer outside `[data-yunari-background-media]` would cover a TURZX clip in overlay mode. The layer nesting is a hard invariant and gets a test.
- A mask longer than the region, or insets that leave a zero-area region, must be refused rather than producing a division by zero or an inverted ramp.
- Glass panels must sample the composed picture, not the raw video: a panel over a fade must show the fade.
- The cache key must change with every composition input, or a panel serves a stale clip.
- A theme with no region, blend or fill must keep the old `-vf` bake path byte-for-byte, so existing caches and tests do not move.

---

### Task 1: Decision record, document model and validation

**Files:**
- Create: `docs/decisions/0029-background-composition.md`
- Modify: `src/web/packages/renderer-core/src/theme/document.ts`
- Modify: `src/web/packages/renderer-core/src/theme/envelope-keys.ts`
- Modify: `src/web/packages/renderer-core/src/theme/envelope-semantics.ts`
- Modify: `src/web/packages/renderer-core/src/index.ts`
- Modify: `schema/theme-document.schema.json`
- Test: `src/web/packages/renderer-core/src/theme/envelope-semantics.test.ts`
- Test: `src/web/packages/renderer-core/src/theme/fabric-envelope-schema-sync.test.ts` (drift; no edit unless it fails)

**Interfaces:**
- Produces:
  ```ts
  export const BACKGROUND_EDGES = ["left", "right", "top", "bottom"] as const;
  export type BackgroundEdge = (typeof BACKGROUND_EDGES)[number];
  export const BACKGROUND_BLEND_SHAPES = ["linear", "radial"] as const;
  export const MAX_BACKGROUND_INSET = 0.9;
  export const MIN_BACKGROUND_BLEND_LENGTH = 0.01;
  export const MAX_BACKGROUND_BLEND_LENGTH = 1;
  export type BackgroundBlend =
    | { readonly shape: "linear"; readonly edge: BackgroundEdge; readonly length: number }
    | { readonly shape: "radial"; readonly length: number };
  export interface BackgroundRegion {
    readonly left?: number; readonly top?: number;
    readonly right?: number; readonly bottom?: number;
    readonly blend?: BackgroundBlend;
  }
  ```
  `BackgroundMedia` gains `region?: BackgroundRegion`; `Background` gains `fill?: StyleValue`.

- [ ] **Step 1: Write the decision record**

Create `docs/decisions/0029-background-composition.md` before any code. State the seven reuse rungs with the evidence in the spec (owner: `Background`; installed deps; native platform: CSS masks and ffmpeg; public solutions; integration comparison), and the rejected alternatives: a mask primitive, display-space scene objects, a separate overlay tint. Name every file the change touches. Run `node scripts/reuse-gate.mjs --help` if the hook asks for a specific claim shape.

- [ ] **Step 2: Write the failing validator tests**

Add to `envelope-semantics.test.ts` a block that builds a minimal valid envelope (there is an existing helper in the file for a blank theme) and asserts:

```ts
it("accepts a media region with a linear blend and a fill", () => {
  const envelope = withBackground({
    color: { ref: "palette.ink" },
    fill: { ref: "palette.surface" },
    media: {
      assetId: "clip",
      bounds: "display",
      region: { left: 0.35, blend: { shape: "linear", edge: "left", length: 0.12 } },
    },
  });
  expect(validateFabricThemeEnvelope(envelope).ok).toBe(true);
});

it("refuses a region that leaves no area", () => {
  // left + right = 1  → /background/media/region path, "out-of-range"
});

it("refuses an inset on a key that is not an edge", () => {
  // { diagonal: 0.2 } → "unknown-field" at /background/media/region/diagonal
});

it("refuses a linear blend with no edge and a radial blend with one", () => {
  // → "wrong-type" at /background/media/region/blend/edge
});

it("refuses a blend length that is zero or over one", () => {
  // 0 and 1.01 → "out-of-range" at /background/media/region/blend/length
});
```

- [ ] **Step 3: Run the tests to watch them fail**

Run: `npx vitest run packages/renderer-core/src/theme/envelope-semantics.test.ts`
Expected: FAIL — `unknown-field` for `region`/`fill`, or the assertions fail.

- [ ] **Step 4: Add the types and key bags**

`document.ts`: add the constants and types above beside `BACKGROUND_MEDIA_BOUNDS`; add `region?` to `BackgroundMedia` and `fill?` to `Background`.

`envelope-keys.ts`:
```ts
background: ["color", "fill", "media"],
backgroundMedia: [...existing, "region"],
backgroundRegion: ["left", "top", "right", "bottom", "blend"],
backgroundBlend: ["shape", "edge", "length"],
```

`index.ts`: export the new constants and types.

- [ ] **Step 5: Validate in `validateBackground`**

In `validateBackground`, after the existing media checks:

- if `background["fill"]` is present, `validateStyleValue(issues, value["fill"], "/background/fill", globalKeys)`.
- if `media["region"]` is present: `unknownKeys(..., envelopeKeysFor("backgroundRegion"), ...)`; each present inset must be a finite number in `[0, MAX_BACKGROUND_INSET]`; `left + right < 1` and `top + bottom < 1` (out-of-range at `/background/media/region`); the blend object is validated against `envelopeKeysFor("backgroundBlend")`, `shape` is `enumValue(..., BACKGROUND_BLEND_SHAPES, ...)`, `length` is a finite number in `[MIN_BACKGROUND_BLEND_LENGTH, MAX_BACKGROUND_BLEND_LENGTH]`, `linear` requires `edge` (enum) and `radial` refuses `edge`.

- [ ] **Step 6: Update the published schema**

Edit `schema/theme-document.schema.json`: `background` gains `fill` (same shape as `color`); `backgroundMedia` gains `region`; add `backgroundRegion` and `backgroundBlend` definitions with `additionalProperties: false` and the same property sets. Keep `schemaVersion` at `2.0.0`.

- [ ] **Step 7: Run the validator and drift tests**

Run: `npx vitest run packages/renderer-core/src/theme`
Expected: PASS, including `fabric-envelope-schema-sync.test.ts`.

- [ ] **Step 8: Commit**

```bash
git add src/web/packages/renderer-core/src/theme src/web/packages/renderer-core/src/index.ts schema/theme-document.schema.json
git commit -m "feat(renderer-core): model a background media region, fill and blend"
```

---

### Task 2: The composition resolver

**Files:**
- Create: `src/web/packages/renderer-core/src/theme/background-composition.ts`
- Modify: `src/web/packages/renderer-core/src/index.ts`
- Test: `src/web/packages/renderer-core/src/theme/background-composition.test.ts`

**Interfaces:**
- Consumes: `BackgroundRegion`, `BackgroundEdge`, `MAX_BACKGROUND_INSET` from Task 1.
- Produces:
  ```ts
  export interface CompositionRect {
    readonly left: number; readonly top: number;
    readonly width: number; readonly height: number;
  }
  export type BackgroundMask =
    | { readonly kind: "linear"; readonly x1: number; readonly y1: number;
        readonly x2: number; readonly y2: number }
    | { readonly kind: "radial"; readonly cx: number; readonly cy: number;
        readonly rx: number; readonly ry: number;
        readonly opaqueFraction: number };
  export interface BackgroundComposition {
    readonly region: CompositionRect;
    readonly mask: BackgroundMask | undefined;
  }
  export function resolveBackgroundComposition(
    box: { readonly width: number; readonly height: number },
    region: BackgroundRegion | undefined,
  ): BackgroundComposition;
  ```

- [ ] **Step 1: Write the failing tests**

```ts
it("returns the whole box with no mask when there is no region", () => {
  expect(resolveBackgroundComposition({ width: 800, height: 480 }, undefined))
    .toEqual({ region: { left: 0, top: 0, width: 800, height: 480 }, mask: undefined });
});

it("insets the region and ramps from its left edge inward", () => {
  const result = resolveBackgroundComposition(
    { width: 800, height: 480 },
    { left: 0.25, blend: { shape: "linear", edge: "left", length: 0.1 } },
  );
  expect(result.region).toEqual({ left: 200, top: 0, width: 600, height: 480 });
  expect(result.mask).toEqual({ kind: "linear", x1: 200, y1: 0, x2: 280, y2: 0 });
});

it("mirrors the ramp for the other three edges", () => {
  // right: x1 = region.right, x2 = region.right - 80
  // top:    y1 = region.top, y2 = region.top + length * height
  // bottom: y1 = region.bottom, y2 = region.bottom - length * height
});

it("fits a radial ramp to the region", () => {
  const result = resolveBackgroundComposition(
    { width: 800, height: 480 },
    { left: 0.1, top: 0.1, right: 0.1, bottom: 0.1,
      blend: { shape: "radial", length: 0.4 } },
  );
  expect(result.mask).toEqual({
    kind: "radial", cx: 400, cy: 240, rx: 320, ry: 192, opaqueFraction: 0.6,
  });
});

it("caps a ramp longer than the region at the opposite edge", () => {
  // left inset 0.5, length 1 → mask ends at region.right, not outside it
});
```

- [ ] **Step 2: Run the tests to watch them fail**

Run: `npx vitest run packages/renderer-core/src/theme/background-composition.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the resolver**

Region: `left = inset.left * box.width`, etc.; `width = box.width - left - right`, same for height. No `region` gives the whole box. Mask:

- `left`: `x1 = region.left`, `x2 = min(region.left + length * box.width, region.left + region.width)`, `y1 = y2 = region.top`.
- `right`: `x1 = region.left + region.width`, `x2 = max(x1 − length * box.width, region.left)`, same y.
- `top`: `y1 = region.top`, `y2 = min(region.top + length * box.height, region.top + region.height)`, same x.
- `bottom`: `y1 = region.top + region.height`, `y2 = max(y1 − length * box.height, region.top)`, same x.
- `radial`: `cx/cy` = region centre, `rx = region.width / 2`, `ry = region.height / 2`, `opaqueFraction = 1 − length`.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run packages/renderer-core/src/theme/background-composition.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/web/packages/renderer-core/src/theme/background-composition.ts \
  src/web/packages/renderer-core/src/theme/background-composition.test.ts \
  src/web/packages/renderer-core/src/index.ts
git commit -m "feat(renderer-core): resolve the background composition to one geometry"
```

---

### Task 3: Player DOM composition

**Files:**
- Modify: `src/web/packages/scene-fabric/src/background-media.ts`
- Modify: `src/web/packages/scene-fabric/src/scene.ts`
- Modify: `src/web/packages/scene-fabric/src/index.ts`
- Test: `src/web/packages/scene-fabric/src/background-media.dom.test.ts`

**Interfaces:**
- Consumes: `resolveBackgroundComposition`, `BackgroundMask` from Task 2; `cssArtboardPaint` and `plan.artboard.fill` from `renderer-core`.
- Produces: `BackgroundMediaOptions` gains `readonly fill?: unknown;` (resolved paint). No public API change beyond that.

**Layer invariant:** `[data-yunari-background-media]` contains, in order, a fill div and a region wrapper; the media child lives in the region wrapper. `setOverlayMode` hides that one element, so everything background-related disappears from the overlay capture.

- [ ] **Step 1: Write the failing DOM tests**

In `background-media.dom.test.ts`, mount a background with
`media.region = { left: 0.25, blend: { shape: "linear", edge: "left", length: 0.1 } }`
and a fill paint, then assert:

```ts
const layer = host.querySelector("[data-yunari-background-media]")!;
const fill = layer.querySelector("[data-yunari-background-fill]")!;
const region = layer.querySelector("[data-yunari-background-region]")!;
const media = region.querySelector("video, img")!;

expect(layer.contains(fill)).toBe(true);
expect(fill.style.background).toContain("linear-gradient");
expect(region.style.left).toBe("200px");
expect(region.style.width).toBe("600px");
expect(region.style.maskImage).toContain("linear-gradient");
expect(region.style.maskSize).toBe("100% 100%");
expect(media.parentElement).toBe(region);
// the child's placement is relative to the region
expect(media.style.left).toBe("0px");
```

Also assert a background with no `region` still places the child directly at the bounds box (no mask, no inset).

- [ ] **Step 2: Run the tests to watch them fail**

Run: `npx vitest run packages/scene-fabric/src/background-media.dom.test.ts`
Expected: FAIL — no fill/region elements.

- [ ] **Step 3: Implement the layers**

- Create `fillLayer` (`data-yunari-background-fill`) and `regionLayer`
  (`data-yunari-background-region`) once, in `mountBackgroundMedia`, and append them to `layer`; append the media child to `regionLayer`.
- `place()`: compute `const composition = resolveBackgroundComposition({ width: box.width, height: box.height }, media?.region);`
  - fill: `fillLayer.style.cssText = "position:absolute;inset:0;";` and `fillLayer.style.background = cssArtboardPaint(options.fill) ?? "transparent";`
  - region: left/top/width/height from `composition.region`;
    `regionLayer.style.maskImage = maskCss(composition.mask);` plus
    `webkitMaskImage` and `maskSize = "100% 100%"`. A missing mask clears both.
  - child: `placement({ box: { width: composition.region.width, height: composition.region.height }, source: intrinsic(child), ...geometry(media) })`.
- `maskCss`: linear → `linear-gradient(${90 - angle}deg, transparent 0%, black 100%)` from the mask line's direction; radial →
  `radial-gradient(ellipse at center, black ${opaqueFraction * 100}%, transparent 100%)`. Keep it in `background-media.ts`; it is the DOM form of the one mask.
  For linear, derive the CSS angle from `(x2 − x1, y2 − y1)` with `Math.atan2`, matching the artboard paint convention (0 = left-to-right, 90 = bottom-to-top). A unit test of the string for each edge is enough.
- `scene.ts`: pass `fill: plan.artboard.fill`.
- `renderer-core` `planArtboard`: add `fill: resolveStyleValue(background?.fill, globals, "background", issues)` to both the returned object and the `ScenePlan["artboard"]` type.

- [ ] **Step 4: Run the suite**

Run: `npx vitest run packages/scene-fabric packages/renderer-core`
Expected: PASS. Update any test that asserted the media child was a direct child of `layer`.

- [ ] **Step 5: Commit**

```bash
git add src/web/packages/scene-fabric/src/background-media.ts \
  src/web/packages/scene-fabric/src/background-media.dom.test.ts \
  src/web/packages/scene-fabric/src/scene.ts \
  src/web/packages/scene-fabric/src/index.ts \
  src/web/packages/renderer-core/src/scene/plan.ts
git commit -m "feat(scene-fabric): draw the background region, fill and mask"
```

---

### Task 4: Glass sampling sees the composition

**Files:**
- Modify: `src/web/packages/scene-fabric/src/glass.ts` (`BackdropMedia`)
- Modify: `src/web/packages/scene-fabric/src/artboard-backdrop.ts`
- Modify: `src/web/packages/scene-fabric/src/background-media.ts` (`backdrop()`)
- Test: `src/web/packages/scene-fabric/src/glass.dom.test.ts`
- Test: `src/web/packages/scene-fabric/src/background-media.dom.test.ts`

**Interfaces:**
- `BackdropMedia` gains:
  ```ts
  readonly fill?: unknown;
  readonly region?: CompositionRect;
  readonly mask?: BackgroundMask;
  ```
- Consumes the resolver's output; produces no new API.

- [ ] **Step 1: Write the failing test**

Extend the existing backdrop drawing assertions: with a region of `left: 0.5` and a solid fill, the backdrop paint records
a fill over the whole box and the media drawn only inside `region`; with a mask the media is drawn through a mask
(the test double records `mask`/`clip`/`drawImage` calls — follow whatever the existing `drawnAt`/`drawnIn` helpers record;
if they only record rects, extend them to record the mask application).

Expected RED: the paint records the media at the full box with no fill or mask.

- [ ] **Step 2: Implement**

- `backdrop()` passes `fill: options.fill`, and the region/mask from `resolveBackgroundComposition` for the placement being described (`"authored"` uses the display-or-artboard box; `"theme"` uses the artboard box).
- `artboard-backdrop.paint`: paint the fill across the media box first; draw the media clipped to the region and masked. Use a scratch canvas sized to the region and `destination-in` the mask there, then `drawImage` it — do not leave `destination-in` on the shared backdrop context. Release the scratch with the layer's other surfaces (`destroy()`).
- A `BackdropMedia` with no region keeps today's exact drawing path.

- [ ] **Step 3: Run the tests**

Run: `npx vitest run packages/scene-fabric/src/glass.dom.test.ts packages/scene-fabric/src/background-media.dom.test.ts`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/web/packages/scene-fabric/src/glass.ts \
  src/web/packages/scene-fabric/src/artboard-backdrop.ts \
  src/web/packages/scene-fabric/src/background-media.ts \
  src/web/packages/scene-fabric/src/glass.dom.test.ts \
  src/web/packages/scene-fabric/src/background-media.dom.test.ts
git commit -m "feat(scene-fabric): sample the background composition through glass"
```

---

### Task 5: Bake the composition into the panel clip

**Files:**
- Modify: `src/web/packages/host/src/panels/panel-device.ts` (`PanelVideoPlacement`)
- Modify: `src/web/packages/host/src/panels/turzx-video.ts`
- Test: `src/web/packages/host/src/panels/turzx-video.test.ts`

**Interfaces:**
- `PanelVideoPlacement` gains:
  ```ts
  readonly region?: { readonly left: number; readonly top: number;
    readonly right: number; readonly bottom: number };
  readonly blend?: { readonly shape: "linear" | "radial";
    readonly edge?: "left" | "right" | "top" | "bottom"; readonly length: number };
  readonly fill?: { readonly kind: "solid"; readonly color: string }
    | { readonly kind: "gradient"; readonly angle: number;
        readonly stops: readonly { readonly offset: number; readonly color: string }[] };
  ```
- `transcodeForPanel` consumes it; no new public function.

- [ ] **Step 1: Write the failing filter tests**

Use the existing test pattern: call `transcodeForPanel` with a fake `run`
that records its arguments, then assert on the filter argument.

```ts
it("crops the source to the media region and composites it over a solid fill", async () => {
  const args = await recordedEncodeArgs({
    offsetX: 0, offsetY: 0,
    region: { left: 0.35, top: 0, right: 0, bottom: 0 },
    blend: { shape: "linear", edge: "left", length: 0.12 },
    fill: { kind: "solid", color: "#101418" },
  });
  const filter = args[args.indexOf("-filter_complex") + 1]!;
  expect(filter).toContain("crop=");
  expect(filter).toContain("color=c=0x101418");
  expect(filter).toMatch(/maskedmerge|overlay/);
});

it("renders a gradient fill with gradients=", () => {
  // fill { kind: "gradient", angle: 90, stops: [...] } → "gradients="
});

it("renders a radial mask with geq and a linear mask with gradients", () => {
  // shape radial → /geq/; shape linear → /gradients=/
});

it("keeps the plain -vf path when there is no composition", () => {
  // existing expectations unchanged
});
```

- [ ] **Step 2: Run them to watch them fail**

Run: `npx vitest run packages/host/src/panels/turzx-video.test.ts`
Expected: FAIL — no region handling.

- [ ] **Step 3: Implement the graph**

- Region pixel box: `width = round(BOX.width * (1 − left − right))`, same for height; the media crop window is `panelCrop(source, offsetX, offsetY, regionBox)`.
- Filter graph (in the turned box, turn last):
  1. `[0:v]crop=<window>,scale=<regionW>:<regionH>[media]`
  2. fill source: `color=c=0x……:s=<box>[:d=…]` or `gradients=s=<box>:c0=…:c1=…:x0=…:y0=…:x1=…:y1=…[:nb_colors=…]`
  3. mask source **sized to the region**, with the resolver's line shifted by the region offset:
     linear → `gradients=s=<regionW>x<regionH>:c0=black:c1=white:x0=…` along the shifted ramp;
     radial → a `color=black` source through `geq` with the elliptical distance expression from `opaqueFraction`;
  4. `alphamerge` the mask into the media, then `overlay` it at the region offset on the fill;
  5. `<turnSuffix>` applied last.
- `encodeArgs` takes a `{ filter, complex: boolean }`; complex uses `-filter_complex <graph> -map "[out]"`.
- Keep the existing `-vf` string exactly when `region`, `blend` and `fill` are all absent.
- Bump `TRANSCODE_VERSION` to `v2`.

- [ ] **Step 4: Probe a real encode**

Write a scratch script outside the repo that generates a 2 s 64×36 clip with `lavfi`, runs the composed graph through the bundled `ffmpeg-static`, decodes one frame, and prints a corner pixel from the fill region and a centre pixel from the media region. Expected: different colours, and no ffmpeg error. Keep the script out of the repository.

- [ ] **Step 5: Run the tests**

Run: `npx vitest run packages/host/src/panels`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/web/packages/host/src/panels/panel-device.ts \
  src/web/packages/host/src/panels/turzx-video.ts \
  src/web/packages/host/src/panels/turzx-video.test.ts
git commit -m "feat(panels): bake the background composition into the TURZX clip"
```

---

### Task 6: Feed the composition from the theme

**Files:**
- Modify: `src/web/packages/host/src/themes/theme-media.ts`
- Test: `src/web/packages/host/src/themes/theme-media.test.ts`

**Interfaces:**
- Consumes the envelope's `background.media.region`, `background.fill`, palette globals.
- Produces the `PanelVideoPlacement` Task 5 expects.

- [ ] **Step 1: Write the failing test**

A theme with a display-bounded media, `region.left = 0.35`, a linear blend and a palette-referenced fill maps to:

```ts
{
  offsetX: 0, offsetY: 0,
  region: { left: 0.35, top: 0, right: 0, bottom: 0 },
  blend: { shape: "linear", edge: "left", length: 0.12 },
  fill: { kind: "solid", color: "#101418" },   // resolved from the palette
}
```

and a theme with no composition maps to `{ offsetX, offsetY }` only.

- [ ] **Step 2: Run it to watch it fail**

Run: `npx vitest run packages/host/src/themes/theme-media.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

Add a pure `panelVideoPlacement(envelope)` (export it for the test) that returns the pan today plus region/blend/fill when authored. Resolve `fill` with `resolveStyleValue(envelope.background.fill, envelope.globals as Globals, "background", [])`; a gradient paint keeps its angle and stops. Wire it into the existing video request path.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run packages/host/src/themes`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/web/packages/host/src/themes/theme-media.ts \
  src/web/packages/host/src/themes/theme-media.test.ts
git commit -m "feat(themes): pass the authored composition to the panel bake"
```

---

### Task 7: MCP `set_background`

**Files:**
- Modify: `src/web/packages/mcp/src/tools/draft.ts`
- Test: `src/web/packages/mcp/src/tools.background.test.ts` (create if absent)

**Interfaces:**
- `set_background` input gains:
  ```ts
  readonly fill?: string | PalettePaint | undefined;
  readonly inset?: { left?: number; top?: number; right?: number; bottom?: number } | undefined;
  readonly blend?: { shape?: "linear" | "radial"; edge?: "left" | "right" | "top" | "bottom"; length: number } | undefined;
  ```
- `theme-kit` `setBackground(envelope, background)` already takes a whole `Background`; no signature change.

- [ ] **Step 1: Write the failing test**

```ts
it("writes a fill, an inset region and a linear blend", async () => {
  // create_theme → set_palette { surface: "#101418" } →
  // set_background { color: "ink", fill: "surface",
  //   inset: { left: 0.35 }, blend: { edge: "left", length: 0.12 } }
  // assert envelope.background.fill = { ref: "palette.surface" }
  // assert region = { left: 0.35, blend: { shape: "linear", edge: "left", length: 0.12 } }
});

it("refuses a blend length outside the model range", async () => {
  // length: 0 → tool error, draft unchanged
});
```

- [ ] **Step 2: Run it to watch it fail**

Run: `npx vitest run packages/mcp/src/tools.background.test.ts`
Expected: FAIL — unknown fields ignored.

- [ ] **Step 3: Implement**

- Extend the `setBackground` input type and the zod schema; `fill` accepts a string token or a paint object like `set_palette` does.
- Resolve `fill` to `{ ref: "palette.<id>" }` (string token) or a literal paint value; refuse a token the theme does not declare.
- Keep the existing media fields when only composition fields are passed; `clear: true` still removes the whole background.
- Range checks mirror Task 1 before mutating, with a tool error naming the field.

- [ ] **Step 4: Run the MCP suite**

Run: `npx vitest run packages/mcp`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/web/packages/mcp/src/tools/draft.ts src/web/packages/mcp/src/tools.background.test.ts
git commit -m "feat(mcp): author the background region, fill and blend"
```

---

### Task 8: Editor background composition controls

**Files:**
- Modify: `src/web/packages/editor/src/selection-inspector/background-column.ts`
- Modify: `src/web/packages/editor/src/selection-inspector/view.ts` (`WRITABLE_FIELD_IDS`)
- Modify: `src/web/packages/editor/src/ui-copy.ts`
- Test: `src/web/packages/editor/src/selection-inspector/background-column.test.ts`
- Test: `src/web/packages/editor/src/selection-inspector/column.dom.test.tsx`

**Interfaces:**
- New field ids: `background.fill`, `background.inset`, `background.insetAmount`, `background.blendEdges`, `background.blendLength`, `background.blendShape`.
- `background.inset` is a `segmented` control with values `full | left | right | top | bottom | inset`; it maps to insets in `writeBackgroundField`:
  - `full` removes `region`;
  - `left` → `{ left: 1 − amount }`; `right` → `{ right: 1 − amount }`; `top`/`bottom` analogous;
  - `inset` → all four insets `= 1 − amount`.
- `background.insetAmount` and `background.blendLength` are percent sliders (stored fractions 0.1–0.9 and 0.01–0.5).
- `background.blendEdges` is a select `none|left|right|top|bottom|all`; `none` removes `blend`;
  `all` writes `{ shape: "radial", length }`; an edge writes `{ shape: "linear", edge, length }`.
- `background.blendShape` is a segmented `linear|radial`; switching to `radial` drops `edge`, switching to `linear` with no edge picks `left`.

- [ ] **Step 1: Write the failing column test**

Assert `backgroundColumn()` with a media and a region projects, in order, a `content` section with `background.fill` after `background.color`, and a `composition` section with `background.inset`, `background.insetAmount`, `background.blendEdges`, `background.blendLength`, `background.blendShape`.

Assert `writeBackgroundField`:
- `("background.inset", "left")` on `{ amount: 0.35 }` produces `region: { left: 0.65 }`;
- `("background.blendEdges", "all")` produces `blend: { shape: "radial", length }`;
- `("background.blendEdges", "none")` omits `blend`;
- an out-of-range amount returns `undefined`.

- [ ] **Step 2: Run it to watch it fail**

Run: `npx vitest run packages/editor/src/selection-inspector/background-column.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

- Add the rows to `backgroundColumn`; the composition section appears only when `media !== undefined`.
- Extend `writeBackgroundField` with the six cases; store defaults by omission (full region, no blend).
- Add the ids to `WRITABLE_FIELD_IDS` with their kinds; add `uiCopy` strings.
- Follow `DESIGN.md`: existing controls only, no new tokens. If a new label group needs a token, change `DESIGN.md` and `editor-shell.css` together and run `npm run design:check`.

- [ ] **Step 4: Run the editor suite**

Run: `npx vitest run packages/editor/src/selection-inspector` and `npm run design:check`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/web/packages/editor/src/selection-inspector src/web/packages/editor/src/ui-copy.ts
git commit -m "feat(editor): edit the background composition"
```

---

### Task 9: Skill and current-behaviour docs

**Files:**
- Modify: `skills/yunari-theme-designer/SKILL.md`
- Modify: `skills/yunari-theme-designer/references/tool-guide.md`
- Modify: `docs/architecture.md`
- Modify: `docs/hardware/turzx-serial.md`

**Interfaces:** prose only.

- [ ] **Step 1: Update the skill**

- Replace the "A mask survives the target's output" workaround with the composition rule: a fade or a masked edge is `set_background` with `fill` + `inset` + `blend`; never a scene scrim rect.
- State that on a TURZX target the composition is baked into the clip, so the blend does not band.
- Tool guide: `set_background` row gains `fill`, `inset`, `blend`; a fact stating the region is authored in the media's bounds box and the fill is the colour a fade reveals; the fill layer is hidden with the media in a panel overlay.

- [ ] **Step 2: Update current-behaviour docs**

- `docs/architecture.md`: background composition is document state; the resolver is the one geometry; the panel bake carries it.
- `docs/hardware/turzx-serial.md`: the clip bake composites the media region, fill and mask in the 8-bit video plane before the turn; the UI overlay stays free of background pixels.

- [ ] **Step 3: Verify the docs checks**

Run: `npm run docs:check`
Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add skills/yunari-theme-designer docs/architecture.md docs/hardware/turzx-serial.md
git commit -m "docs: background composition is the one fade rule"
```

---

### Task 10: Gate and report

- [ ] **Step 1: Run the full gate**

```bash
cd src/web
npm run gate > "$TEMP/gate.log" 2>&1; echo "exit=$?"; tail -40 "$TEMP/gate.log"
```

Expected: `exit=0`.

- [ ] **Step 2: Manual surface check**

Start the host, open a theme with a display-bounded media and a left region at a phone ratio, and confirm:
- the media sits in its region, the fill covers the rest;
- the blend is smooth at the seam;
- a contain-fit theme with a top blend fades across the whole screen, not just the artboard;
- `preview_theme` for a TURZX panel shows the composition.

- [ ] **Step 3: Report**

Report to the controller: the branch name, the commits, the gate exit code, the manual check result, and anything deferred. Do not merge or push.

```

## Self-review notes

- Coverage: region, fill, blend, DOM, glass, bake, MCP, editor, skill, docs, gate.
- The spec's "fill sampled from a frame" is recorded as a non-goal, so no task implements it.
- Types used in later tasks (`CompositionRect`, `BackgroundMask`, `PanelVideoPlacement` fields) match Task 1/2/5.
- Review Focus items each have a named task and test: layer nesting (Task 3), zero-area insets (Task 1), glass composition (Task 4), cache key (Task 5 step "bump TRANSCODE_VERSION"), old bake path unchanged (Task 5 tests).
