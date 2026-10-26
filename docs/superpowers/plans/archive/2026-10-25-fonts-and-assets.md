# Fonts and Assets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move font and media import into a fifth Assets pane, rebuild the Fonts finder around provider families and trios with a real preview, make presets explicit and bindable, and offer opt-in cleanup on both save flows.

**Architecture:** Font providers become host-owned `ASSET_SOURCES` entries and the curated catalogue moves out of the editor; the editor receives a font payload over the existing `/api/assets/search` and `/api/assets/bytes` routes. The new Assets pane owns declared files and import, the finder gets a result grid with a preview panel, and `EditorDocument` gains explicit preset actions. Cleanup computes reachability once and reuses the host's OS-trash routes.

**Tech Stack:** TypeScript, React 19 + Base UI, Tailwind, Fabric, Vitest + jsdom, Playwright, Node host routes, Fontsource/Fonttrio provider data.

**Spec:** [`2026-10-25-fonts-and-assets-design.md`](../../specs/2026-10-25-fonts-and-assets-design.md) — the plan argues from it; executors read both.

## Global Constraints

- All provider calls stay in the host. The editor never fetches the bytes a theme adopts from a font CDN; those come from `/api/assets/bytes`. A provider's *specimen* preview loads from the provider's own pinned URL — the spec's R15 (2026-10-26) records that reading, and `vg-736` is the host-routed path.
- The catalogue is generated and committed. `npm run fonts:generate` stays manual; the generated module records the Fonttrio revision.
- Every emitted face is a real format the family ships, `woff2` preferred, with its licence name and source URL when the provider supplies them.
- Schema changes are widening-only. No migration, no converter, no compatibility glue for a superseded internal shape.
- `schema/theme-document.schema.json`, the `renderer-core` reader types and `fabric-envelope-schema-sync.test.ts` move together.
- New UI copy goes in `editor/src/ui-copy.ts`; mockups in `docs/design/mockups/current/` are the visual gate.
- No new runtime dependency.
- Commands run from `src/web/`. Focused tests: `npx vitest run <path>`.
- Conventional Commit titles; stage explicit paths; never `git add -A`.
- A regression test must fail with the fix disabled before it is trusted.

## Review Focus

The spec implies these input classes; each line's test is added to the owning task.

- **A provider or CDN fails while browsing or applying.** The tile keeps a fallback face and stays selectable; Apply writes nothing and names the failure. (Tasks 5, 6, 12.)
- **A local `.ttf` or `.otf` is imported, bound and published.** The package validates, the player renders the face, and the credit carries its `assetId`. (Tasks 1, 16.)
- **The trash refuses during an opt-in cleanup.** The save aborts and declarations, bytes and credits are untouched. (Tasks 18, 19.)
- **A work-in-progress theme has unused assets and the author leaves the checkbox off.** Nothing is removed and the credits survive the save. (Tasks 17, 19.)
- **A portrait asset or theme is previewed.** The 270px panel keeps its width, the stage keeps its height, and no fact moves into a bottom band. (Tasks 20, 21.)

---

## Phase 1 — Contracts

### Task 1: Widen the font asset reference

**Files:**
- Modify: `packages/renderer-core/src/theme/document.ts` (`AssetLicense`, `FontAssetReference`)
- Modify: `packages/renderer-core/src/theme/fabric-envelope-validate.ts`
- Modify: `schema/theme-document.schema.json` (`$defs.fontAssetReference`)
- Test: `packages/renderer-core/src/theme/fabric-envelope-schema-sync.test.ts`
- Test: `packages/renderer-core/src/theme/fabric-envelope-validate.test.ts`
- Create: `docs/decisions/0116-fonts-and-assets-ownership.md`

**Interfaces:**
- Produces: `FontAssetFormat = "woff2" | "woff" | "ttf" | "otf"`;
  `FontAssetReference["format"]: FontAssetFormat`; `sourceUrl?: string`;
  `license?: AssetLicense`. Later tasks construct references in this shape.

- [ ] **Step 1: Land the decision note**

Write `docs/decisions/0116-fonts-and-assets-ownership.md` claiming
`src/web/packages/renderer-core/src/theme/`, `src/web/packages/host/src/server.ts`,
`src/web/packages/editor/src/editor-shell/shell-layout.tsx`,
`src/web/packages/editor/src/editor-session.ts`,
`src/web/packages/editor/src/selection-inspector/view.ts` and
`src/web/scripts/generate-font-trios.mjs`. Its Rungs 1–6 record what the spec's
Reuse section records; Decision: host-owned font sources, catalogue moved out of
the editor, one reachability owner for cleanup.

- [ ] **Step 2: Write the failing tests**

In `fabric-envelope-validate.test.ts`, add cases that build an envelope with a
`font` asset reference and expect:

```ts
it.each(["woff2", "woff", "ttf", "otf"] as const)(
  "accepts a local font reference in %s",
  (format) => { /* path: `assets/faces/body.${format}`, sourceUrl and license absent */ },
);
it("refuses a format that disagrees with the path extension", () => { /* format "woff2", path "body.ttf" */ });
```

In `fabric-envelope-schema-sync.test.ts`, assert the schema's
`format.enum` equals `["woff2", "woff", "ttf", "otf"]`, the path pattern ends
with those four, and `required` no longer carries `sourceUrl` or `license`.

- [ ] **Step 3: Run the tests and see them fail**

Run: `npx vitest run packages/renderer-core/src/theme/fabric-envelope-validate.test.ts packages/renderer-core/src/theme/fabric-envelope-schema-sync.test.ts`
Expected: FAIL — `woff`/`ttf`/`otf` are refused, and the sync test reports the old enum.

- [ ] **Step 4: Widen the type, the schema and the validator**

In `document.ts`:

```ts
export type FontAssetFormat = "woff2" | "woff" | "ttf" | "otf";
export interface FontAssetReference extends AssetReference {
  readonly kind: "font";
  readonly family: string;
  readonly weight: string | number;
  readonly style: "normal" | "italic";
  readonly format: FontAssetFormat;
  readonly sourceUrl?: string;
  readonly license?: AssetLicense;
}
```

Schema: `path.pattern` becomes
`^assets/[A-Za-z0-9._/-]{1,200}\\.(woff2|woff|ttf|otf)$`; `format` becomes the
four-value enum; `required` drops `sourceUrl` and `license`. In the validator,
one new semantic rule: the extension of `path` must equal `format`. Keep the
existing face/family agreement rule.

