# The Colours Tab Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Colours tab in the asset finder lists palettes and gradients from four live sources and writes a chosen result into the editor-local preset library.

**Architecture:** One new `colour` listing category on the finder's existing source port. Results carry an optional `preset` payload shaped exactly like the preset library's stored entry, so applying one is a store call rather than an import. Four host adapters fetch three catalogues once into memory and query Color Hunt per page.

**Tech Stack:** TypeScript, Vitest, Base UI tabs, React 19, host `fetch`, the editor-local `presetLibrary`.

**Spec:** [`docs/superpowers/specs/2026-10-23-colours-tab-design.md`](../../specs/2026-10-23-colours-tab-design.md)

## Global Constraints

- **Spelling:** `colour` in code and UI, matching `ColourPicker` and `uiCopy.panels.colourHex`; the tab's visible word is **Colours**.
- **Page size:** 40 results a page in this category, all four sources.
- **Angle:** the editor stores gradient angle as `90 - cssDegrees`; WebGradients `deg` converts to `(90 - deg + 360) % 360`. UI Gradients renders `to right`, which is stored angle `0`.
- **Licences, verbatim:** `CC0-1.0` (ColorSwoop), `MIT` (UI Gradients, WebGradients), `unknown` (Color Hunt).
- **No new dependency.** JSON over the host's existing `fetch`.
- **Presets are not bytes.** A result with `preset` never calls `/api/assets/bytes`, the asset manager or `credits.json`.
- **Types:** `exactOptionalPropertyTypes` and `noUncheckedIndexedAccess` are on; refuse invalid numbers rather than coercing them.
- **One active plan:** this plan. Update `STATUS.md` at the final task; dispatch records live in `.superpowers/sdd/2026-10-23-colours-tab/`.

## Review Focus

- **A Color Hunt query that matches no tag** returns `[]`; the tab must show its no-results state, not a blank grid or a failure.
- **A Colour source toggled off, then the kind filter changed and changed back** keeps the earlier off choice — the filter intersects, it does not rewrite the stored set.
- **A WebGradients `deg` of 90, 180 or 270** converts without a negative or overflowing angle.
- **Adding the same palette twice** stores one entry and says `Already in presets`; a malformed payload refuses and changes nothing.
- **A palette row never fetches bytes** — with the bytes route spy, its call count stays zero.

---

## Phase 1 — The data

### Task 1: The wire and the listing's preset kind

**Files:**
- Modify: `src/web/packages/renderer-core/src/assets/wire.ts`
- Modify: `src/web/packages/renderer-core/src/index.ts`
- Modify: `src/web/packages/host/src/assets/source.ts`
- Modify: `src/web/packages/host/src/assets/routes.ts` (`listingOf`)
- Modify: `src/web/packages/host/src/assets/routes.test.ts`
- Modify: `src/web/packages/editor/src/asset-finder/modal.dom.test.tsx` (listing fixtures)
- Modify: `src/web/tests/e2e/asset-finder.spec.ts` (listing fixtures)
- Test: `src/web/packages/host/src/assets/routes.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  ```ts
  export type PresetKind = "palette" | "gradient";
  export type AssetPreset =
    | { readonly kind: "palette"; readonly colours: readonly string[] }
    | { readonly kind: "gradient"; readonly angle: number;
        readonly stops: readonly { readonly offset: number; readonly color: string }[] };
  // AssetResult gains: readonly preset?: AssetPreset;
  // AssetSourceListing gains: readonly presetKind: PresetKind | null;
  // AssetSource gains: readonly presetKind?: PresetKind;
  // ListingCategory gains "colour".
  ```

- [ ] **Step 1: Write the failing test**

In `routes.test.ts`, add a colour source fixture beside the existing ones and assert the listing through the file's own `start(...)` harness:

```ts
const colourSource: AssetSource = {
  id: "fake-palettes", label: "Palettes", category: "colour", body: "grid",
  requires: undefined, configurable: true, presetKind: "palette",
  search: async () => ({ results: [], totalPages: 1 }),
  bytesOf: async () => undefined,
};

