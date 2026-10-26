# Per-Display Shape and Rotation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let every display record carry a screen shape and rotation, present a theme rotated and fitted to it, and edit both from the pair page and the editor's Host settings.

**Architecture:** `renderer-core` owns the rotated and inscribed transform, returning a full 2D matrix. `scene-fabric` applies it to the canvas, media layers, the disc and the glass sampler. The host stores shape/rotation on the display record, validates them with one rule, and delivers them on the existing publish poll. The player applies them in place; the editor edits them through the same host route.

**Tech Stack:** TypeScript, Node HTTP, Fabric 7, React 19, Base UI, Vitest, Playwright.

**Spec:** [`docs/superpowers/specs/2026-10-26-display-rotation-design.md`](../specs/2026-10-26-display-rotation-design.md)

## Global Constraints

- Work from `src/web/`. No new dependencies.
- `exactOptionalPropertyTypes` and `noUncheckedIndexedAccess` are on. Optional fields are omitted, never set to `undefined`.
- Rotation is whole degrees, clockwise. Rect displays accept 0/90/180/270; circle displays accept 0–359, and 360 normalises to 0. Fractions, negatives, non-finite values and strings are refused, never clamped.
- A refused write is a 400 with the store's own words; it is never a 500 and never a silent default.
- `rotation: 0` is omitted from the stored record; readers answer 0.
- Every visible string comes from a copy owner (`uiCopy` in the editor/player, the page's own words in `pair.html`).
- Every visible change needs a real-browser assertion, not only unit geometry.
- A watched mechanism path needs its decision note before its first write.
- Run focused tests during a task; run `npm run gate` at the phase boundary.
- Commit explicit paths with a Conventional Commit title. Never `git add -A`.

## Review Focus

1. A display record hand-edited with `rotation: 45` and `shape: "rect"` → it reads as upright (rotation dropped), not as a crash or a 45° rect.
2. A shape change from circle at 37° to rect → the stored angle snaps to 0°, and the response and the next poll both say 0.
3. A 16:9 theme on a 90° rect display → rotated, contain-fitted, no crop, and the letterbox is the theme colour.
4. A 21:9 theme on a circle display at 0° and 45° → all four corners on the disc, and display-bounded media fills the disc without rotating.
5. `this-pc` and the unpaired `default` → no shape/rotation controls, and playback is rect/upright.

## File Structure

- `packages/renderer-core/src/artboard.ts` — rotation/shape input, matrix output, rotated mapping helpers.
- `packages/scene-fabric/src/scene.ts` — presentation state, fit, disc, clip, media and glass wiring.
- `packages/scene-fabric/src/background-media.ts` — per-box angle and radius.
- `packages/scene-fabric/src/glass.ts` — rotated sampling.
- `packages/host/src/settings/displays.ts` — record fields, validation, snapping.
- `packages/host/src/server.ts` — claim/local creation, PATCH, active map, poll payload.
- `packages/host/public/pair.html` — shape and starting rotation.
- `packages/player/src/publish-follower.ts`, `packages/player/src/main.ts` — delivery.
- `packages/editor/src/theme-library-client.ts`, `host-settings-mode/client.ts`, `host-settings-mode/region.tsx`, `ui-copy.ts` — Host controls.
- `src/web/tests/e2e/host-player.spec.ts` — browser proof.

---

### Task 1: The transform knows rotation and a circle

**Files:**
- Create: `docs/decisions/0120-a-display-carries-its-shape-and-the-transform-carries-a-matrix.md`
- Modify: `packages/renderer-core/src/artboard.ts`
- Modify: `packages/renderer-core/src/index.ts` (export the new types if the barrel lists them explicitly)
- Test: `packages/renderer-core/src/artboard.test.ts`

**Interfaces:**
- Produces:
  - `type DisplayShape = "rect" | "circle"`
  - `interface DisplayPresentation { readonly shape: DisplayShape; readonly rotation?: number }`
  - `ComputeArtboardTransformInput` gains `rotation?: number`, `shape?: DisplayShape`
  - `ArtboardTransform` gains `rotation: number` and `matrix: readonly [number, number, number, number, number, number]`
  - `documentToViewport`/`viewportToDocument` use `matrix`
  - `toCssTransform` emits `rotate()` only when `rotation !== 0`

- [ ] **Step 1: Write the decision note**

Write `docs/decisions/0120-a-display-carries-its-shape-and-the-transform-carries-a-matrix.md` from the template. Paths: the four changed owners above. Record the searches: `computeArtboardTransform` and its consumers, Fabric's `setViewportTransform`, the existing letterbox/media placement, `insertAdjacent`/CSS rotation alternatives, the ecosystem's "rotate then fit" convention, and the probe: a 90° fit of 1600×900 into 600×800 produces scale 0.5 and a 900×1600 box.

- [ ] **Step 2: Write the failing tests**

Add to `artboard.test.ts`:

```ts
it("keeps today's numbers at rotation 0", () => {
  const t = computeArtboardTransform({ artboard: { width: 1600, height: 900 }, viewport: { width: 800, height: 600 } });
  expect(t.matrix).toEqual([0.5, 0, 0, 0.5, 0, 75]);
  expect(t.rotation).toBe(0);
});

it("rotates then contain-fits a 90 degree rect display", () => {
  const t = computeArtboardTransform({
    artboard: { width: 1600, height: 900 },
    viewport: { width: 600, height: 800 },
    rotation: 90,
  });
  expect(t.scale).toBeCloseTo(0.5, 9);
  expect(t.matrix[0]).toBeCloseTo(0, 9);
  expect(t.matrix[1]).toBeCloseTo(0.5, 9);
  expect(t.matrix[2]).toBeCloseTo(-0.5, 9);
  expect(t.matrix[3]).toBeCloseTo(0, 9);
  expect(t.matrix[5]).toBeCloseTo(0, 9);
  expect(t.bars.x).toBeCloseTo(75, 9);
});

it("inscribes every artboard corner on a circle display", () => {
  const t = computeArtboardTransform({
    artboard: { width: 1600, height: 900 },
    viewport: { width: 600, height: 800 },
    shape: "circle",
    rotation: 45,
  });
  const radius = 300;
  for (const [x, y] of [[0, 0], [1600, 0], [1600, 900], [0, 900]] as const) {
    const p = documentToViewport(t, { x, y });
    expect(Math.hypot(p.x - 300, p.y - 400)).toBeCloseTo(radius, 6);
  }
});

it("keeps the circle scale independent of its angle", () => {
  const at = (rotation: number) => computeArtboardTransform({
    artboard: { width: 1600, height: 900 }, viewport: { width: 600, height: 800 }, shape: "circle", rotation,
  }).scale;
  expect(at(0)).toBeCloseTo(at(45), 12);
  expect(at(0)).toBeCloseTo(600 / Math.hypot(1600, 900), 12);
});

it.each([
  ["rect 45", { rotation: 45 }],
  ["rect 360", { rotation: 360 }],
  ["negative", { rotation: -90 }],
  ["fraction", { rotation: 90.5 }],
  ["circle 360", { shape: "circle" as const, rotation: 360 }],
])("refuses %s", (_name, extra) => {
  expect(() => computeArtboardTransform({
    artboard: { width: 1600, height: 900 }, viewport: { width: 600, height: 800 }, ...extra,
  })).toThrow(RangeError);
});

it("round-trips a rotated point", () => {
  const t = computeArtboardTransform({
    artboard: { width: 1600, height: 900 }, viewport: { width: 600, height: 800 }, rotation: 90,
  });
  const point = { x: 123, y: 456 };
  expect(viewportToDocument(t, documentToViewport(t, point))).toEqual(point);
});
```

- [ ] **Step 3: Run the tests and verify they fail**

Run: `npm test -- packages/renderer-core/src/artboard.test.ts`
Expected: FAIL — `matrix` is not a property.

- [ ] **Step 4: Implement**

In `computeArtboardTransform`:

- Default `shape = "rect"`, `rotation = 0`; require an integer in `0..359`; a rect requires a quarter turn; a circle accepts any whole degree. Throw `RangeError` otherwise.
- `radians = rotation * Math.PI / 180`.
- Rect: rotated bbox `w' = |w cos| + |h sin|`, `h' = |w sin| + |h cos|`; scale as today's contain/cover against `w' × h'`.
- Circle: `d = Math.min(viewportWidth, viewportHeight)`, `scale = d / Math.hypot(w, h)`; `contentFit` is ignored (a disc inscribes, it never crops).
- `a = scale cos`, `b = scale sin`, `c = -scale sin`, `dM = scale cos`; `tx = viewportWidth / 2 - (a*w/2 + c*h/2)`; `ty = viewportHeight / 2 - (b*w/2 + dM*h/2)`.
- `offsetX = tx`, `offsetY = ty`, `rotation`, `matrix: [a, b, c, dM, tx, ty]`.
- `bars` from `(viewport - w'*scale)/2` for contain; `crop` from the same overhang in document units for cover. Circle: both zero.
- The degenerate branch returns `rotation` and `matrix: [0,0,0,0,0,0]`.
- `documentToViewport` uses `[a,b,c,d,tx,ty]`; `viewportToDocument` inverts the 2×2 block and returns the origin when the determinant is 0.
- `toCssTransform`: unchanged output at rotation 0; otherwise `translate(txpx, typx) rotate(${rotation}deg) scale(${scale})`.

- [ ] **Step 5: Run the tests and verify they pass**

Run: `npm test -- packages/renderer-core/src/artboard.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/web/packages/renderer-core/src/artboard.ts src/web/packages/renderer-core/src/artboard.test.ts src/web/packages/renderer-core/src/index.ts docs/decisions/0120-a-display-carries-its-shape-and-the-transform-carries-a-matrix.md
git commit -m "feat(renderer): rotate and inscribe the artboard transform"
```

---

### Task 2: The scene presents the record's shape and angle

**Files:**
- Modify: `packages/scene-fabric/src/scene.ts`
- Modify: `packages/scene-fabric/src/background-media.ts`
- Modify: `packages/scene-fabric/src/glass.ts`
- Modify: `packages/scene-fabric/src/artboard-backdrop.ts`
- Test: `packages/scene-fabric/src/scene.dom.test.ts`, `packages/scene-fabric/src/background-media.dom.test.ts`, `packages/scene-fabric/src/glass.dom.test.ts`

**Interfaces:**
- Consumes: `computeArtboardTransform`, `DisplayPresentation` from Task 1.
- Produces:
  - `FabricSceneOptions.presentation?: DisplayPresentation`
  - `FabricSceneHandle.updatePresentation(next: DisplayPresentation): void`
  - `MediaBox.angle?: number`, `MediaBox.radius?: "circle"`
  - `BackdropMedia.angle?: number`, `BackdropMedia.screenRect?: MediaBox`

- [ ] **Step 1: Write the failing tests**

In `scene.dom.test.ts`:

```ts
it("applies a 90 degree rect presentation to the canvas", () => {
  const scene = mount({ presentation: { shape: "rect", rotation: 90 } });
  const vpt = scene.canvas.viewportTransform;
  expect(vpt[0]).toBeCloseTo(0, 9);
  expect(vpt[3]).toBeCloseTo(0, 9);
  expect(Math.abs(vpt[1])).toBeCloseTo(Math.abs(vpt[2]), 9);
});

it("clips a circle presentation to the disc", () => {
  const scene = mount({ presentation: { shape: "circle" } });
  expect(scene.host.style.background).toBe("rgb(0, 0, 0)");
  expect(scene.artboard.style.clipPath).toContain("circle(");
  expect(scene.host.querySelector("[data-yunari-display-disc]")).not.toBeNull();
});

it("moves the presentation in place", () => {
  const scene = mount();
  scene.updatePresentation({ shape: "circle", rotation: 45 });
  expect(scene.handle.transform().rotation).toBe(45);
  expect(scene.host.querySelector("[data-yunari-display-disc]")).not.toBeNull();
});
```

In `background-media.dom.test.ts`:

```ts
it("rotates a theme-bounded layer and not a display-bounded one", () => {
  const theme = mount({ bounds: { artboard: box(0, 0, 100, 50, { angle: 90 }) } });
  expect(layer(theme).style.transform).toBe("rotate(90deg)");
  const display = mount({ bounds: { artboard: box(0, 0, 100, 50), display: { ...box(0, 0, 50, 50), radius: "circle" } } });
  expect(layer(display).style.transform).toBe("");
  expect(layer(display).style.borderRadius).toBe("50%");
});
```

In `glass.dom.test.ts`, a pixel case:

```ts
it("samples a rotated backdrop at the rotated position", () => {
  // Two-tone backdrop: red on the left half, blue on the right, angle 180.
  // The panel sits right of the board centre, so unrotated it samples blue.
  const backdrop = twoTone({ left: [255, 0, 0, 255], right: [0, 0, 255, 255], angle: 180 });
  const panel = mountPanel({ backdrop, region: { left: 200, top: 100, width: 40, height: 40 } });
  expect(pixel(panel.surface, 20, 20)).toEqual([255, 0, 0, 255]);
});
```

- [ ] **Step 2: Run the tests and verify they fail**

Run: `npm test -- packages/scene-fabric/src/scene.dom.test.ts packages/scene-fabric/src/background-media.dom.test.ts packages/scene-fabric/src/glass.dom.test.ts`
Expected: FAIL — no `presentation` option, no disc, no angle.

- [ ] **Step 3: Implement**

`scene.ts`:

- Hold `let presentation: DisplayPresentation = { shape: "rect" };` initialized from `options.presentation`.
- `fit()` passes `rotation` and `shape` to `computeArtboardTransform`; applies `...transform.matrix` to `canvas.setViewportTransform`.
- Rect: `host.style.background` is the theme paint; the disc is hidden; `element.style.clipPath = ""`.
- Circle: `host.style.background = "#000"`; create/reuse a `[data-yunari-display-disc]` div sized to `d = min(host.clientWidth, host.clientHeight)`, centred, `border-radius: 50%`, background the theme paint; set `element.style.clipPath = circle(d/2 at viewport centre)`.
- Theme media: `setBounds({ artboard: {left: offsetX, top: offsetY, width: w*scale, height: h*scale, angle: transform.rotation}, display: displayBox })`, where `displayBox` is the host rect for a rect display and the disc box (`radius: "circle"`) for a circle.
- `updatePresentation(next)`: store, `fit()`, `requestRenderAll()`.
- The scene handle exposes the current presentation to the glass sampler.

`background-media.ts`:

- `place()` sets `layer.style.transform = box.angle === undefined || box.angle === 0 ? "" : \`rotate(${box.angle}deg)\`` and `borderRadius = box.radius === "circle" ? "50%" : ""`.
- `backdrop()` returns `angle: bounds.artboard.angle` for a theme-bounded layer and `screenRect: bounds.display` for a display-bounded one; `rect` stays the artboard-unit box used for placement.

`glass.ts`:

- `backdropFor` computes the rotation from `media.angle ?? 0`. It maps the device centre through the full plane matrix, uses `Math.hypot(plane[0], plane[1])` as the uniform scale, and rotates the scratch context about that centre before `media.paint` when the angle is non-zero.
- When `media.screenRect` is present, the device rect is `screenRect * canvas.getRetinaScaling()` and no rotation is applied.
- `artboard-backdrop.ts` returns `angle: media?.angle ?? options.angle ?? 0`; add `angle?: number` to its options.

- [ ] **Step 4: Run the tests and verify they pass**

Run: `npm test -- packages/scene-fabric/src/scene.dom.test.ts packages/scene-fabric/src/background-media.dom.test.ts packages/scene-fabric/src/glass.dom.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/web/packages/scene-fabric/src/scene.ts src/web/packages/scene-fabric/src/background-media.ts src/web/packages/scene-fabric/src/glass.ts src/web/packages/scene-fabric/src/artboard-backdrop.ts src/web/packages/scene-fabric/src/scene.dom.test.ts src/web/packages/scene-fabric/src/background-media.dom.test.ts src/web/packages/scene-fabric/src/glass.dom.test.ts
git commit -m "feat(scene): present a display shape and rotation"
```

---

### Task 3: The host record owns shape and rotation

**Files:**
- Modify: `packages/host/src/settings/displays.ts`
- Modify: `packages/host/src/server.ts`
- Test: `packages/host/src/settings/displays.test.ts`, `packages/host/src/server.test.ts`

**Interfaces:**
- Consumes: `DisplayShape`, `DisplayPresentation` from `@yunari/renderer-core`.
- Produces:
  - `DisplayRecord.shape: DisplayShape`, `DisplayRecord.rotation?: number`
  - `DisplayPatch.shape?: DisplayShape`, `DisplayPatch.rotation?: number`
  - `class DisplaySettingError extends Error`
  - `normalizePresentation(shape: unknown, rotation: unknown): DisplayPresentation`
  - `snapRotation(shape: DisplayShape, rotation: number): number`
  - `DisplayStore.create(label, token, presentation?)`, `createLocal(label, monitor, presentation?)`
  - `ActiveDisplay` gains `shape`, `rotation`
  - publish poll `display` gains `shape`, `rotation`

- [ ] **Step 1: Write the failing tests**

In `displays.test.ts`:

```ts
it("stores shape and omits a zero rotation", async () => {
  const record = await store.create("Tablet", "token", { shape: "circle", rotation: 0 });
  expect(record).toMatchObject({ shape: "circle" });
  expect(record.rotation).toBeUndefined();
});

it("refuses a quarter turn that is not a quarter", async () => {
  await expect(store.create("Tablet", "token", { shape: "rect", rotation: 45 }))
    .rejects.toBeInstanceOf(DisplaySettingError);
});

it("accepts any whole degree on a circle and normalises 360", async () => {
  const record = await store.create("Round", "token", { shape: "circle", rotation: 360 });
  expect(record.rotation).toBeUndefined();
});

it("snaps a stored free angle when the shape becomes rect", async () => {
  const record = await store.create("Round", "token", { shape: "circle", rotation: 37 });
  const updated = await store.update(record.id, { shape: "rect" });
  expect(updated).toMatchObject({ shape: "rect" });
  expect(updated?.rotation).toBeUndefined();
});

it("refuses a patch rotation the final shape cannot hold", async () => {
  const record = await store.create("Tablet", "token", { shape: "rect" });
  await expect(store.update(record.id, { rotation: 45 })).rejects.toBeInstanceOf(DisplaySettingError);
});

it("reads an invalid stored shape as rect and drops its rotation", async () => {
  writeFileSync(DISPLAYS_FILE, JSON.stringify({ displays: [{ id: "odd", label: "Odd", kind: "paired", createdAt: at, lastSeenAt: at, tokenHash: "x", shape: "round", rotation: 45 }] }));
  expect(await store.list()).toEqual([expect.objectContaining({ shape: "rect", rotation: undefined })]);
});
```

In `server.test.ts`:

```ts
it("claims a paired display with its shape and rotation", async () => {
  const answer = await claim({ code, label: "Round", shape: "circle", rotation: 45 });
  expect(answer.status).toBe(200);
  const [record] = await displays.list();
  expect(record).toMatchObject({ shape: "circle", rotation: 45 });
});

it("refuses a claim with a bad rotation before spending the code", async () => {
  const answer = await claim({ code, label: "Tablet", shape: "rect", rotation: 45 });
  expect(answer.status).toBe(400);
  expect(await displays.list()).toHaveLength(0);
});

it("answers shape and rotation in the active map and the poll", async () => {
  const record = await displays.create("Round", "token", { shape: "circle", rotation: 45 });
  const active = await get("/api/themes/active");
  expect(active.displays.find((row) => row.id === record.id)).toMatchObject({ shape: "circle", rotation: 45 });
  const poll = await get(`/api/published?display=${record.id}`, record.token);
  expect(poll.display).toMatchObject({ shape: "circle", rotation: 45 });
});
```

Use the file's existing store/route harnesses; add a `claim` helper if one is not present.

- [ ] **Step 2: Run the tests and verify they fail**

Run: `npm test -- packages/host/src/settings/displays.test.ts packages/host/src/server.test.ts`
Expected: FAIL — `shape` is not a record field.

- [ ] **Step 3: Implement**

`displays.ts`:

- Add `DisplaySettingError`.
- `snapRotation("rect", r)` → `Math.round(r / 90) * 90 % 360`; `snapRotation("circle", r)` → `r % 360`.
- `normalizePresentation(shape, rotation)`: absent shape is `rect`; unknown shape throws; absent rotation is 0; non-integer, negative or ≥360 throws (360 → 0); a rect rejects non-quarters; returns `{ shape, ...(rotation === 0 ? {} : { rotation }) }`.
- `DisplayRecord.shape` is required; `normalizeRecord` reads an unknown shape as `rect` and drops a rotation the shape cannot hold.
- `create`/`createLocal` take an optional presentation and store it.
- `normalizePatch` validates shape membership and rotation as an integer in `0..359` (`360` → 0), throwing `DisplaySettingError`; it does not apply the shape rule because it has no record.
- `update` resolves `shape = patch.shape ?? found.shape`, `rotation = patch.rotation ?? found.rotation ?? 0`; when the shape changed and no rotation was named, snap; otherwise validate with `normalizePresentation(shape, rotation)`; store the result.

`server.ts`:

- Claim route: read `shape`/`rotation`, call `normalizePresentation` before `pairingCodes.claim`, answer 400 on `DisplaySettingError`, pass to `displays.create`.
- Local POST: same fields, pass to `createLocal`.
- PATCH: wrap `displays.update` in `try/catch`; `DisplaySettingError` → 400 with its message, anything else rethrows.
- `ActiveDisplay`: this-pc is `rect`/0; every record answers `shape` and `rotation: record.rotation ?? 0`.
- Add `presentationForDisplay(key, displays)` beside `chartFpsForDisplay`; the poll answers `display: { id, theme, chartFps, shape, rotation }`.

- [ ] **Step 4: Run the tests and verify they pass**

Run: `npm test -- packages/host/src/settings/displays.test.ts packages/host/src/server.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/web/packages/host/src/settings/displays.ts src/web/packages/host/src/server.ts src/web/packages/host/src/settings/displays.test.ts src/web/packages/host/src/server.test.ts
git commit -m "feat(host): store a display's shape and rotation"
```

---

### Task 4: The pair page names the panel

**Files:**
- Modify: `packages/host/public/pair.html`
- Test: `packages/host/src/server.test.ts` (static page assertion) or `src/web/tests/e2e/host-player.spec.ts`

**Interfaces:**
- Consumes: the claim body from Task 3.
- Produces: `#shape` (select: `rect`/`circle`) and `#rotation` (number) in the page; the claim body is `{ code, label, shape, rotation }`.

- [ ] **Step 1: Write the failing test**

Add to `server.test.ts` a static-asset case:

```ts
it("serves a pair page that asks for the screen shape and rotation", async () => {
  const page = await get("/pair");
  expect(page.status).toBe(200);
  expect(page.text).toContain('id="shape"');
  expect(page.text).toContain('id="rotation"');
  expect(page.text).toContain("shape: shape.value");
});
```

And a live Playwright case in `host-player.spec.ts`'s paired-display describe:

```ts
test("pairs a display as a circle at 45 degrees", async ({ page }) => {
  const code = await request.get(`${host}/api/pairing/code`).then((r) => r.json()).then((body) => body.code);
  await page.goto(`${host}/pair`);
  await page.fill("#code", code);
  await page.fill("#name", "Round panel");
  await page.selectOption("#shape", "circle");
  await page.fill("#rotation", "45");
  await page.click('button[type="submit"]');
  const record = await request.get(`${host}/api/pairing/sessions`).then((r) => r.json());
  expect(record.displays.find((d) => d.label === "Round panel")).toMatchObject({ shape: "circle", rotation: 45 });
});
```

- [ ] **Step 2: Run the tests and verify they fail**

Run: `npm test -- packages/host/src/server.test.ts`
Expected: FAIL — the page has no `#shape`.

- [ ] **Step 3: Implement**

Add beside the name field:

```html
<label for="shape">Screen shape</label>
<select id="shape" name="shape">
  <option value="rect">Rect</option>
  <option value="circle">Circle</option>
</select>
<label for="rotation">Starting rotation</label>
<input id="rotation" name="rotation" type="number" min="0" max="270" step="90" value="0" />
```

- On `#shape` change, set `#rotation.max`/`step` to `270`/`90` for rect and `359`/`1` for circle, and snap the current value to a quarter turn for rect.
- The claim body becomes `{ code, label, shape: shape.value, rotation: Number(rotation.value) }`.
- A refused claim still shows the host's own words.

- [ ] **Step 4: Run the tests and verify they pass**

Run: `npm test -- packages/host/src/server.test.ts`
Expected: PASS. Then run the one Playwright case:
`npm run test:e2e -- tests/e2e/host-player.spec.ts --grep "pairs a display as a circle"`

- [ ] **Step 5: Commit**

```bash
git add src/web/packages/host/public/pair.html src/web/packages/host/src/server.test.ts src/web/tests/e2e/host-player.spec.ts
git commit -m "feat(host): choose a display's shape when pairing"
```

---

### Task 5: The player applies it, and the editor edits it

**Files:**
- Modify: `packages/player/src/publish-follower.ts`
- Modify: `packages/player/src/main.ts`
- Modify: `packages/editor/src/theme-library-client.ts`
- Modify: `packages/editor/src/host-settings-mode/client.ts`
- Modify: `packages/editor/src/host-settings-mode/region.tsx`
- Modify: `packages/editor/src/ui-copy.ts`
- Test: `packages/player/src/publish-follower.test.ts`, `packages/editor/src/host-settings-mode/region.dom.test.tsx`

**Interfaces:**
- Consumes: poll payload from Task 3, `updatePresentation` from Task 2.
- Produces:
  - `PublishFollowerOptions.onPresentationChange?: (next: { shape: DisplayShape; rotation: number }) => void`
  - `ThemedDisplay.shape: DisplayShape`, `ThemedDisplay.rotation: number`
  - `HostSettingsClient.updateDisplayPresentation(id, next): Promise<{ shape; rotation }>`

- [ ] **Step 1: Write the failing tests**

In `publish-follower.test.ts`:

```ts
it("reports a shape and rotation from the poll", async () => {
  const seen: unknown[] = [];
  followPublished(sessionReturning({ display: { shape: "circle", rotation: 45 } }), () => {}, {
    intervalMs: 1,
    onPresentationChange: (next) => seen.push(next),
  });
  await settle();
  expect(seen).toEqual([{ shape: "circle", rotation: 45 }]);
});

it("refuses a rect rotation that is not a quarter turn", async () => {
  const seen: unknown[] = [];
  followPublished(sessionReturning({ display: { shape: "rect", rotation: 45 } }), () => {}, {
    intervalMs: 1,
    onPresentationChange: (next) => seen.push(next),
  });
  await settle();
  expect(seen).toEqual([]);
});

it("reports only when the presentation moves", async () => {
  const seen: unknown[] = [];
  const session = sessionReturning({ display: { shape: "circle", rotation: 45 } });
  followPublished(session, () => {}, { intervalMs: 1, onPresentationChange: (next) => seen.push(next) });
  await settle();
  await settle();
  expect(seen).toHaveLength(1);
});
```

In `region.dom.test.tsx`:

```ts
it("writes a rect display's quarter-turn rotation", async () => {
  const region = await openHost({ displays: [{ id: "tv", label: "TV", theme: null, shape: "rect", rotation: 0 }] });
  await selectDisplay(region, "TV");
  await commitRotation(region, 90);
  expect(patch).toHaveBeenCalledWith("tv", { shape: "rect", rotation: 90 });
  expect(row(region, "tv")).toHaveAttribute("data-shape", "rect");
});

it("snaps a circle angle when the shape becomes rect", async () => {
  const region = await openHost({ displays: [{ id: "round", label: "Round", theme: null, shape: "circle", rotation: 37 }] });
  await selectDisplay(region, "Round");
  await chooseShape(region, "Rect");
  expect(patch).toHaveBeenCalledWith("round", { shape: "rect", rotation: 0 });
});

it("draws no presentation controls for this-pc", async () => {
  const region = await openHost({ displays: [{ id: "this-pc", label: "This PC", theme: null, shape: "rect", rotation: 0 }] });
  expect(region.querySelector("[data-yunari-host-display-shape]")).toBeNull();
});
```

- [ ] **Step 2: Run the tests and verify they fail**

Run: `npm test -- packages/player/src/publish-follower.test.ts packages/editor/src/host-settings-mode/region.dom.test.tsx`
Expected: FAIL — no `onPresentationChange`, no shape control.

- [ ] **Step 3: Implement**

`publish-follower.ts`:

- Read `body.display.shape` and `body.display.rotation`.
- Accept `shape === "rect" | "circle"` and an integer rotation `0..359` where a rect rotation is a quarter turn.
- Keep `lastPresentation`; call `onPresentationChange` when the parsed value differs from the last, including the first answer.

`main.ts`: wire `onPresentationChange: (next) => handle.updatePresentation(next)`.

`theme-library-client.ts`: `ThemedDisplay` gains `shape` and `rotation`; `listDisplays` parses absent/invalid values as `rect`/0.

`host-settings-mode/client.ts`: add `updateDisplayPresentation(id, next)`, PATCH `${baseUrl}/api/displays/${id}`, body `{ shape, rotation }`, parse the answer's `shape`/`rotation` with the same defaults; a non-ok response throws its text.

`region.tsx`:

- After the Displays group, render a `Group` named from `uiCopy.hostSettings.displays.presentation` for the selected display when it is not `this-pc`.
- `ControlSegmented` (`data-yunari-host-display-shape`) with `Rect`/`Circle`.
- `ControlSlider` (`data-yunari-host-display-rotation`) with `values={[0, 90, 180, 270]}` for rect; `min={0}`, `max={359}`, `step={1}`, `integer` for circle.
- Shape change: `next = { shape, rotation: shape === "rect" ? snap(rotation) : rotation }`; call `updateDisplayPresentation`, then replace that row in the map from the answer.
- Rotation commit: send `{ shape, rotation }`.
- `this-pc` and the unpaired `default`: no controls; render `uiCopy.hostSettings.displays.presentationAbsent`.

`ui-copy.ts` under `hostSettings.displays`: `presentation`, `shape`, `shapeRect`, `shapeCircle`, `rotation`, `rotationSnapHint`, `presentationAbsent`, `savedPresentation`.

- [ ] **Step 4: Run the tests and verify they pass**

Run: `npm test -- packages/player/src/publish-follower.test.ts packages/editor/src/host-settings-mode/region.dom.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/web/packages/player/src/publish-follower.ts src/web/packages/player/src/main.ts src/web/packages/player/src/publish-follower.test.ts src/web/packages/editor/src/theme-library-client.ts src/web/packages/editor/src/host-settings-mode/client.ts src/web/packages/editor/src/host-settings-mode/region.tsx src/web/packages/editor/src/host-settings-mode/region.dom.test.tsx src/web/packages/editor/src/ui-copy.ts
git commit -m "feat: deliver and edit a display's presentation"
```

---

### Task 6: Browser proof, gate and close-out

**Files:**
- Modify: `src/web/tests/e2e/host-player.spec.ts`
- Modify: `STATUS.md`

**Interfaces:**
- Consumes: everything above.

- [ ] **Step 1: Write the failing browser tests**

Add to `host-player.spec.ts`:

```ts
test("a 90 degree rect display rotates and fits without cropping", async ({ page }) => {
  const display = await pairDisplay(request, "Rotated TV", { shape: "rect", rotation: 90 });
  await page.setViewportSize({ width: 600, height: 800 });
  await page.goto(playerUrl(display));
  const bounds = await page.evaluate(() => {
    const matrix = (window as any).yunari.handle.transform().matrix;
    const points = [[0, 0], [1600, 0], [1600, 900], [0, 900]].map(([x, y]) => ({
      x: matrix[0] * x + matrix[2] * y + matrix[4],
      y: matrix[1] * x + matrix[3] * y + matrix[5],
    }));
    return {
      minX: Math.min(...points.map((p) => p.x)),
      maxX: Math.max(...points.map((p) => p.x)),
      minY: Math.min(...points.map((p) => p.y)),
      maxY: Math.max(...points.map((p) => p.y)),
      width: innerWidth,
      height: innerHeight,
      quarterTurn: Math.abs(matrix[0]) < 1e-6 && Math.abs(matrix[3]) < 1e-6,
    };
  });
  expect(bounds.quarterTurn).toBe(true);
  expect(bounds.minY).toBeCloseTo(0, 1);
  expect(bounds.maxY).toBeCloseTo(bounds.height, 1);
  expect(bounds.minX).toBeGreaterThan(0);
  expect(bounds.maxX).toBeLessThan(bounds.width);
});

test("a circle display puts the artboard corners on the disc at 0 and 45", async ({ page }) => {
  for (const rotation of [0, 45]) {
    const display = await pairDisplay(request, `Round ${rotation}`, { shape: "circle", rotation });
    await page.goto(playerUrl(display));
    const corners = await page.evaluate(() => {
      const matrix = (window as any).yunari.handle.transform().matrix;
      const point = (x: number, y: number) => ({
        x: matrix[0] * x + matrix[2] * y + matrix[4],
        y: matrix[1] * x + matrix[3] * y + matrix[5],
      });
      const radius = Math.min(innerWidth, innerHeight) / 2;
      const centre = { x: innerWidth / 2, y: innerHeight / 2 };
      return {
        distances: [[0, 0], [1600, 0], [1600, 900], [0, 900]].map(([x, y]) => {
          const p = point(x ?? 0, y ?? 0);
          return Math.hypot(p.x - centre.x, p.y - centre.y);
        }),
        radius,
      };
    });
    for (const distance of corners.distances) {
      expect(distance).toBeCloseTo(corners.radius, 1);
    }
  }
});

test("a theme-bounded background rotates and a display-bounded one does not", async ({ page }) => {
  const themeDisplay = await pairDisplay(request, "Theme media", { shape: "rect", rotation: 180 });
  await page.goto(playerUrl(themeDisplay, { theme: TWO_TONE_THEME_BOUNDS }));
  await expect(page.locator("[data-yunari-background-media]")).toHaveCSS(
    "transform",
    "matrix(-1, 0, 0, -1, 0, 0)",
  );

  const displayDisplay = await pairDisplay(request, "Display media", { shape: "circle" });
  await page.goto(playerUrl(displayDisplay, { theme: TWO_TONE_DISPLAY_BOUNDS }));
  const layer = page.locator("[data-yunari-background-media]");
  await expect(layer).toHaveCSS("transform", "none");
  await expect(layer).toHaveCSS("border-radius", "50%");
  const geometry = await layer.evaluate((node) => ({
    width: (node as HTMLElement).offsetWidth,
    height: (node as HTMLElement).offsetHeight,
    disc: Math.min(window.innerWidth, window.innerHeight),
  }));
  expect(geometry.width).toBeCloseTo(geometry.disc, 0);
  expect(geometry.height).toBeCloseTo(geometry.disc, 0);
});

test("a glass panel samples the rotated theme", async ({ page }) => {
  // The fixture theme's media is red on the left half and blue on the right,
  // with a glass panel over the right half. At 0 degrees the panel's centre is
  // blue; at 180 degrees the same panel covers what was the left half and is red.
  const upright = await pairDisplay(request, "Glass upright", { shape: "rect" });
  await page.goto(playerUrl(upright, { theme: GLASS_TWO_TONE_THEME }));
  const before = await panelCentre(page);
  const turned = await pairDisplay(request, "Glass turned", { shape: "rect", rotation: 180 });
  await page.goto(playerUrl(turned, { theme: GLASS_TWO_TONE_THEME }));
  const after = await panelCentre(page);
  expect(before.blue).toBeGreaterThan(before.red);
  expect(after.red).toBeGreaterThan(after.blue);
});

test("the host controls write shape and rotation and the player picks them up", async ({ page }) => {
  const display = await pairDisplay(request, "Editable", { shape: "rect", rotation: 0 });
  await page.goto(`${host}/editor/`);
  await openHostDisplays(page);
  await selectDisplay(page, "Editable");
  await chooseShape(page, "Circle");
  await commitRotation(page, 45);
  await expect.poll(() => activeDisplay(request, display.id)).toMatchObject({ shape: "circle", rotation: 45 });
});
```

`pairDisplay` in this file currently takes `(request, label)`; extend it with an optional presentation argument and an optional theme id in the same step. Add `activeDisplay`, `panelCentre` (reads the panel's centre pixel from a screenshot), `TWO_TONE_THEME_BOUNDS`, `TWO_TONE_DISPLAY_BOUNDS` and `GLASS_TWO_TONE_THEME` beside the helpers. The two-tone media is an SVG fixture: left half `#ff0000`, right half `#0000ff`.

- [ ] **Step 2: Run the browser tests and verify they fail**

Run: `npm run test:e2e -- tests/e2e/host-player.spec.ts --grep "rotates and fits|circle display|theme-bounded background|host controls write"`
Expected: FAIL — the player is not rotated and the records keep `rect`/0.

- [ ] **Step 3: Fix what the run proves**

Only failures the tests demonstrate. Do not add new features. If a case cannot be made to fail for the right reason, say so in the task report rather than weakening it.

- [ ] **Step 4: Run the phase gate**

Run: `npm run gate`
Expected: exit 0. Read the exit code, not a pipe's.

- [ ] **Step 5: Update `STATUS.md` and commit**

Replace the "Last completed change" bullets with 1–5 bullets for this plan (record shape/rotation, rotated fit, circle presentation, delivery, Host controls). Keep one line per bullet and run `npm run status:check`.

```bash
git add STATUS.md
git commit -m "docs(status): close the display shape and rotation plan"
```

The controller merges the branch into `main` locally after this commit. The implementer does not merge or push.