- [ ] **Step 5: Run the tests to verify they pass**

Run the same command. Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add docs/decisions/0116-fonts-and-assets-ownership.md \
  packages/renderer-core/src/theme/document.ts \
  packages/renderer-core/src/theme/fabric-envelope-validate.ts \
  packages/renderer-core/src/theme/fabric-envelope-schema-sync.test.ts \
  packages/renderer-core/src/theme/fabric-envelope-validate.test.ts \
  ../../../schema/theme-document.schema.json
git commit -m "feat(theme): accept local font formats in the asset schema"
```

---

### Task 2: Link credits to the asset they attribute

**Files:**
- Modify: `packages/theme-package/src/credits.ts`
- Test: `packages/theme-package/src/index.test.ts`
- Modify: `packages/editor/src/editor-document.ts` (`creditKey`, `#creditsPackage`)

**Interfaces:**
- Produces: `ThemeCreditsEntry.assetId?: string`. Reads ignore an absent value;
  writes preserve it. Cleanup (Task 17) removes a credit only when its
  `assetId` is one of the pruned ids.

- [ ] **Step 1: Write the failing test**

In `index.test.ts`, extend the credits fixture with `assetId: "asset-1"` and add:

```ts
it("round-trips an assetId on a credit", () => { /* write, read, expect equal */ });
it("still reads a credit written before assetId existed", () => { /* no assetId key */ });
```

- [ ] **Step 2: Run it and see it fail**

Run: `npx vitest run packages/theme-package/src/index.test.ts`
Expected: FAIL — `assetId` is dropped by the reader.

- [ ] **Step 3: Implement the optional field**

Add `readonly assetId?: string` to `ThemeCreditsEntry`; in the reader, accept it
only when it is a non-empty string; in the writer, include it only when present.
Do not raise the 256-entry cap.

- [ ] **Step 4: Run the test to verify it passes**

Run the same command. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/theme-package/src/credits.ts packages/theme-package/src/index.test.ts
git commit -m "feat(package): link a credit to its asset"
```

---

### Task 3: Carry font results and a search body over the wire

**Files:**
- Modify: `packages/renderer-core/src/assets/wire.ts`
- Modify: `packages/host/src/assets/search.ts`
- Modify: `packages/host/src/server.ts` (the `/api/assets/search` handler)
- Test: `packages/host/src/assets/search.test.ts`
- Test: `packages/renderer-core/src/assets/wire.test.ts` (create if absent)

**Interfaces:**
- Produces:

```ts
export type FontFormat = "woff2" | "woff" | "ttf" | "otf";
export interface FontCut {
  readonly id: string;
  readonly source: string;
  readonly family: string;
  readonly weight: string | number;
  readonly style: "normal" | "italic";
  readonly subset: string;
  readonly format: FontFormat;
  readonly previewUrl: string;
  readonly licence: string;
  readonly sourceUrl?: string;
}
export interface FontTrioInfo {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly roles: Readonly<Partial<Record<"heading" | "body" | "mono", FontCut>>>;
}
```

`AssetResult` gains `readonly font?: { readonly cuts: readonly FontCut[]; readonly trio?: FontTrioInfo }`.
`AssetSearchRequest` gains `readonly body?: "grid" | "font-picker"`.
`searchSources` asks `source.body === (request.body ?? "grid")`.

- [ ] **Step 1: Write the failing tests**

In `search.test.ts`, register two fake sources, one `body: "grid"` and one
`body: "font-picker"`, and assert:

```ts
it("asks only the sources whose body the request names", async () => { /* expect grid called once, font not; then the reverse */ });
it("defaults to the grid body when none is named", async () => { /* both registered, only grid searched */ });
```

- [ ] **Step 2: Run it and see it fail**

Run: `npx vitest run packages/host/src/assets/search.test.ts`
Expected: FAIL — the font source is called or the grid source is filtered out.

- [ ] **Step 3: Implement the filter and the wire types**

Change the predicate in `searchSources` as above; no route needs a new field
because the request body already passes through. Add the wire types verbatim.

- [ ] **Step 4: Run the test to verify it passes**

Run the same command. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/renderer-core/src/assets/wire.ts packages/host/src/assets/search.ts \
  packages/host/src/server.ts packages/host/src/assets/search.test.ts
git commit -m "feat(assets): search a named body and carry font results"
```

---

## Phase 2 — Host font sources

### Task 4: Move the curated catalogue into the host

**Files:**
- Modify: `scripts/generate-font-trios.mjs` (output path)
- Move: `packages/editor/src/font-trios.generated.ts` → `packages/host/src/assets/fonts/curated.generated.ts`
- Create: `packages/host/src/assets/fonts/curated-data.ts`
- Create: `packages/editor/src/type-preset-apply.ts`
- Test: `packages/editor/src/type-preset-apply.test.ts`

The editor's generated catalogue and query helpers stay in place until Task 14.
`PresetList` still reads them, so deleting them here would leave the tree without
a typecheckable build; the editor's copy is removed with the panel rebuild.

**Interfaces:**
- Produces: `packages/host/src/assets/fonts/curated-data.ts` exports
  `CURATED_TRIOS: readonly CuratedTrio[]`, `CURATED_FACES: readonly CuratedFace[]`,
  `trioById(id)`, `faceById(id)`.
- Produces: `applyFontTrio(presets: TypePresets, trio: FontTrioInfo): TypePresets`
  in the editor; it rewrites family and weight on role presets, creates missing
  roles, and preserves size, line-height and letter-spacing.
- Consumes: `FontTrioInfo` from Task 3.

- [ ] **Step 1: Write the failing test for the rewrite**

`type-preset-apply.test.ts`:

```ts
it("rewrites every role preset and creates the missing roles", () => {
  // two heading presets + one body + none mono; trio roles heading/body/mono
  // expect heading families changed, sizes kept, a mono preset created
});
it("leaves presets with no role untouched", () => {});
```

- [ ] **Step 2: Run it and see it fail**