it("lists a colour source's preset kind and a null for the others", async () => {
  const base = await start({ sources: [colourSource, iconSource] });
  const body = (await (await fetch(`${base}/api/assets/sources`)).json()) as {
    sources: readonly { id: string; presetKind: unknown }[];
  };
  expect(body.sources.find((s) => s.id === "fake-palettes")?.presetKind).toBe("palette");
  expect(body.sources.find((s) => s.id === "lucide")?.presetKind).toBeNull();
});
```

- [ ] **Step 2: Run it to verify it fails**

Run from `src/web/`: `npx vitest run packages/host/src/assets/routes.test.ts`
Expected: FAIL — `presetKind` is not a property of `AssetSource` / the listing.

- [ ] **Step 3: Add the types and the listing mapping**

- In `wire.ts`: add `PresetKind`, `AssetPreset`; add `"colour"` to `SourceCategory`; add `preset?: AssetPreset` to `AssetResult`; add `presetKind: PresetKind | null` to `AssetSourceListing`.
- In `renderer-core/src/index.ts`: export the two new types.
- In `host/src/assets/source.ts`: add `readonly presetKind?: PresetKind`.
- In `routes.ts`'s `listingOf`: `presetKind: source.presetKind ?? null`.
- Add `presetKind: null` to every existing `AssetSourceListing` literal in the two fixture files named above.

- [ ] **Step 4: Run the test and the typechecks**

Run: `npx vitest run packages/host/src/assets/routes.test.ts` → PASS.
Run: `npm run typecheck` → exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/web/packages/renderer-core/src/assets/wire.ts src/web/packages/renderer-core/src/index.ts \
  src/web/packages/host/src/assets/source.ts src/web/packages/host/src/assets/routes.ts \
  src/web/packages/host/src/assets/routes.test.ts src/web/packages/editor/src/asset-finder/modal.dom.test.tsx \
  src/web/tests/e2e/asset-finder.spec.ts
git commit -m "feat(asset-finder): a colour category and a preset payload on the wire"
```

### Task 2: ColorSwoop — the cached static catalogue

**Files:**
- Create: `src/web/packages/host/src/assets/colours/colorswoop.ts`
- Test: `src/web/packages/host/src/assets/colours/colorswoop.test.ts`

**Interfaces:**
- Consumes: `AssetSource`, `SourceContext`, `SearchPage` from `../source.js`; `AssetPreset` from renderer-core.
- Produces: `export const colorswoopSource: AssetSource`; `export const COLOUR_PAGE_SIZE = 40`.

- [ ] **Step 1: Write the failing test**

Use a fake `ctx.fetch` returning a 3-entry catalogue. Assert:

```ts
it("filters by name or tag and pages the filtered list", async () => {
  const page = await colorswoopSource.search("sun", 1, ctx);
  expect(page.results.map((r) => r.name)).toEqual(["Sunset Pair"]);
  expect(page.results[0]?.preset).toEqual({
    kind: "palette", colours: ["#112233", "#445566"],
  });
  expect(page.totalPages).toBe(1);
});

it("fetches the catalogue once for two searches", async () => {
  await colorswoopSource.search("", 1, ctx);
  await colorswoopSource.search("", 2, ctx);
  expect(fetch).toHaveBeenCalledTimes(1);
});

it("clears a failed fetch so the next search retries", async () => { /* reject once, then resolve; expect 2 calls */ });
```

Also assert `licence === "CC0-1.0"`, `sourceUrl` is the palette's `url`, and a malformed entry (two colours, or a non-hex value) is dropped rather than rendering.

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run packages/host/src/assets/colours/colorswoop.test.ts`
Expected: FAIL — the module does not exist.

- [ ] **Step 3: Implement the adapter**

- `CATALOGUE_URL = "https://colorswoop.com/api/palettes.json"`.
- A module-level `let pending: Promise<readonly Palette[]> | undefined`; a rejected promise sets it back to `undefined` before rethrowing.
- `search(query, page, ctx)`: filter on `name` and `tags`, case- and accent-insensitive (`normalize("NFKD")`, strip combining marks, lowercase); slice `(page-1)*40` to `page*40`; `totalPages = Math.max(1, Math.ceil(matches.length / 40))`.
- Each result: `id` = palette `id`, `name`, `kind: "palette"`, `preview: ""`, `subtitle: tags.join(", ")`, `licence: "CC0-1.0"`, `sourceUrl: url`, `preset: { kind: "palette", colours }`.
- `bytesOf` returns `undefined`; `host: "colorswoop.com"`; `requires: undefined`; `configurable: true`; `presetKind: "palette"`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run packages/host/src/assets/colours/colorswoop.test.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/web/packages/host/src/assets/colours/
git commit -m "feat(asset-finder): ColorSwoop palettes, cached and filtered locally"
```