Run: `npx vitest run packages/editor/src/type-preset-apply.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Move the generated data and the generator output**

Change the generator's output path to
`packages/host/src/assets/fonts/curated.generated.ts`; regenerate with
`npm run fonts:generate`. Move the file; add `curated-data.ts` exporting the
lookups and the wire mapping (Task 5 consumes it). The editor's copy and query
helpers stay until Task 14, because `preset-list.tsx` still imports them.

- [ ] **Step 4: Implement `applyFontTrio` without catalogue data**

Port the existing function body from the deleted `font-catalog.ts`, taking
`FontTrioInfo` instead of `FontTrio`. A preset participates when it carries a
`trioRole`; a missing role is created as `<Role> — <Family>` with the role's
default size (heading 46, body 24, mono 14).

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run packages/editor/src/type-preset-apply.test.ts`
Expected: PASS. Also run `npm run typecheck`.

- [ ] **Step 6: Commit**

```bash
git add scripts/generate-font-trios.mjs \
  packages/host/src/assets/fonts/curated.generated.ts \
  packages/host/src/assets/fonts/curated-data.ts \
  packages/editor/src/type-preset-apply.ts \
  packages/editor/src/type-preset-apply.test.ts
git commit -m "refactor(fonts): move the curated catalogue into the host"
```

---

### Task 5: Add the curated font source

**Files:**
- Create: `packages/host/src/assets/fonts/curated.ts`
- Modify: `packages/host/src/assets/sources.ts`
- Test: `packages/host/src/assets/fonts/curated.test.ts`

**Interfaces:**
- Produces: `curatedFontSource: AssetSource` with `id: "curated-fonts"`,
  `category: "font"`, `body: "font-picker"`, `requires: undefined`,
  `configurable: false`.
- Search: a trio matches on its name, description or member families; a family
  matches on its family name. Trio results carry `font.trio` and
  `font.cuts`; family results carry `font.cuts` and no trio.
- `bytesOf(resultId)` answers the cut's bytes through `ctx.fetch`; ids are
  `trio:<trio id>` and `cut:<face id>`.

- [ ] **Step 1: Write the failing tests**

```ts
it("finds a trio by a family inside it", async () => { /* query "Inter" → the trio whose heading face is Inter */ });
it("finds a family by name and carries its cuts", async () => { /* query "Manrope" → family result with cuts */ });
it("serves bytes for a cut through the injected fetch", async () => { /* ctx.fetch stub returns bytes; expect contentType font/woff2 */ });
it("keeps a failed face out of the result instead of failing the search", async () => {});
```

- [ ] **Step 2: Run the tests and see them fail**

Run: `npx vitest run packages/host/src/assets/fonts/curated.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the adapter**

Map `CURATED_TRIOS`/`CURATED_FACES` to `AssetResult`s. `previewUrl` is the
pinned Fontsource URL; `licence` is the face's OFL name; `sourceUrl` is the same
URL. Paging is one page; `totalPages: undefined`.

- [ ] **Step 4: Register it and run the tests**

Add `curatedFontSource` to `ASSET_SOURCES`. Run the command from Step 2.
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/host/src/assets/fonts/curated.ts \
  packages/host/src/assets/fonts/curated.test.ts \
  packages/host/src/assets/sources.ts
git commit -m "feat(assets): serve the curated font source from the host"
```

---

### Task 6: Add the Google font source

**Files:**
- Create: `packages/host/src/assets/fonts/google.ts`
- Modify: `packages/host/src/assets/sources.ts`
- Test: `packages/host/src/assets/fonts/google.test.ts`

**Interfaces:**
- Produces: `googleFontSource: AssetSource` with `id: "google-fonts"`,
  `category: "font"`, `body: "font-picker"`, `host: "api.fontsource.org"`,
  `requires: undefined`, `configurable: false`.
- Search reads Fontsource's registry (`type: "google"`), matches family names,
  and returns a family result with one cut per published weight × subset, each
  pinned to the family's `npmVersion`.
- A registry fetch failure answers one `AssetPage` with
  `failure: { reason: "failed", message }`, never a thrown error.

- [ ] **Step 1: Write the failing tests**

Use `ctx.fetch` stubs; no live network.

```ts
it("filters the registry to type google and matches a family name", async () => {});
it("pins every cut to the registry's npmVersion", async () => {});
it("answers a failed registry fetch as a failed page, not a throw", async () => {});
it("serves a woff2 for a cut through the injected fetch", async () => {});
```

- [ ] **Step 2: Run the tests and see them fail**

Run: `npx vitest run packages/host/src/assets/fonts/google.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the adapter**

Cache the registry per process for the life of one search call only (a second
open re-reads it); map `license`, `weights`, `subsets`, `category` and
`npmVersion` into `FontCut`s. `previewUrl` and `sourceUrl` are the pinned
jsDelivr URL.

- [ ] **Step 4: Register it and run the tests**

Add `googleFontSource` to `ASSET_SOURCES`. Run the command from Step 2.
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/host/src/assets/fonts/google.ts \
  packages/host/src/assets/fonts/google.test.ts \
  packages/host/src/assets/sources.ts
git commit -m "feat(assets): serve Google families through Fontsource"
```

---

## Phase 3 — The Assets pane

### Task 7: Add the fifth rail slot

**Files:**
- Modify: `packages/editor/src/editor-shell/rail.tsx` (`RailSlot`, `RAIL_SLOTS`)
- Modify: `packages/editor/src/editor-shell/icons.ts` (`RAIL_GLYPHS`)
- Modify: `packages/editor/src/ui-copy.ts` (`rail.slots`)
- Modify: `packages/editor/src/editor-shell/shell-layout.tsx` (`ShellHosts`, host element)
- Modify: `../../../DESIGN.md` §7.2
- Test: `packages/editor/src/editor-shell/rail.test.ts` (or the existing rail test)

**Interfaces:**
- Produces: `RailSlot` gains `"assets"`; `RAIL_SLOTS` order is
  `["composition", "add", "assets", "tokens", "document"]`; `ShellHosts.assets`
  is the pane host, element id `yunariPanelHostAssets`.

- [ ] **Step 1: Write the failing test**

```ts
it("has five slots with Assets between Add and Tokens", () => {
  expect(RAIL_SLOTS).toEqual(["composition", "add", "assets", "tokens", "document"]);
});
it("names the fifth slot Assets", () => { expect(uiCopy.rail.slots.assets).toBe("Assets"); });
```

- [ ] **Step 2: Run it and see it fail**

Run: `npx vitest run packages/editor/src/editor-shell/rail.test.ts`
Expected: FAIL — four slots.

- [ ] **Step 3: Implement the slot**

Add the union member, the glyph (a folder-family Lucide glyph), the copy, and the
host element. Update `DESIGN.md` §7.2's table and its **Four slots** sentence to
five, with the Assets row reading "Every declared file, its import and placement,
and the finder link".

- [ ] **Step 4: Run the test and the design checks**

Run the command from Step 2, then `npm run design:check`. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/editor/src/editor-shell/rail.tsx \
  packages/editor/src/editor-shell/icons.ts packages/editor/src/ui-copy.ts \
  packages/editor/src/editor-shell/shell-layout.tsx \
  packages/editor/src/editor-shell/rail.test.ts ../../../DESIGN.md
git commit -m "feat(editor): add the Assets rail slot"
```

---

### Task 8: Draw the Assets pane

**Files:**
- Create: `packages/editor/src/panes/assets/assets-pane.tsx`
- Create: `packages/editor/src/panes/assets/asset-card.tsx`
- Create: `packages/editor/src/panes/assets/assets-pane.dom.test.tsx`
- Modify: `packages/editor/src/editor-shell/shell-layout.tsx` (mount the pane)

**Interfaces:**
- Consumes: `AssetManager` (`declarations`, `assets`, preview URLs), `uiCopy`.
- Produces: `AssetsPane` props
  `{ manager, editor, isReferenced, onFindAssets, onPreview }`.
- A card shows: thumbnail or `Aa`, name, metadata, In use/Unused badge, and on
  the chosen row 26px action buttons with accessible names — **Preview**,
  **Place on canvas**, **Set as background**, **Replace**, **Remove**, plus
  **Create type preset** on a font. Actions call the manager and the editor;
  the component never owns bytes.

- [ ] **Step 1: Write the failing DOM test**

```tsx
it("groups cards by kind and marks the chosen row's actions", () => {
  // two images, one font; expect headings Images/Fonts; click the image row;
  // expect five named actions and no actions on the other row
});
it("shows an unused font without a preset as Unused", () => {});
```

- [ ] **Step 2: Run it and see it fail**

Run: `npx vitest run packages/editor/src/panes/assets/assets-pane.dom.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the pane**

Render the pane body under the existing `Pane` chrome (which owns
`data-yunari-panel`). Use the composition pane's row rhythm: 26px rows, kind
mark, name, state. Keep the existing element contracts the old file section
carried (`data-yunari-asset-select`, `-preview`, `-import`, `-replace`,
`-remove`, the two inputs and the `role="alert"`), so the browser specs keep
their locators.

- [ ] **Step 4: Run the test to verify it passes**

Run the command from Step 2. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/editor/src/panes/assets/ \
  packages/editor/src/editor-shell/shell-layout.tsx
git commit -m "feat(editor): draw the Assets pane"
```

---

### Task 9: Move import out of Add and open the finder from Assets

**Files:**
- Modify: `packages/editor/src/panes/assets/assets-pane.tsx` (`importFile`)
- Delete: `packages/editor/src/panes/add/file-section.tsx` and its test, after moving covered cases
- Modify: `packages/editor/src/new-object-panel.ts` (drop `assets` and `FileSection`)
- Modify: `packages/editor/src/editor-session.ts` (mount the pane, pass `onFindAssets`)
- Test: `packages/editor/src/panes/assets/assets-pane.dom.test.tsx`

**Interfaces:**
- Produces: `importFile(file: File, intent: "auto" | "background")`.
  Auto: image/SVG → `editor.placeImage` at the canvas centre; video →
  background media; font → the metadata form (Task 16). Background: forces an
  image or video into background media and refuses a font.
- The pane itself is mounted in Task 8; this task only wires import, the finder
  entry and the Add pane's removal.
- The finder opens from the pane's **Find assets** control and the File menu;
  Add renders only shapes, text and cards.

- [ ] **Step 1: Write the failing tests**

```tsx
it("places an imported image at the canvas centre", async () => {});
it("sets an imported video as background media", async () => {});
it("refuses Import as background for a font", async () => {});
it("draws no file section in the Add pane", () => {});
```

- [ ] **Step 2: Run them and see them fail**

Run: `npx vitest run packages/editor/src/panes/assets/assets-pane.dom.test.tsx packages/editor/src/new-object-panel.test.ts`
Expected: FAIL — the pane has no import routing and Add still mounts the file section.

- [ ] **Step 3: Move the behaviour**

Port video normalization, replace and remove from `file-section.tsx` into the
pane; delete the section and its mount. Keep `isReferenced` wired so a used
asset cannot be removed.

- [ ] **Step 4: Run the tests to verify they pass**

Run the command from Step 2. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -u packages/editor/src/panes/add/file-section.tsx \
  packages/editor/src/panes/add/file-section.dom.test.tsx \
  packages/editor/src/new-object-panel.ts packages/editor/src/editor-session.ts
git add packages/editor/src/panes/assets/ packages/editor/src/new-object-panel.test.ts
git commit -m "feat(editor): import files from the Assets pane"
```

---

## Phase 4 — The Fonts finder

### Task 10: Replace the Fonts body with a result grid

**Files:**
- Modify: `packages/editor/src/asset-finder/fonts-body.tsx`
- Create: `packages/editor/src/asset-finder/font-grid.tsx`
- Create: `packages/editor/src/asset-finder/font-grid.dom.test.tsx`
- Modify: `packages/editor/src/asset-finder/modal.tsx` (pass the font body)
- Modify: `packages/editor/src/asset-finder/client.ts`

**Interfaces:**
- Consumes: `searchAssets` with
  `{ query, enabled, pages, body: "font-picker" }`; results with `font`.
- Produces: `FontGrid` props
  `{ results, selectedId, onSelect, onLoadMore }`; a grid of four columns,
  trio and family tiles, provider badge, and roving focus inside the grid.

- [ ] **Step 1: Write the failing DOM test**

```tsx
it("asks the font body and draws trios and families in one grid", async () => {});
it("filters to trios or families without re-searching", () => {});
it("keeps the previous results when a source fails", () => {});
```

- [ ] **Step 2: Run it and see it fail**