### Task 3: Color Hunt — the tag feed

**Files:**
- Create: `src/web/packages/host/src/assets/colours/colorhunt.ts`
- Test: `src/web/packages/host/src/assets/colours/colorhunt.test.ts`

**Interfaces:**
- Consumes: the same port types as Task 2.
- Produces: `export const colorhuntSource: AssetSource`.

- [ ] **Step 1: Write the failing test**

```ts
it("posts the page as a feed step and the query as a tag", async () => {
  await colorhuntSource.search("sunset", 2, ctx);
  const [url, init] = vi.mocked(fetch).mock.calls[0] ?? [];
  expect(url).toBe("https://colorhunt.co/php/feed.php");
  expect(init?.method).toBe("POST");
  expect(String(init?.body)).toContain("step=1");
  expect(String(init?.body)).toContain("tags=sunset");
  expect(String(init?.body)).toContain("sort=new");
});

it("splits a 12-hex code into four colours", async () => { /* code: "aabbccddeeff112233445566" → 4 colours */ });

it("drops a code that is not 24 hex characters", async () => { /* results [] */ });

it("reports the last page from a short page and leaves a full page unknown", async () => { /* 2 results on page 3 → totalPages 3; 40 results → undefined */ });
```

Also: `licence === "unknown"`, `sourceUrl === "https://colorhunt.co/palette/<code>"`, a query containing a space is encoded as the form value.

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run packages/host/src/assets/colours/colorhunt.test.ts` → FAIL (module missing).

- [ ] **Step 3: Implement the adapter**

- `URLSearchParams` body: `step: String(page - 1)`, `sort: "new"`, `tags: query.trim()`, `timeframe: ""`; header `content-type: application/x-www-form-urlencoded; charset=UTF-8`.
- Accept only `/^[0-9a-f]{24}$/i`; split into four `#RRGGBB`.
- Name `Color Hunt ${code.slice(0, 6).toUpperCase()}`; `subtitle: `${likes} likes`` when `likes` is a string, else `undefined`.
- `totalPages: results.length < 40 ? page : undefined`.
- No cache: each page is its own feed request.
- `host: "colorhunt.co"`, `presetKind: "palette"`, `licence: "unknown"`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run packages/host/src/assets/colours/colorhunt.test.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/web/packages/host/src/assets/colours/colorhunt.ts src/web/packages/host/src/assets/colours/colorhunt.test.ts
git commit -m "feat(asset-finder): Color Hunt palettes through its tag feed"
```

### Task 4: UI Gradients

**Files:**
- Create: `src/web/packages/host/src/assets/gradients/uigradients.ts`
- Test: `src/web/packages/host/src/assets/gradients/uigradients.test.ts`

**Interfaces:**
- Consumes: the port types.
- Produces: `export const uigradientsSource: AssetSource`.

- [ ] **Step 1: Write the failing test**

```ts
it("turns two colours into two evenly spaced stops at angle 0", async () => {
  const page = await uigradientsSource.search("", 1, ctx);
  expect(page.results[0]?.preset).toEqual({
    kind: "gradient", angle: 0,
    stops: [{ offset: 0, color: "#091E3A" }, { offset: 1, color: "#2F80ED" }],
  });
});

it("filters names case-insensitively and pages at 40", async () => { /* 45 fixtures → page 2 has 5, totalPages 2 */ });
it("fetches once for two searches", async () => { /* ... */ });
```

Also `licence === "MIT"`, `sourceUrl === "https://github.com/ghosh/uiGradients"`, a three-colour entry gives offsets `0, 0.5, 1`, and an entry with fewer than two valid colours is dropped.

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run packages/host/src/assets/gradients/uigradients.test.ts` → FAIL.

- [ ] **Step 3: Implement the adapter**