Run: `npx vitest run packages/editor/src/asset-finder/font-grid.dom.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the grid and the body**

The body owns the query, the enabled font-source chips, the `All / Trios /
Fonts` filter, sort, and the grid; the 336px preview panel is Task 11. Delete
the three facet selects and the rule sentence from the old body.

- [ ] **Step 4: Run the test to verify it passes**

Run the command from Step 2. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/editor/src/asset-finder/fonts-body.tsx \
  packages/editor/src/asset-finder/font-grid.tsx \
  packages/editor/src/asset-finder/font-grid.dom.test.tsx \
  packages/editor/src/asset-finder/modal.tsx packages/editor/src/asset-finder/client.ts
git commit -m "feat(finder): browse fonts as one result grid"
```

---

### Task 11: Add the specimen preview panel

**Files:**
- Create: `packages/editor/src/asset-finder/font-preview-panel.tsx`
- Create: `packages/editor/src/asset-finder/font-preview-panel.dom.test.tsx`
- Modify: `packages/editor/src/asset-finder/fonts-body.tsx`

**Interfaces:**
- Consumes: the selected `FontTrioInfo` or `FontCut[]`; `document.fonts` for
  specimen loading; `uiCopy`.
- Produces: `FontPreviewPanel` props
  `{ selected: FontResult; presets: TypePresets; onApplyTrio, onAddTrioPresets, onAddPreset, onApplyToSelected }`
  (Task 12 implements the callbacks). The scope line reads from `presets`; the
  panel never reads the document itself.

- [ ] **Step 1: Write the failing DOM test**

```tsx
it("renders heading, body and mono in the trio card", () => {});
it("edits the sample line and re-renders the card", () => {});
it("names the apply scope and each before→after row", () => {});
it("disables Apply to theme with a reason when no preset carries a role", () => {});
it("draws a family's cuts and a role choice defaulting to Body", () => {});
```

- [ ] **Step 2: Run it and see it fail**

Run: `npx vitest run packages/editor/src/asset-finder/font-preview-panel.dom.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the panel**

A fixed specimen card plus an author-editable sample input; the scope line reads
`Heading × 6 · Body × 6 · Mono × 1` from the document's role presets; each row
reads `Clock 108 · 300 → Manrope 700`; a missing role reads `will be created`.
A family panel lists cuts as chips and a Role select defaulting to Body. Apply to
theme sits first, Add 3 presets beside it; family actions are Add as type preset
and, when the canvas selection resolves to a preset, Apply to selected preset.

- [ ] **Step 4: Run the test to verify it passes**

Run the command from Step 2. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/editor/src/asset-finder/font-preview-panel.tsx \
  packages/editor/src/asset-finder/font-preview-panel.dom.test.tsx \
  packages/editor/src/asset-finder/fonts-body.tsx
git commit -m "feat(finder): preview a trio or family before applying it"
```

---

### Task 12: Implement the preset actions in the document

**Files:**
- Modify: `packages/editor/src/editor-document.ts`
- Modify: `packages/editor/src/editor-session.ts` (wire the panel callbacks)
- Test: `packages/editor/src/editor-document.dom.test.ts`

**Interfaces:**
- Produces:

```
applyFontTrio(trio: FontTrioInfo): Promise<void>;          // replaces the id-based method
addTypePresetsFromTrio(trio: FontTrioInfo): Promise<void>; // creates 3, touches nothing
addTypePresetFromCut(cut: FontCut, role: "heading" | "body" | "mono" | null): Promise<string>;
setPresetRole(id: string, role: "heading" | "body" | "mono" | null): void;
unbindPresetFace(id: string): void;
```

The id-based `applyFontTrio(id)` is deleted with the old picker in Task 13; until
then both exist and the new one is the only caller the finder uses.

All bytes come from the host's `/api/assets/bytes`, addressed by
`cut.source` and `cut.id`; `#downloadFace` is replaced by a host-bytes read.
Every action goes through `setTypes`, so history and the unsaved marker see it.

- [ ] **Step 1: Write the failing tests**

```ts
it("apply rewrites role presets, keeps size and creates a missing role", async () => {});
it("add three creates Heading — X, Body — Y and Mono — Z without touching existing", async () => {});
it("a single cut creates a role-first preset", async () => {});
it("a failed host bytes read writes nothing and reports the failure", async () => {});
it("unbinding leaves family and weight editable", () => {});
```

- [ ] **Step 2: Run them and see them fail**

Run: `npx vitest run packages/editor/src/editor-document.dom.test.ts`
Expected: FAIL — methods do not exist.

- [ ] **Step 3: Implement the actions**

Reuse `applyFontTrio` from Task 4 for the rewrite; `addTypePresetsFromTrio` maps
each of the trio's three cuts; `addTypePresetFromCut` uses the role's default size
(46/24/14) and the name `<Role> — <Family>`. `unbindPresetFace` deletes
`face` and leaves family/weight as authored. Selectors
`data-yunari-font-apply` and `data-yunari-font-trio-apply` keep working.

- [ ] **Step 4: Run the tests to verify they pass**

Run the command from Step 2. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/editor/src/editor-document.ts packages/editor/src/editor-session.ts \
  packages/editor/src/editor-document.dom.test.ts
git commit -m "feat(editor): apply and create type presets explicitly"
```

---

### Task 13: Retire the old picker

**Files:**
- Delete: `packages/editor/src/font-picker/font-picker.tsx` and its test
- Delete: `packages/editor/src/font-preview.ts` and its test
- Move: `packages/editor/src/font-specimen-cache.ts` beside the finder body
- Modify: `packages/editor/src/asset-finder/fonts-body.tsx`
- Modify: `packages/editor/src/panes/tokens/preset-list.tsx` (drop its picker imports)

**Interfaces:**
- Consumes: the grid's virtualisation (reuse the pattern already in
  `font-picker.tsx` before deleting it).
- Produces: no 379-row unwindowed list; every result row is rendered on demand.

- [ ] **Step 1: Write the failing test**

In `font-grid.dom.test.tsx`:

```tsx
it("renders only the rows near the viewport for a 379-row result set", () => {});
it("moves focus with the arrow keys inside the grid", async () => {});
```

- [ ] **Step 2: Run it and see it fail**

Run: `npx vitest run packages/editor/src/asset-finder/font-grid.dom.test.tsx`
Expected: FAIL — every row is mounted.

- [ ] **Step 3: Implement virtualisation and delete the old path**

Reuse the virtualiser's shape from `font-picker.tsx`, then delete the picker and
`font-preview.ts`, and move the specimen cache beside the body. No selector or
test that names the removed picker survives.

- [ ] **Step 4: Run the tests and the dead-selector check**

Run the command from Step 2, then `npx vitest run packages/editor/src/asset-finder`, then `node ../../scripts/dead-selectors.mjs`.
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -u packages/editor/src/font-picker/ packages/editor/src/font-preview.ts \
  packages/editor/src/font-preview.dom.test.ts
git add packages/editor/src/asset-finder/ packages/editor/src/panes/tokens/preset-list.tsx
git commit -m "refactor(fonts): retire the facet picker"
```

---

## Phase 5 — Tokens, inspector and local fonts

### Task 14: Make the Tokens pane lists-only and select a token

**Files:**
- Modify: `packages/editor/src/panes/tokens/tokens-pane.tsx`
- Modify: `packages/editor/src/panes/tokens/preset-list.tsx`
- Create: `packages/editor/src/panes/tokens/token-selection.ts`
- Create: `packages/editor/src/panes/tokens/token-selection.ts`
- Modify: `packages/editor/src/editor-shell/shell-layout.tsx` (own the store)
- Delete: `packages/editor/src/font-catalog.ts`, `packages/editor/src/font-catalog-query.ts`,
  `packages/editor/src/font-trios.generated.ts` and their tests, once nothing in
  `preset-list.tsx` imports them
- Test: `packages/editor/src/panes/tokens/preset-list.dom.test.tsx`

**Interfaces:**
- Produces: `TokenSelection` — `{ subscribe(get), get(): { kind: "preset" | "paint"; id: string } | undefined; set(next); clear() }`.
- Token selection and canvas selection are exclusive: `set` clears the canvas
  selection; a canvas selection change clears the token selection.
- `PresetList` loses every editable field; a row renders specimen, name, role
  badge and resolution, and calls `onSelect(id)`.

- [ ] **Step 1: Write the failing tests**

```tsx
it("draws preset rows with a specimen and no input controls", () => {});
it("selecting a preset clears the canvas selection", () => {});
it("selecting on the canvas clears the token selection", () => {});
```

- [ ] **Step 2: Run them and see them fail**

Run: `npx vitest run packages/editor/src/panes/tokens/preset-list.dom.test.tsx`
Expected: FAIL — the row still renders fields and there is no store.

- [ ] **Step 3: Implement the lists and the store**

Move the fields out of `PresetList`; keep New type preset and Import font… as
pane actions. The specimen is `Aa` in the preset's own family — packaged faces
are already in `document.fonts`, so no network is needed. Once the panel no
longer imports the catalogue, delete the editor's `font-catalog.ts`,
`font-catalog-query.ts`, `font-trios.generated.ts` and their tests (the host copy
from Task 4 is the only one left).

- [ ] **Step 4: Run the tests to verify they pass**

Run the command from Step 2. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/editor/src/panes/tokens/ \
  packages/editor/src/editor-shell/shell-layout.tsx
git commit -m "feat(tokens): list tokens and select them for the inspector"
```

---

### Task 15: Put the selected token's properties in the inspector

**Files:**
- Create: `packages/editor/src/panes/tokens/token-inspector.tsx`
- Create: `packages/editor/src/panes/tokens/token-inspector.dom.test.tsx`
- Modify: `packages/editor/src/editor-shell/shell-layout.tsx` (mount into `hosts.selection`)
- Modify: `packages/editor/src/selection-inspector/index.ts` (suppression while a token is selected)

**Interfaces:**
- Consumes: `TokenSelection`, the document's presets/paints, `unbindPresetFace`,
  `setPresetRole`.
- Produces: the inspector column renders exactly one owner: the token section
  when a token is selected, otherwise the object inspector.

- [ ] **Step 1: Write the failing tests**

```tsx
it("shows name, role, size, weight, line height and letter spacing for a preset", () => {});
it("shows a bound preset's family and weight as read-only with Unbind", () => {});
it("makes family and weight editable after Unbind", () => {});
it("does not render the object inspector while a token is selected", () => {});
```

- [ ] **Step 2: Run them and see them fail**

Run: `npx vitest run packages/editor/src/panes/tokens/token-inspector.dom.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the inspector section**

Mount a React root into `hosts.selection` when `TokenSelection` is set; suppress
the imperative object inspector while it is. Role is a `ControlSelect` over
None/Heading/Body/Mono. Bound family and weight are read-only text with
**Unbind**; after Unbind they become the existing field controls.

- [ ] **Step 4: Run the tests to verify they pass**

Run the command from Step 2. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/editor/src/panes/tokens/token-inspector.tsx \
  packages/editor/src/panes/tokens/token-inspector.dom.test.tsx \
  packages/editor/src/editor-shell/shell-layout.tsx \
  packages/editor/src/selection-inspector/index.ts
git commit -m "feat(inspector): edit the selected token's properties"
```

---

### Task 16: Import a local font and create its preset

**Files:**
- Create: `packages/editor/src/panes/assets/font-metadata-form.tsx`
- Create: `packages/editor/src/panes/assets/font-metadata-form.dom.test.tsx`
- Modify: `packages/editor/src/panes/assets/assets-pane.tsx` (font import route)
- Modify: `packages/editor/src/asset-manager/index.ts` (`importFont`)
- Test: `packages/editor/src/asset-manager/index.dom.test.ts`

**Interfaces:**
- Produces: `AssetManager.importFont(file: File, metadata: FontMetadata): Promise<FontAssetReference>`
  where `FontMetadata = { family, weight, style, licence, sourceUrl?: string }`.
- Produces: the form's outcome
  `{ role: "heading" | "body" | "mono" | null }`; **Create type preset** writes
  the declaration, the preset and a credit with `assetId`.
- Family is prefilled from the filename with `Bold`/`Italic`/weight tokens parsed
  out; licence defaults to `unknown`; source URL may be empty.

- [ ] **Step 1: Write the failing tests**

```ts
it("imports a ttf and writes a local reference without a sourceUrl", async () => {});
it("refuses a file whose bytes do not parse as a font", async () => {});
```

```tsx
it("prefills the family from Inter-Bold.ttf and sets weight 700", () => {});
it("creates one preset and one credit carrying the assetId", async () => {});
it("keeps the file declared when the form is cancelled", async () => {});
```

- [ ] **Step 2: Run them and see them fail**

Run: `npx vitest run packages/editor/src/asset-manager/index.dom.test.ts packages/editor/src/panes/assets/font-metadata-form.dom.test.tsx`
Expected: FAIL — `importFont` and the form do not exist.

- [ ] **Step 3: Implement the import**

Validate the declared extension against `ASSET_FILE_EXTENSIONS`, parse the family
and weight tokens, declare the bytes, and write the preset only when the author
presses Create type preset. The credit carries `assetId` (Task 2) and the
declaration carries the metadata (Task 1).

- [ ] **Step 4: Run the tests to verify they pass**

Run the command from Step 2. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/editor/src/panes/assets/ \
  packages/editor/src/asset-manager/index.ts \
  packages/editor/src/asset-manager/index.dom.test.ts
git commit -m "feat(assets): import a local font as a preset"
```