- Fetch `https://raw.githubusercontent.com/ghosh/uiGradients/main/gradients.json`; module-level cached promise, cleared on rejection.
- Each entry `{ name, colors[] }`: keep only `#RRGGBB` strings; require ≥2; offsets `i / (n - 1)`; `angle: 0`.
- `id: String(index)`; `subtitle: undefined`; `host: "raw.githubusercontent.com"`; `presetKind: "gradient"`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run packages/host/src/assets/gradients/uigradients.test.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/web/packages/host/src/assets/gradients/
git commit -m "feat(asset-finder): UI Gradients as gradient presets"
```

### Task 5: WebGradients

**Files:**
- Create: `src/web/packages/host/src/assets/gradients/webgradients.ts`
- Test: `src/web/packages/host/src/assets/gradients/webgradients.test.ts`

**Interfaces:**
- Consumes: the port types.
- Produces: `export const webgradientsSource: AssetSource`.

- [ ] **Step 1: Write the failing test**

```ts
it("converts a CSS degree to the editor's stored angle", async () => {
  const page = await webgradientsSource.search("Warm Flame", 1, ctx);
  expect(page.results[0]?.preset).toEqual({
    kind: "gradient", angle: 45,          // deg 45
    stops: [{ offset: 0, color: "#ff9a9e" }, { offset: 0.99, color: "#fad0c4" }, { offset: 1, color: "#fad0c4" }],
  });
});

it("wraps deg 90, 180 and 270 without a negative angle", async () => { /* 0, 260, 170 */ });
it("filters by name and pages at 40", async () => { /* ... */ });
```

Also `licence === "MIT"`, `sourceUrl === "https://webgradients.com/"`, an entry with one stop is dropped.

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run packages/host/src/assets/gradients/webgradients.test.ts` → FAIL.

- [ ] **Step 3: Implement the adapter**

- Fetch `https://raw.githubusercontent.com/itmeo/webgradients/master/gradients.json`; cached promise, cleared on rejection.
- Each entry `{ name, index, deg, gradient[] }`: parse `{ color, pos }`, offset `pos / 100`, require ≥2; `angle = (90 - deg + 360) % 360`.
- `id: index`; `host: "raw.githubusercontent.com"`; `presetKind: "gradient"`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run packages/host/src/assets/gradients/webgradients.test.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/web/packages/host/src/assets/gradients/webgradients.ts src/web/packages/host/src/assets/gradients/webgradients.test.ts
git commit -m "feat(asset-finder): WebGradients with its own angles and stops"
```

### Phase 1 checkpoint

Run: `npm run typecheck` and `npx vitest run packages/host/src/assets` → exit 0.
Then post a phase summary and stop for the phase review gate.

---

## Phase 2 — The surface

### Task 6: The Colours tab, its filter and its rows

**Files:**
- Modify: `src/web/packages/host/src/assets/sources.ts`
- Modify: `src/web/packages/editor/src/asset-finder/modal.tsx`
- Modify: `src/web/packages/editor/src/asset-finder/row.tsx`
- Modify: `src/web/packages/editor/src/asset-finder/source-mark.tsx`
- Modify: `src/web/packages/editor/src/ui-copy.ts`
- Test: `src/web/packages/editor/src/asset-finder/modal.dom.test.tsx`

**Interfaces:**
- Consumes: `presetKind` on the listing (Task 1); `AssetPreset`.
- Produces: `data-yunari-asset-kind="all|palette|gradient"` filter buttons; `data-yunari-asset-preview="palette|gradient"` on a card's preview; `uiCopy.assets.category.colour`, `uiCopy.assets.action.colour`, `uiCopy.assets.kindFilter`.

- [ ] **Step 1: Write the failing tests**

In `modal.dom.test.tsx`, add listings for the four colour sources and assert:

```ts
it("draws the Colours tab and asks only the kind's sources", async () => {
  // sources: colorhunt + colorswoop (palette), uigradients + webgradients (gradient)
  // open, click [data-yunari-asset-tab="colour"], then click [data-yunari-asset-kind="palette"]
  expect(searchAssets.mock.calls.at(-1)?.[0].enabled).toEqual(["colorhunt", "colorswoop"]);
});

it("keeps a switched-off source off when the kind filter returns to all", async () => {
  // switch colorswoop off, choose gradient, choose all → enabled has colorhunt only
});