---

## Phase 6 — Cleanup and the OS trash

### Task 17: Compute unused assets and prune them

**Files:**
- Create: `packages/editor/src/asset-manager/unused.ts`
- Create: `packages/editor/src/asset-manager/unused.test.ts`
- Modify: `packages/editor/src/editor-document.ts` (`unusedAssets`, `pruneAssets`)
- Test: `packages/editor/src/editor-document.dom.test.ts`

**Interfaces:**
- Produces: `unusedAssets(input: { declarations; objects; holdsAsset; creditAssetId? }): readonly LocalAssetReference[]`
  — a declaration is used when `holdsAsset(id)` or
  `assetReferencedBy(objects, id)`.
- Produces: `EditorDocument.unusedAssets(): readonly LocalAssetReference[]` and
  `EditorDocument.pruneAssets(ids: readonly string[]): void`. Prune removes the
  declarations, bytes, preview URLs and credits whose `assetId` is in `ids`;
  credits with no `assetId` are kept.

- [ ] **Step 1: Write the failing tests**

```ts
it("keeps an asset used by a placed object", () => {});
it("keeps a font used by a preset face", () => {});
it("finds an imported font nothing references", () => {});
it("prunes bytes, declarations and the linked credit", () => {});
it("keeps a credit with no assetId", () => {});
```

- [ ] **Step 2: Run them and see them fail**

Run: `npx vitest run packages/editor/src/asset-manager/unused.test.ts packages/editor/src/editor-document.dom.test.ts`
Expected: FAIL — modules/methods missing.

- [ ] **Step 3: Implement one reachability owner**

The helper is pure and takes the reachability predicates; the document supplies
them. No component walks the scene itself.

- [ ] **Step 4: Run the tests to verify they pass**

Run the command from Step 2. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/editor/src/asset-manager/unused.ts \
  packages/editor/src/asset-manager/unused.test.ts \
  packages/editor/src/editor-document.ts packages/editor/src/editor-document.dom.test.ts
git commit -m "feat(assets): find and prune unused declarations"
```

---

### Task 18: Trash asset bytes on the host

**Files:**
- Modify: `packages/host/src/themes/trash.ts` (`moveFilesToTrash`)
- Modify: `packages/host/src/server.ts` (new route beside the asset routes)
- Test: `packages/host/src/themes/trash.test.ts`
- Test: `packages/host/src/server.test.ts`

**Interfaces:**
- Produces: `moveFilesToTrash(paths: readonly string[]): Promise<void>` using the
  same platform routes as `moveToTrash`, with file variants.
- Produces: `POST /api/assets/trash` accepting
  `{ files: readonly { name: string; bytes: string /* base64 */ }[] }`; the host
  stages each under its data directory and trashes the staged file. A failure
  answers 500 with the platform reason. Loopback-only, same-origin-only.
- Produces: `theme-library-client.ts` and `asset-finder/client.ts` gain
  `trashAssets(files)`; the editor calls it before pruning.

- [ ] **Step 1: Write the failing tests**

```ts
it("builds a file trash route per platform", () => { /* windows DeleteFile, darwin Finder, linux trash-put */ });
it("refuses a same-origin-less request", async () => {});
it("aborts with the host's reason when the trash fails", async () => {});
it("trashes a staged copy and removes it from the staging directory", async () => {});
```

- [ ] **Step 2: Run them and see them fail**

Run: `npx vitest run packages/host/src/themes/trash.test.ts packages/host/src/server.test.ts`
Expected: FAIL — no file route.

- [ ] **Step 3: Implement the file trash and the route**

Keep one plan builder: `trashPlan` gains a kind parameter (`folder` | `file`) or
a sibling `fileTrashPlan`, so the platform facts are written once. The route
validates the base64 size against the existing per-asset cap before staging.

- [ ] **Step 4: Run the tests to verify they pass**

Run the command from Step 2. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/host/src/themes/trash.ts packages/host/src/themes/trash.test.ts \
  packages/host/src/server.ts packages/host/src/server.test.ts \
  packages/editor/src/theme-library-client.ts packages/editor/src/asset-finder/client.ts
git commit -m "feat(host): move unused asset bytes to the OS trash"
```

---

### Task 19: Offer cleanup on both save flows

**Files:**
- Create: `packages/editor/src/components/save-cleanup-dialog.tsx`
- Create: `packages/editor/src/components/save-cleanup-dialog.dom.test.tsx`
- Modify: `packages/editor/src/editor-document.ts` (`save`, `savePackage`)
- Modify: `packages/editor/src/theme-library-manager/index.ts` (`save`)

**Interfaces:**
- Produces: `confirmSaveCleanup(count: number, names: readonly string[]): Promise<"remove" | "keep" | "cancel">`
  — a Base UI dialog with the unchecked **Move removed fonts and assets to the
  Recycle Bin** checkbox, the warning, Cancel and Save.
- A save with no unused assets runs unchanged. `"keep"` and `"cancel"` differ:
  keep saves and preserves; cancel saves nothing.
- `"remove"` calls the host trash first; a refusal aborts the save with the
  host's message. Only after a successful trash does `pruneAssets` run.

- [ ] **Step 1: Write the failing tests**

```tsx
it("does not draw when there is nothing unused", async () => {});
it("defaults the checkbox off", () => {});
it("cancel writes nothing", async () => {});
it("keep saves and keeps the assets and credits", async () => {});
it("a refused trash aborts the save and reports the reason", async () => {});
```

- [ ] **Step 2: Run them and see them fail**