it("draws a palette as swatches and a gradient as a strip", async () => {
  // row for a palette result has 4 [data-yunari-swatch] children
  // row for a gradient result has [data-yunari-asset-preview="gradient"] with a background-image
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run packages/editor/src/asset-finder/modal.dom.test.tsx`
Expected: FAIL — no Colours tab, no kind control.

- [ ] **Step 3: Implement the surface**

- Register the four sources in `sources.ts`.
- `modal.tsx`: derive `kinds = [...new Set(gridSources.map(s => s.presetKind).filter(k => k !== null))]`; keep `presetFilter: "all" | PresetKind` state; visible sources are `gridSources` filtered by the kind; `enabledSources` stays the intersection with `disabled`; reset page and selection on filter change. Draw the control only when `kinds.length > 1` and `active === "colour"`, as a row of buttons with `data-yunari-asset-kind`.
- `row.tsx`: when `result.preset` is a palette, render `colours.map(c => <span data-yunari-swatch style={{ background: c }} />)`; when a gradient, render the `90 - angle` CSS gradient in the preview box. Keep the existing name/subtitle/mark layout.
- `source-mark.tsx`: add `const MONOGRAMS: Record<string,string> = { colorhunt: "CH", colorswoop: "CS", uigradients: "UG", webgradients: "WG" }` and use it before the single-letter fallback.
- `ui-copy.ts`: `category.colour: "Colours"`, `action.colour: "Add to presets"`, `kindFilter: { all: "All", palette: "Palettes", gradient: "Gradients" }`, `results` unchanged.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run packages/editor/src/asset-finder` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/web/packages/host/src/assets/sources.ts src/web/packages/editor/src/asset-finder/ src/web/packages/editor/src/ui-copy.ts
git commit -m "feat(asset-finder): the Colours tab, its kind filter and its preset previews"
```

### Task 7: Add to presets

**Files:**
- Create: `docs/decisions/0100-a-preset-is-data-not-an-import.md` (**before** editing the session)
- Modify: `src/web/packages/editor/src/asset-finder/actions.ts`
- Modify: `src/web/packages/editor/src/asset-finder/actions.test.ts`
- Modify: `src/web/packages/editor/src/asset-finder/modal.tsx` (`ActionOutcome`)
- Modify: `src/web/packages/editor/src/editor-session.ts` (`importAsset`)
- Test: `src/web/packages/editor/src/asset-finder/actions.test.ts`

**Interfaces:**
- Consumes: `presetLibrary` and `AssetPreset` (Task 1); `presetLibrary.addColours/addGradient`.
- Produces:
  ```ts
  // actions.ts
  export function applyPreset(
    result: AssetResult,
    library: PresetLibraryStore = presetLibrary,
  ): { ok: true; message?: string } | { ok: false; message: string };
  // ActionOutcome in modal.tsx gains an optional message on success.
  ```

- [ ] **Step 1: Write the decision note**

Follow `docs/decisions/README.md`: problem, rungs 1–7 with what was searched, `- **Paths:**` naming exactly `src/web/packages/editor/src/editor-session.ts`. Record that a preset is editor-local data, not authored theme state, so it bypasses the asset manager and `credits.json`.

- [ ] **Step 2: Write the failing test**

In `actions.test.ts`:

```ts
it("adds one colour preset per swatch, named by the palette", () => {
  const outcome = applyPreset({ ...result, name: "Cloud Dancer",
    preset: { kind: "palette", colours: ["#112233", "#445566"] } });
  expect(outcome).toEqual({ ok: true, message: "Added 2 colours" });
  expect(presetLibrary.getSnapshot().colours.at(-2)?.name).toBe("Cloud Dancer 1");
});

it("says already stored and adds nothing on a repeat", () => { /* second call → "Already in presets" */ });

it("stores a gradient once with its angle and stops", () => {
  applyPreset({ ...result, name: "Warm Flame", preset: { kind: "gradient", angle: 45, stops: [...] } });
  expect(presetLibrary.getSnapshot().gradients.at(-1)).toMatchObject({ name: "Warm Flame", angle: 45 });
});
```

Use `createPresetLibrary(undefined)` per test and pass it as the second argument; no localStorage cleanup is needed.

- [ ] **Step 3: Run it to verify it fails**

Run: `npx vitest run packages/editor/src/asset-finder/actions.test.ts` → FAIL (`applyPreset` missing).

- [ ] **Step 4: Implement**

- `applyPreset` calls the store, returns the message the store's counts justify (`Added n colours`, `Already in presets`, `Added gradient`).
- `modal.tsx`: `ActionOutcome` success may carry `message`; `runAction` sets `setMessage(outcome.message)` for both branches.
- `editor-session.ts`: at the top of `importAsset`, `if (result.preset !== undefined) return applyPreset(result);` — before `assetBytes`.

- [ ] **Step 5: Run the tests and typecheck**

Run: `npx vitest run packages/editor/src/asset-finder/actions.test.ts` → PASS.
Run: `npm run typecheck` → exit 0.

- [ ] **Step 6: Commit**

```bash
git add docs/decisions/0100-a-preset-is-data-not-an-import.md \
  src/web/packages/editor/src/asset-finder/actions.ts \
  src/web/packages/editor/src/asset-finder/actions.test.ts \
  src/web/packages/editor/src/asset-finder/modal.tsx \
  src/web/packages/editor/src/editor-session.ts
git commit -m "feat(asset-finder): add a palette or gradient to the editor's presets"
```

### Task 8: Browser proof and close-out

**Files:**
- Modify: `src/web/tests/e2e/asset-finder.spec.ts`
- Modify: `STATUS.md`
- Modify: `docs/architecture/ownership.md`
- Possibly modify: `docs/evidence/screenshots/README.md` and captures, only if a registered action needs recapturing.

**Interfaces:**
- Consumes: everything above.
- Produces: a browser test named `the Colours tab adds a palette to the presets`.

- [ ] **Step 1: Write the failing browser test**

```ts
test("the Colours tab adds a palette to the presets", async ({ page }, testInfo) => {
  test.skip(!isDesktopSurface(testInfo), "the editor is a desktop surface");
  const { searches } = await stubAssets(page, {
    sources: [colorSwoop, uiGradients],
    answer: () => ({ pages: [
      answered("colorswoop", [{ ...result("colorswoop:one", "Cloud Dancer"),
        kind: "palette", preset: { kind: "palette", colours: ["#112233", "#445566"] } }]),
      answered("uigradients", []),
    ] }),
  });
  await openFinder(page);
  await page.locator('[data-yunari-asset-tab="colour"]').click();
  await page.locator('[data-yunari-asset-kind="palette"]').click();
  await expect.poll(() => searches.at(-1)?.enabled ?? []).toEqual(["colorswoop"]);
  await page.locator('[data-yunari-asset-row="colorswoop:one"]').click();
  await page.locator('[data-yunari-asset-action=""]').click();
  const stored = await page.evaluate(() => localStorage.getItem("yunari.editor.presets"));
  expect(stored).toContain("#112233");
});
```

- [ ] **Step 2: Run it to verify it fails**

Rebuild first if the harness serves built bundles (see the spec's Important traps), then:
`npx playwright test tests/e2e/asset-finder.spec.ts --grep "Colours tab"`
Expected: FAIL before Task 6/7 are in the bundle; PASS after a rebuild.

- [ ] **Step 3: Run the focused proof**

Run the same command after rebuilding the editor bundle. Expected: 1 passed (plus the existing file's cases when run whole).
Run the whole file once: `npx playwright test tests/e2e/asset-finder.spec.ts` and record the count.

- [ ] **Step 4: Close out**

- Update `STATUS.md`: this plan is the last completed change (≤5 one-line bullets), current objective/next/blockers adjusted; run `npm run status:check`.
- Add the four adapter owners and the Colours category to `docs/architecture/ownership.md`.
- Run the whole gate from `src/web/` and capture the exit code and counts: `npm run gate > /tmp/gate.log 2>&1; echo $?` from Bash, or the PowerShell equivalent; report the code, never tail's.

- [ ] **Step 5: Commit**

```bash
git add STATUS.md docs/architecture/ownership.md src/web/tests/e2e/asset-finder.spec.ts
git commit -m "test(asset-finder): prove the Colours tab in the browser and close the plan"
```

---

## Plan self-review

- Spec §§1–5 map to Tasks 1, 6; §2 to Tasks 2–5; §3 to Task 1; §4 to Task 7; §6 to the adapter tests and Task 6's failure cases; §8 to Tasks 6–8; §11's order is the task order.
- Deferred by design: colour-neighbour search (§9) has no task.
- Names used later match earlier `Interfaces` blocks: `presetKind`, `AssetPreset`, `applyPreset`, `COLOUR_PAGE_SIZE`.
- Review Focus lines each have an owning test: Color Hunt empty tag (Task 3), toggle/filter intersection (Task 6), angle wrap (Task 5), duplicate add (Task 7), no bytes (Task 7's spy + Task 8).