Run: `npx vitest run packages/editor/src/components/save-cleanup-dialog.dom.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the dialog and the two flows**

Both save entry points ask the same owner. The package save builds its bytes
only after the trash and prune succeed, so a failure leaves the document and the
package unchanged.

- [ ] **Step 4: Run the tests to verify they pass**

Run the command from Step 2 and `npx vitest run packages/editor/src/editor-document.dom.test.ts`.
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/editor/src/components/save-cleanup-dialog.tsx \
  packages/editor/src/components/save-cleanup-dialog.dom.test.tsx \
  packages/editor/src/editor-document.ts packages/editor/src/theme-library-manager/index.ts
git commit -m "feat(save): offer opt-in asset cleanup on both saves"
```

---

## Phase 7 — The preview modal

### Task 20: Add the asset preview modal

**Files:**
- Create: `packages/editor/src/panes/assets/preview-modal.tsx`
- Create: `packages/editor/src/panes/assets/preview-modal.dom.test.tsx`
- Modify: `packages/editor/src/panes/assets/assets-pane.tsx` (Preview action)
- Modify: `packages/editor/src/ui-copy.ts`

**Interfaces:**
- Consumes: the declaration, its bytes, `placeImage`, background media and
  `remove`.
- Produces: a Base UI dialog with no title bar; box
  `min(1132px, 100vw − 48px) × min(852px, 100vh − 48px)`; a 270px right panel;
  actions **Remove / Replace / Background / Place** as glyph plus word.
- A video renders a player, drops Place, and makes Background primary.

- [ ] **Step 1: Write the failing DOM test**

```tsx
it("draws the stage and a 270px right panel", () => {});
it("offers Remove, Replace, Background and Place for an image", () => {});
it("drops Place and draws a player for a video", () => {});
it("keeps every action label on one line at the fixed panel width", () => {});
```

- [ ] **Step 2: Run it and see it fail**

Run: `npx vitest run packages/editor/src/panes/assets/preview-modal.dom.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the modal**

Follow `assets-preview.html`: pills for File, Shape and Attribution; the status
line; the used-by and Recycle Bin note; four equal boxes with the destructive one
marked only by `--hot`.

- [ ] **Step 4: Run the test to verify it passes**

Run the command from Step 2. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/editor/src/panes/assets/ packages/editor/src/ui-copy.ts
git commit -m "feat(assets): preview an image or video before acting on it"
```

---

### Task 21: Give the theme viewer the same right panel

**Files:**
- Modify: `packages/editor/src/store-mode/item-modal.tsx`
- Modify: `packages/editor/src/ui-copy.ts` (`store.item.actions`)
- Test: `packages/editor/src/store-mode/item-modal.dom.test.tsx`

**Interfaces:**
- Consumes: the item's facts and the existing four footer actions.
- Produces: the 960px box and one stable stage height are kept; the caption band
  is removed; a 270px right panel holds name, kind, author, version, description,
  Reads/Shape/Style pills, provenance and the foot actions as glyph plus word —
  **Delete / Export / Assign / Edit**.

- [ ] **Step 1: Write the failing tests**

```tsx
it("draws a 270px right panel and no caption band", () => {});
it("keeps the 960px box and the stage's one height", () => {});
it("draws four glyph+word actions with Delete only marked in --hot", () => {});
```

- [ ] **Step 2: Run them and see them fail**

Run: `npx vitest run packages/editor/src/store-mode/item-modal.dom.test.tsx`
Expected: FAIL — the old band is still drawn and the panel is absent.

- [ ] **Step 3: Implement the panel**

Port the mockup's structure; keep the action ids and the disabled reasons
(`R164`). Update the copies in `ui-copy.ts` to the short words.

- [ ] **Step 4: Run the tests to verify they pass**

Run the command from Step 2. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/editor/src/store-mode/item-modal.tsx packages/editor/src/ui-copy.ts \
  packages/editor/src/store-mode/item-modal.dom.test.tsx
git commit -m "feat(store): move the item facts into a right panel"
```

---

### Task 22: Close the gates

**Files:**
- Modify: `docs/superpowers/specs/2026-10-08-editor-design-language-design.md` (§5.2, §5.3, §7.2 text)
- Modify: `../../../DESIGN.md` §7.2 (already moved in Task 7) and §7.3 pane titles
- Modify: `docs/design/mockups/README.md` only if a drawing changed
- Modify: `docs/evidence/screenshots/README.md` if a capture action is added
- Modify: `STATUS.md`
- Test: full gate

- [ ] **Step 1: Run the focused browser evidence**

Run the finder, Assets pane and preview specs through Playwright with the rebuilt
bundle; capture only actions registered in `docs/evidence/screenshots/README.md`.

- [ ] **Step 2: Update the design documents**

Replace the design-language spec's §5.2/§5.3/§7.2 prose with the current rule and
a link to this spec; keep §N markers unchanged. Check the mockup README's table
for any entry the implementation renamed.

- [ ] **Step 3: Run the full gate**

Run: `npm run gate`
Expected: exit 0. Record the file and test counts in `STATUS.md`'s last
completed change.

- [ ] **Step 4: Commit**

```bash
git add ../../../DESIGN.md docs/superpowers/specs/2026-10-08-editor-design-language-design.md \
  docs/design/mockups/README.md docs/evidence/screenshots/README.md STATUS.md
git commit -m "docs(design): record the fonts and assets surfaces"
```

---

## Self-Review

- **Spec coverage:** R1–R3 → Tasks 7–9; R4 → Task 9; R5–R8 → Tasks 10–13; R9–R10
  → Tasks 12, 14–16; R11 → Tasks 4–6; R12–R13 → Tasks 2, 17–19; R14 → Tasks 20–21.
  Schema and wire → Tasks 1, 3.
- **Type consistency:** `FontCut` / `FontTrioInfo` are defined once (Task 3) and
  consumed by Tasks 4, 5, 6, 11, 12, 16. `FontAssetFormat` and `FontFormat` carry
  the same four values and are deliberately separate: the wire can gain a format
  the persisted schema refuses. `unusedAssets` and `pruneAssets` are named once.
- **Review Focus tests:** provider failure → Tasks 5, 6, 12; local TTF → Tasks 1,
  16; refused trash → Tasks 18, 19; WIP cleanup off → Tasks 17, 19; portrait
  preview → Tasks 20, 21.
- **Proportion:** the plan names signatures, files and tests; it does not
  transcribe component bodies.
