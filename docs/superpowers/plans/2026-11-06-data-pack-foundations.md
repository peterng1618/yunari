# Data-Pack Foundations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make widget packs, the starter theme, and path-preset packs installable data, with the host as the one owner of installed packs and the one list of path presets.

**Architecture:** `@yunari/theme-package` keeps owning the package containers and gains a file-map reader so bundled data uses the same validation as a zip. `@yunari/theme-kit` keeps the copy/remap mechanism but loses `CARD_LIBRARY`; units now come from packaged documents. The host stores installed widget packs and path presets under its settings directory and serves both. The editor and MCP read the same host rows.

**Tech Stack:** TypeScript, Fabric JSON, `fflate` through `@yunari/theme-package`, Node `fs/promises`, React, Vitest. No new runtime dependency.

**Spec:** `docs/superpowers/specs/2026-11-06-extension-platform-design.md`

## Global Constraints

- Theme schema stays `2.0.0`; no second scene model and no migration.
- Widget packages keep the `yunari-widget-package` container. Path-preset packs use `yunari-path-preset-pack` JSON v1.
- Built-in path presets stay bundled data. User presets keep `user:` ids. Pack presets use `pack:<packId>:<presetId>`.
- Removing a pack or a built-in removes only that pack's presets or that built-in id; user presets are never touched.
- The starter template id stays `yunari-starter-template`. A saved theme is never rewritten.
- `createStarterTheme`, `theme-kit/src/cards.ts`, `CARD_LIBRARY`, `editor/src/starter-backdrop.ts`, and the starter branch of `createNewFabricTheme` are deleted, not kept behind a flag.
- Pack and preset writes are loopback-only and origin-checked. Reads follow the existing host route rules.
- No fabricated content: a package that fails validation is refused whole, never partially installed.
- Run every npm command from `src/web/`. `npm run gate` must exit 0 without network access.

## Review Focus

- A widget package with two units that share an object id: each unit's insertion must mint ids from its own subtree only, and a unit must not carry another unit's bindings.
- A package asset id or path collides with the document's own: insertion must remap every object reference and adopt the bytes under fresh ids, never overwrite the incumbent.
- A path-preset pack carries malformed or zero-extent path data: install must refuse before writing, and the existing preset list must be byte-for-byte unchanged.
- The host is unavailable during migration: the editor must keep the localStorage list, retry on the next boot, and never delete the local copy first.
- Removing a pack, a built-in, or a user preset: only the named row disappears; restoring built-ins must not restore user rows or another pack's rows.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/web/packages/theme-package/src/index.ts` | Widget package manifest units; `readWidgetPackageFiles`; shared file-map reader. |
| `src/web/packages/theme-package/src/path-preset-pack.ts` | `yunari-path-preset-pack` v1 structural reader. |
| `src/web/packages/theme-kit/src/card-library.ts` | `CardUnit` becomes data-backed; copy/remap stays; `CARD_LIBRARY` and `cardBindings` are removed. |
| `src/web/packages/theme-kit/src/widget-unit.ts` | `cardUnitFromWidget` conversion from a packaged unit. |
| `src/web/packages/scene-fabric/src/path-preset.ts` | Fabric `Path` parse, extent, and closed-path rule for presets. |
| `src/web/packages/editor/src/asset-manager/index.ts` | `adoptPackaged` adopts a widget pack's assets under fresh ids/paths. |
| `src/web/packages/host/src/packs/widget-packs.ts` | Installed widget-pack store: list, read bytes, install, remove. |
| `src/web/packages/host/src/packs/bundled-default-pack.ts` | The bundled default widget pack as package files. |
| `src/web/packages/host/src/presets/path-presets.ts` | Host-owned preset list, pack install, migration, removal. |
| `src/web/packages/host/src/server/pack-routes.ts` | `/api/widget-packs` and `/api/path-presets` routes. |
| `src/web/packages/editor/src/widget-packs.ts` | Editor client and live installed-unit store. |
| `src/web/packages/editor/src/path-presets.ts` | Host-backed preset client plus one-time localStorage migration. |
| `src/web/packages/editor/src/new-fabric-theme.ts` | Bundled starter loaded through the package reader; blank theme literal. |
| `src/web/packages/mcp/src/tools/compose.ts` | `add_card` reads host widget units, not `CARD_LIBRARY`. |

---

### Task 1: Record the data-pack reuse decision

**Files:**
- Create: `docs/decisions/0111-data-pack-foundations.md`

**Interfaces:**
- Consumes: the spec's `Data packs` and `Security invariants` sections.
- Produces: exact `Paths:` claims that unblock writes under `theme-package`, `theme-kit`, `scene-fabric`, `host/src/packs`, `host/src/presets`, `editor`, and `mcp`.

- [ ] **Step 1: Write the decision note**

Use `docs/decisions/README.md`. Header:

```markdown
# 0111 — data-pack foundations

- **Date:** 2026-11-06
- **Status:** accepted
- **Paths:** `src/web/packages/theme-package/src/index.ts`
  `src/web/packages/theme-package/src/path-preset-pack.ts`
  `src/web/packages/theme-kit/src/card-library.ts`
  `src/web/packages/theme-kit/src/widget-unit.ts`
  `src/web/packages/scene-fabric/src/path-preset.ts`
  `src/web/packages/editor/src/asset-manager/index.ts`
  `src/web/packages/editor/src/widget-packs.ts`
  `src/web/packages/editor/src/path-presets.ts`
  `src/web/packages/editor/src/new-fabric-theme.ts`
  `src/web/packages/editor/src/new-object-panel.ts`
  `src/web/packages/editor/src/settings-mode/pages/path-presets-page.tsx`
  `src/web/packages/host/src/packs/widget-packs.ts`
  `src/web/packages/host/src/packs/bundled-default-pack.ts`
  `src/web/packages/host/src/presets/path-presets.ts`
  `src/web/packages/host/src/server/pack-routes.ts`
  `src/web/packages/mcp/src/tools/compose.ts`
```

Fill rungs 1–6: existing package reader and `instantiateCard` are the owners; `fflate` is already installed; native `fs` and JSON are enough; public prior art is the existing theme package and Orca's data-pack separation; the probe is Task 2's file-map reader against a real exported widget package; the decision is reuse the container and extend the reader.

- [ ] **Step 2: Verify the hook accepts the claims**

Run from the repository root:

```bash
echo '{"tool_input":{"file_path":"src/web/packages/theme-package/src/index.ts"}}' | node scripts/reuse-gate.mjs
echo "exit=$?"
```

Expected: `exit=0`.

- [ ] **Step 3: Commit**

```bash
git add docs/decisions/0111-data-pack-foundations.md
git commit -m "docs(decisions): authorise data-pack foundations

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 2: Read widget packages as units through a file map

**Files:**
- Modify: `src/web/packages/theme-package/src/index.ts`
- Test: `src/web/packages/theme-package/src/widget-package.test.ts`

**Interfaces:**
- Consumes: existing `WidgetDocument`, `readWidgetPackage`, `checkDeclaredAssets`.
- Produces:

```ts
export interface WidgetPackUnitRef {
  readonly id: string;
  readonly label: string;
  readonly objectId: string;
}

export interface WidgetUnit {
  readonly id: string;
  readonly label: string;
  readonly document: WidgetDocument;
  readonly declarations: readonly AssetReference[];
  readonly assets: Readonly<Record<string, Uint8Array>>;
}

export type WidgetPackageResult =
  | {
      readonly ok: true;
      readonly document: WidgetDocument;
      readonly assets: Readonly<Record<string, Uint8Array>>;
      readonly units: readonly WidgetUnit[];
      readonly name: string | undefined;
      readonly version: string | undefined;
    }
  | { readonly ok: false; readonly message: string };

export function readWidgetPackageFiles(
  files: Readonly<Record<string, Uint8Array>>,
): WidgetPackageResult;
```

Unit derivation rules:

1. A manifest `units` array is authoritative. Each `objectId` must name a top-level scene object; a missing object or a duplicate `id` refuses the package.
2. Without `units`, every top-level object carrying `provenance.widgetId` is one unit. `provenance.widgetName` is the label, falling back to `widgetId`.
3. A unit's document keeps the package document's `schemaVersion`, `fabricVersion`, `id`, `metadata`, and `globals`; its `scene.objects` is the one unit's subtree; its `bindings` is filtered to the subtree's ids; its `assets` is the declarations the subtree references.
4. `assets` on the unit is the package's asset bytes for exactly those declarations.
5. `name` is `document.metadata.name`; `version` is `document.metadata.version`.

- [ ] **Step 1: Write the failing test**

In `widget-package.test.ts`, add:

```ts
it("reads two provenance units from one package", () => {
  const result = readWidgetPackageFiles(
    widgetFiles({
      objects: [
        groupWithProvenance("a", "Alpha"),
        groupWithProvenance("b", "Beta"),
      ],
    }),
  );
  assert(result.ok);
  expect(result.units.map((unit) => [unit.id, unit.label])).toEqual([
    ["a", "Alpha"],
    ["b", "Beta"],
  ]);
  expect(result.units[0]?.document.scene["objects"]).toHaveLength(1);
  expect(result.units[0]?.document.bindings).toHaveProperty("a");
  expect(result.units[0]?.document.bindings).not.toHaveProperty("b");
});

it("refuses a manifest unit naming no top-level object", () => {
  const result = readWidgetPackageFiles(
    widgetFiles({
      objects: [groupWithProvenance("a", "Alpha")],
      manifestUnits: [{ id: "missing", label: "Missing", objectId: "nope" }],
    }),
  );
  expect(result).toEqual({
    ok: false,
    message: 'Widget unit "missing" names no top-level object "nope".',
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd src/web
npx vitest run packages/theme-package/src/widget-package.test.ts
```

Expected: FAIL because `readWidgetPackageFiles` is not exported.

- [ ] **Step 3: Implement the file-map reader and unit derivation**

Move the body of `readWidgetPackage` after unzip into `readWidgetPackageFiles(files)`. Parse the manifest into `WidgetPackageManifest` with the optional `units` field, validate it strictly, then derive units with a subtree walk. `readWidgetPackage(bytes)` calls `readPackageArchive` and delegates. Keep the existing path and asset checks.

- [ ] **Step 4: Run the package suite**

```bash
npx vitest run packages/theme-package/src
```

Expected: PASS, including the existing theme and widget package tests.

- [ ] **Step 5: Commit**

```bash
git add src/web/packages/theme-package/src/index.ts src/web/packages/theme-package/src/widget-package.test.ts
git commit -m "feat(theme-package): read widget packages as units

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 3: Make `CardUnit` data-backed and asset-aware

**Files:**
- Modify: `src/web/packages/theme-kit/src/card-library.ts`
- Modify: `src/web/packages/theme-kit/src/index.ts`
- Create: `src/web/packages/theme-kit/src/widget-unit.ts`
- Test: `src/web/packages/theme-kit/src/card-library.test.ts`
- Test: `src/web/packages/theme-kit/src/widget-unit.test.ts`

**Interfaces:**
- Consumes: `WidgetUnit` from Task 2; `YUNARI_ASSET_PROPERTY` from `@yunari/scene-fabric`.
- Produces:

```ts
export interface CardUnit {
  readonly id: string;
  readonly label: string;
  readonly diagram: string;
  readonly build: () => ObjectJson;
  /** The unit's own readings, keyed by authored object id. */
  readonly bindings?: Readonly<Record<string, readonly Binding[]>>;
}

export function cardUnitFromWidget(unit: WidgetUnit): CardUnit;

export interface InstantiateCardOptions {
  readonly unit: CardUnit;
  readonly globals: FabricGlobals | undefined;
  readonly existingIds: Iterable<string>;
  readonly existingBindingIds?: Iterable<string>;
  /** Package asset id -> the id the destination document adopted. */
  readonly assetIds?: ReadonlyMap<string, string>;
  readonly origin: { readonly left: number; readonly top: number };
}
```

Rules:

- `instantiateCard` reads `options.unit.bindings ?? {}`; it never reads `STARTER_BINDINGS`.
- `copyObject` rewrites a `YUNARI_ASSET_PROPERTY` value `{ assetId }` through `options.assetIds` when present. A reference with no mapping is left unchanged, so a missing asset is a visible missing asset rather than a silent rewrite.
- `cardUnitFromWidget` returns `build: () => unit.document.scene.objects[0]` and `bindings: unit.document.bindings`.
- `CARD_LIBRARY`, `CARD_LABELS`, `CardDiagram`, and `cardBindings` are deleted from `card-library.ts`.

- [ ] **Step 1: Write the failing tests**

In `card-library.test.ts`:

```ts
it("carries the unit's own bindings", () => {
  const unit: CardUnit = {
    id: "group-cpu-card",
    label: "CPU",
    diagram: "cpu",
    build: () => group("group-cpu-card", "cpu.load"),
    bindings: { "group-cpu-card": [{ id: "cpu-binding", semanticKey: "cpu.load" }] },
  };
  const copy = instantiateCard({
    unit,
    globals: undefined,
    existingIds: [],
    origin: { left: 0, top: 0 },
  });
  expect(copy.bindings["card-group-cpu-card"]?.[0]?.semanticKey).toBe("cpu.load");
});
```

In `widget-unit.test.ts`:

```ts
it("remaps a packaged asset reference", () => {
  const copy = instantiateCard({
    unit: cardUnitFromWidget(unitWithAsset("asset-a")),
    globals: undefined,
    existingIds: [],
    assetIds: new Map([["asset-a", "asset-b"]]),
    origin: { left: 0, top: 0 },
  });
  expect(copy.card[YUNARI_ASSET_PROPERTY]).toEqual({ assetId: "asset-b" });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run packages/theme-kit/src/card-library.test.ts packages/theme-kit/src/widget-unit.test.ts
```

Expected: FAIL because the new fields and module do not exist.

- [ ] **Step 3: Implement the data-backed unit**

Change `CardUnit`, delete `CARD_LIBRARY` and `cardBindings`, read bindings from the unit, and remap asset references in `copyObject`. Add `widget-unit.ts` and export it from `theme-kit/src/index.ts`.

- [ ] **Step 4: Run the theme-kit suite**

```bash
npx vitest run packages/theme-kit/src
```

Expected: PASS. Any test that imported `CARD_LIBRARY` is updated to build a unit literal; the copy behaviour assertions stay.

- [ ] **Step 5: Commit**

```bash
git add src/web/packages/theme-kit/src
git commit -m "feat(theme-kit): insert packaged widget units

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 4: Adopt a widget pack's assets without collisions

**Files:**
- Modify: `src/web/packages/editor/src/asset-manager/index.ts`
- Test: `src/web/packages/editor/src/asset-manager/adopt-packaged.test.ts`

**Interfaces:**
- Consumes: `AssetReference` declarations, `Uint8Array` bytes, existing `sha256`, `#allocate`, `#mutated`.
- Produces:

```ts
adoptPackaged(
  declarations: readonly AssetReference[],
  assets: Readonly<Record<string, Uint8Array>>,
): Promise<ReadonlyMap<string, string>>;
```

Rules: verify each declared path exists and its SHA-256 matches; allocate a fresh id/path when either collides; keep `sourceUrl`, `license`, and font metadata; return `package asset id -> adopted asset id`. A missing path or digest mismatch throws before any declaration is added.

- [ ] **Step 1: Write the failing test**

```ts
it("adopts a colliding asset under a fresh id and path", async () => {
  const manager = new AssetManager();
  await manager.import(file("assets/card.png", PNG_BYTES));
  const adopted = await manager.adoptPackaged(
    [{ id: "card-image", kind: "image", path: "assets/card.png", sha256: SHA }],
    { "assets/card.png": PNG_BYTES },
  );
  expect(adopted.get("card-image")).not.toBe("card-image");
  expect(manager.declarations).toHaveLength(2);
  expect(manager.declarations[1]?.path).not.toBe("assets/card.png");
});

it("refuses bytes whose digest does not match", async () => {
  await expect(
    new AssetManager().adoptPackaged(
      [{ id: "x", kind: "image", path: "assets/x.png", sha256: "00" }],
      { "assets/x.png": PNG_BYTES },
    ),
  ).rejects.toThrow("does not match");
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run packages/editor/src/asset-manager/adopt-packaged.test.ts
```

Expected: FAIL because `adoptPackaged` does not exist.

- [ ] **Step 3: Implement `adoptPackaged`**

Validate every declaration first, then allocate ids and paths, write bytes, and call `#mutated()` once. Return the id map.

- [ ] **Step 4: Run the asset-manager suite**

```bash
npx vitest run packages/editor/src/asset-manager
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/web/packages/editor/src/asset-manager
git commit -m "feat(editor): adopt widget-pack assets on insert

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 5: Store and serve installed widget packs

**Files:**
- Create: `src/web/packages/host/src/packs/widget-packs.ts`
- Create: `src/web/packages/host/src/server/pack-routes.ts`
- Modify: `src/web/packages/host/src/server/options.ts`
- Modify: `src/web/packages/host/src/server.ts`
- Modify: `src/web/packages/host/src/main.ts`
- Test: `src/web/packages/host/src/packs/widget-packs.test.ts`
- Test: `src/web/packages/host/src/server/pack-routes.test.ts`

**Interfaces:**
- Consumes: `readWidgetPackage` from Task 2.
- Produces:

```ts
export interface WidgetPackSummary {
  readonly id: string;
  readonly name: string;
  readonly version: string | undefined;
  readonly units: readonly { readonly id: string; readonly label: string }[];
}

export interface WidgetPackStore {
  list(): Promise<readonly WidgetPackSummary[]>;
  read(id: string): Promise<Uint8Array | undefined>;
  install(bytes: Uint8Array): Promise<
    | { readonly ok: true; readonly pack: WidgetPackSummary }
    | { readonly ok: false; readonly message: string }
  >;
  remove(id: string): Promise<void>;
}

export function createWidgetPackStore(
  directory: string,
  options?: { readonly bundled?: readonly Uint8Array[] },
): WidgetPackStore;
```

Routes:

- `GET /api/widget-packs` -> `{ packs: WidgetPackSummary[] }`.
- `GET /api/widget-packs/:id` -> `application/zip` bytes.
- `POST /api/widget-packs/import` -> raw zip bytes up to 64 MiB, loopback and origin checked, answers `{ ok: true, pack }`; a larger body is 413 before unzip.
- `DELETE /api/widget-packs/:id` -> loopback only, answers `{ ok: true }`.

Storage: one directory per pack under `<settingsDir>/widget-packs/<packId>/package.zip`. `packId` is `document.id`; a pack whose id is already installed is replaced only when the incoming document id matches and the caller is a local import. The bundled default pack is a list of package zips, read at startup, never written to disk.

- [ ] **Step 1: Write the failing tests**

```ts
it("installs, lists, reads and removes a widget pack", async () => {
  const store = createWidgetPackStore(dir);
  const installed = await store.install(widgetPackageBytes());
  assert(installed.ok);
  expect((await store.list()).map((pack) => pack.id)).toEqual(["pack-one"]);
  expect(await store.read("pack-one")).toEqual(widgetPackageBytes());
  await store.remove("pack-one");
  expect(await store.list()).toEqual([]);
});

it("refuses an invalid package without writing a directory", async () => {
  const store = createWidgetPackStore(dir);
  expect(await store.install(new Uint8Array([1, 2, 3]))).toMatchObject({ ok: false });
  expect(await readdir(dir).catch(() => [])).toEqual([]);
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run packages/host/src/packs/widget-packs.test.ts packages/host/src/server/pack-routes.test.ts
```

Expected: FAIL because the store and routes do not exist.

- [ ] **Step 3: Implement the store and routes**

Write each package to a temp directory then rename it into place. On list, read every `package.zip`; a directory whose bytes no longer validate is skipped and reported through the existing error path, never served. Add `widgetPacks?: WidgetPackStore` to `HostServerOptions`, create the store in `main.ts` with the bundled pack, and call `handlePackRoutes` from `createHostServer`.

- [ ] **Step 4: Run host tests**

```bash
npx vitest run packages/host/src/packs packages/host/src/server/pack-routes.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/web/packages/host/src/packs src/web/packages/host/src/server/pack-routes.ts src/web/packages/host/src/server/options.ts src/web/packages/host/src/server.ts src/web/packages/host/src/main.ts
git commit -m "feat(host): store and serve installed widget packs

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 6: Read installed widget units in the Add pane and MCP

**Files:**
- Create: `src/web/packages/editor/src/widget-packs.ts`
- Modify: `src/web/packages/editor/src/new-object-panel.ts`
- Modify: `src/web/packages/editor/src/card-library.ts`
- Modify: `src/web/packages/editor/src/editor-document.ts`
- Modify: `src/web/packages/editor/src/editor-main.ts`
- Modify: `src/web/packages/mcp/src/host-client.ts`
- Modify: `src/web/packages/mcp/src/tools/compose.ts`
- Test: `src/web/packages/editor/src/widget-packs.test.ts`
- Test: `src/web/packages/editor/src/card-insert-surfaces.dom.test.tsx`
- Test: `src/web/packages/mcp/src/tools/compose.test.ts`

**Interfaces:**
- Consumes: `/api/widget-packs` and `/api/widget-packs/:id`; `readWidgetPackage`; `cardUnitFromWidget`.
- Produces:

```ts
export interface InstalledWidgetUnit {
  readonly id: string;
  readonly label: string;
  readonly diagram: string;
  readonly packId: string;
  readonly unit: CardUnit;
  readonly declarations: readonly AssetReference[];
  readonly assets: Readonly<Record<string, Uint8Array>>;
}

export async function loadWidgetUnits(
  fetcher?: typeof fetch,
): Promise<readonly InstalledWidgetUnit[]>;
export function activeWidgetUnits(): readonly InstalledWidgetUnit[];
export function subscribeWidgetUnits(listener: () => void): () => void;
export function widgetUnitKey(): string;
```

`insertGroups()` uses `activeWidgetUnits()` in place of `CARD_LIBRARY`. `insertCard` resolves a unit from the same store and passes `unit.unit`. If the unit carries assets, it calls `assetManager.adoptPackaged` first and passes the returned id map as `assetIds`. `editor-main` calls `loadWidgetUnits()` once at boot and after a pack import.

MCP `HostClient` gains:

```ts
listWidgetPacks(): Promise<readonly WidgetPackSummary[]>;
readWidgetPack(id: string): Promise<Uint8Array>;
```

`addCard` finds the unit by id across installed packs, reads its pack, and calls `cardUnitFromWidget`.

- [ ] **Step 1: Write the failing tests**

Editor store test:

```ts
it("loads units from two packs and refuses a duplicate unit id", async () => {
  const units = await loadWidgetUnits(fetchReturning(twoPacks()));
  expect(units.map((unit) => unit.id)).toEqual(["a", "b"]);
  await expect(loadWidgetUnits(fetchReturning(duplicatePacks()))).rejects.toThrow(
    "more than one installed pack",
  );
});
```

DOM test: open the Add pane and assert the card tiles are the installed labels, not `"CPU"` from the old constant.

MCP test: `add_card` with `unit: "a"` adds the packaged group and its binding.

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run packages/editor/src/widget-packs.test.ts packages/editor/src/card-insert-surfaces.dom.test.tsx packages/mcp/src/tools/compose.test.ts
```

Expected: FAIL because the store and host client methods do not exist.

- [ ] **Step 3: Implement the client, store, and MCP read**

Fetch pack summaries, then each pack's zip, call `readWidgetPackage`, and convert each unit with `cardUnitFromWidget`. Reject duplicate unit ids across packs. Replace every `CARD_LIBRARY` use.

- [ ] **Step 4: Run the editor and MCP suites**

```bash
npx vitest run packages/editor/src packages/mcp/src
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/web/packages/editor/src/widget-packs.ts src/web/packages/editor/src/new-object-panel.ts src/web/packages/editor/src/card-library.ts src/web/packages/editor/src/editor-document.ts src/web/packages/editor/src/editor-main.ts src/web/packages/mcp/src/host-client.ts src/web/packages/mcp/src/tools/compose.ts
git commit -m "feat: read widget units from installed packs

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 7: Bundle the default pack and the starter theme as data

**Files:**
- Create: `src/web/packages/host/src/packs/bundled-default-pack.ts`
- Create: `src/web/packages/host/src/packs/default.widgets.zip` (committed data)
- Create: `src/web/packages/editor/src/bundled/starter.theme.zip` (committed data)
- Create: `src/web/packages/editor/src/bundled/starter.ts`
- Modify: `src/web/packages/editor/src/new-fabric-theme.ts`
- Modify: `src/web/packages/editor/src/editor-main.ts`
- Modify: `src/web/packages/theme-kit/src/starter.ts`
- Modify: `src/web/packages/theme-kit/src/index.ts`
- Delete: `src/web/packages/theme-kit/src/cards.ts`
- Delete: `src/web/packages/editor/src/starter-backdrop.ts`
- Delete: `src/web/packages/editor/src/starter-backdrop.jpg`
- Test: `src/web/packages/editor/src/new-fabric-theme.test.ts`
- Test: `src/web/packages/theme-kit/src/starter.test.ts`

**Interfaces:**
- Consumes: `readThemePackage` and `readWidgetPackageFiles`.
- Produces:

```ts
export function bundledStarterEnvelope(): FabricThemeEnvelope;
export function bundledStarterAssets(): Readonly<Record<string, Uint8Array>>;
export async function loadBundledStarter(fetcher?: typeof fetch): Promise<void>;
```

Rules:

- `starter.theme.zip` is a normal `yunari-theme-package` whose `theme.json` is the current `createStarterTheme({ backdrop: starterBackdrop })` output and whose asset is the existing backdrop photograph. Generate it once from the current generator, commit the zip, then delete the generator.
- `new-fabric-theme.ts` no longer imports `createStarterTheme` or `starter-backdrop`. `createNewFabricTheme()` returns `bundledStarterEnvelope()`. `createBlankFabricTheme` is a literal envelope with the minimal palette, the starter's type tokens, no scene objects, and no assets.
- `loadBundledStarter` fetches the committed zip URL, calls `readThemePackage`, and stores the envelope and assets. `editor-main` awaits it once before any document is created.
- `createStarterTheme` is deleted. `createBlankTheme` stays in `theme-kit/src/starter.ts` as a literal builder over `BLANK_PALETTE` and the literal type tokens; it imports no starter composition and no `cards.ts`.

- [ ] **Step 1: Write the failing tests**

```ts
it("opens the starter from the bundled package", async () => {
  await loadBundledStarter(fetchZip("starter.theme.zip"));
  const envelope = bundledStarterEnvelope();
  expect(envelope.id).toBe("yunari-starter-template");
  expect(envelope.scene.objects).toHaveLength(8);
  expect(Object.keys(bundledStarterAssets())).toEqual([
    "assets/starter-backdrop.jpg",
  ]);
});

it("imports no generator module", () => {
  const source = readFileSync("packages/editor/src/new-fabric-theme.ts", "utf8");
  expect(source).not.toContain("createStarterTheme");
  expect(source).not.toContain("starter-backdrop");
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run packages/editor/src/new-fabric-theme.test.ts packages/theme-kit/src/starter.test.ts
```

Expected: FAIL because the bundled loader does not exist.

- [ ] **Step 3: Generate and commit the bundled data, then delete the generators**

Run the current editor once to export the starter package and the default widget pack to scratch outside the repository. Copy the two archives into `packages/editor/src/bundled/` and `packages/host/src/packs/` respectively. Then delete `cards.ts`, `CARD_LIBRARY`, `starter-backdrop.ts`, and the starter branch. Update `theme-kit/src/index.ts` exports.

- [ ] **Step 4: Run the editor and theme-kit suites**

```bash
npx vitest run packages/editor/src packages/theme-kit/src
```

Expected: PASS, including the starter round-trip and card insertion tests.

- [ ] **Step 5: Commit**

```bash
git add src/web/packages/editor/src/bundled src/web/packages/editor/src/new-fabric-theme.ts src/web/packages/editor/src/editor-main.ts src/web/packages/theme-kit/src src/web/packages/host/src/packs/bundled-default-pack.ts
git rm src/web/packages/theme-kit/src/cards.ts src/web/packages/editor/src/starter-backdrop.ts src/web/packages/editor/src/starter-backdrop.jpg
git commit -m "feat: bundle the starter theme and default widget pack

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 8: Define and store path-preset packs

**Files:**
- Create: `src/web/packages/theme-package/src/path-preset-pack.ts`
- Modify: `src/web/packages/theme-package/src/index.ts`
- Create: `src/web/packages/scene-fabric/src/path-preset.ts`
- Create: `src/web/packages/host/src/presets/path-presets.ts`
- Test: `src/web/packages/theme-package/src/path-preset-pack.test.ts`
- Test: `src/web/packages/scene-fabric/src/path-preset.test.ts`
- Test: `src/web/packages/host/src/presets/path-presets.test.ts`

**Interfaces:**
- Consumes: existing `userPathPresetFrom` rules; Fabric `Path`; `hasClosedPath`.
- Produces:

```ts
export interface PathPresetPack {
  readonly format: "yunari-path-preset-pack";
  readonly version: 1;
  readonly id: string;
  readonly name: string;
  readonly presets: readonly {
    readonly id: string;
    readonly label: string;
    readonly data: string;
    readonly paint: "stroke" | "fill";
  }[];
}

export interface PathPreset {
  readonly id: string;
  readonly label: string;
  readonly data: string;
  readonly paint: "stroke" | "fill";
}

export interface PathPresetState {
  readonly version: 1;
  readonly presets: readonly PathPreset[];
  readonly removedBuiltins: readonly string[];
  readonly migrated: boolean;
}

export function readPathPresetPack(value: unknown):
  | { readonly ok: true; readonly pack: PathPresetPack }
  | { readonly ok: false; readonly message: string };

export function pathPresetGeometry(data: string):
  | { readonly ok: true; readonly width: number; readonly height: number; readonly paint: "stroke" | "fill" }
  | { readonly ok: false; readonly reason: "unreadable" | "empty" };
```

Host store (`PathPreset` and `PathPresetState` are imported from `@yunari/theme-package`):

```ts
export interface PathPresetStore {
  read(): Promise<PathPresetState>;
  addUser(input: { label: string; data: string }): Promise<PathPreset>;
  addPack(bytes: Uint8Array): Promise<{ readonly packId: string; readonly presets: readonly PathPreset[] }>;
  remove(id: string): Promise<void>;
  removeBuiltin(id: string): Promise<void>;
  restoreBuiltins(): Promise<void>;
  removePack(packId: string): Promise<void>;
  migrate(input: { presets: readonly PathPreset[]; removedBuiltins: readonly string[] }): Promise<PathPresetState>;
}
export function createPathPresetStore(
  directory: string,
  builtins: readonly PathPreset[],
): PathPresetStore;
```

Rules: pack preset ids are `pack:<packId>:<presetId>`; user ids are `user:` plus the slug of the label, with a numeric suffix on collision; built-in ids are untouched strings. `addPack` validates the whole pack and every path before writing. `removePack` deletes only rows whose id starts with `pack:<packId>:`. `migrate` writes once and sets `migrated: true`.

- [ ] **Step 1: Write the failing tests**

```ts
it("installs a pack under namespaced ids and removes only that pack", async () => {
  const store = createPathPresetStore(dir);
  await store.addUser({ label: "Mine", data: "M 0 0 L 10 10" });
  await store.addPack(pathPackBytes("acme", [{ id: "wave", label: "Wave", data: "M 0 0 L 10 10 Z" }]));
  expect((await store.read()).presets.map((preset) => preset.id)).toEqual([
    "user:mine",
    "pack:acme:wave",
  ]);
  await store.removePack("acme");
  expect((await store.read()).presets.map((preset) => preset.id)).toEqual(["user:mine"]);
});

it("refuses a pack whose path draws nothing", async () => {
  await expect(store.addPack(pathPackBytes("bad", [{ id: "empty", label: "Empty", data: "M 0 0" }]))).rejects.toThrow("draws nothing");
  expect(await store.read()).toEqual({ version: 1, presets: [], removedBuiltins: [], migrated: false });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run packages/theme-package/src/path-preset-pack.test.ts packages/scene-fabric/src/path-preset.test.ts packages/host/src/presets/path-presets.test.ts
```

Expected: FAIL because the readers and store do not exist.

- [ ] **Step 3: Implement the readers and store**

`readPathPresetPack` validates format, version, id, name, and each preset's shape. `pathPresetGeometry` parses with `new Path(data)`, refuses no extent on both axes, and derives paint with `hasClosedPath`. The host store uses `createJsonFile<PathPresetState>(directory, "path-presets.json", ...)` and validates paths before any write.

- [ ] **Step 4: Run the three suites**

```bash
npx vitest run packages/theme-package/src packages/scene-fabric/src/path-preset.test.ts packages/host/src/presets
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/web/packages/theme-package/src/path-preset-pack.ts src/web/packages/theme-package/src/index.ts src/web/packages/scene-fabric/src/path-preset.ts src/web/packages/host/src/presets
git commit -m "feat: add path-preset packs

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 9: Serve path presets and migrate browser storage once

**Files:**
- Modify: `src/web/packages/host/src/server/pack-routes.ts`
- Modify: `src/web/packages/editor/src/path-presets.ts`
- Modify: `src/web/packages/editor/src/settings-mode/pages/path-presets-page.tsx`
- Modify: `src/web/packages/editor/src/editor-main.ts`
- Test: `src/web/packages/host/src/server/pack-routes.test.ts`
- Test: `src/web/packages/editor/src/path-presets.test.ts`
- Test: `src/web/packages/editor/src/settings-mode/editor-pages.dom.test.tsx`

**Interfaces:**
- Consumes: `PathPresetStore` from Task 8.
- Produces:

```ts
// host routes
GET    /api/path-presets              -> PathPresetState
POST   /api/path-presets              { label, data } -> PathPreset
POST   /api/path-presets/packs        raw pack bytes -> { packId, presets }
DELETE /api/path-presets/:id          -> { ok: true }
POST   /api/path-presets/builtins/:id/remove -> { ok: true }
POST   /api/path-presets/builtins/restore   -> { ok: true }
DELETE /api/path-presets/packs/:packId      -> { ok: true }
POST   /api/path-presets/migrate      { presets, removedBuiltins } -> PathPresetState

// editor; `PathPresetState` comes from `@yunari/theme-package`
export async function loadPathPresets(
  fetcher?: typeof fetch,
  storage?: Storage,
): Promise<PathPresetState>;
export async function addPathPreset(label: string, data: string): Promise<UserPathPreset>;
export async function removePathPreset(id: string): Promise<void>;
export async function removeBuiltinPathPreset(id: string): Promise<void>;
export async function restoreBuiltinPathPresets(): Promise<void>;
export async function installPathPresetPack(bytes: Uint8Array): Promise<void>;
export async function removePathPresetPack(packId: string): Promise<void>;
```

Migration rule: on boot, read `USER_PATH_PRESETS_STORAGE_KEY` and `REMOVED_PATH_PRESETS_STORAGE_KEY`. If either is non-empty and the host state is not `migrated`, POST both to `/api/path-presets/migrate`. Only after a successful answer clear both local keys. On failure keep them and retry next boot.

- [ ] **Step 1: Write the failing tests**

Host route test: POST a valid pack, GET state, DELETE the pack, assert the user preset remains.

Editor migration test:

```ts
it("keeps browser presets when the host refuses migration", async () => {
  const storage = memoryStorage({
    "yunari.editor.path-presets": JSON.stringify([mine]),
    "yunari.editor.removed-path-presets": JSON.stringify(["star"]),
  });
  await expect(loadPathPresets(fetchFailing(), storage)).resolves.toEqual({
    version: 1,
    presets: [mine],
    removedBuiltins: ["star"],
    migrated: false,
  });
  expect(storage.getItem("yunari.editor.path-presets")).not.toBeNull();
});

it("clears browser presets only after the host accepts them", async () => {
  await loadPathPresets(fetchAcceptingMigration(), storage);
  expect(storage.getItem("yunari.editor.path-presets")).toBeNull();
  expect(storage.getItem("yunari.editor.removed-path-presets")).toBeNull();
});
```

DOM test: the Settings page lists host presets and the Add pane inserts a pack preset.

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run packages/host/src/server/pack-routes.test.ts packages/editor/src/path-presets.test.ts packages/editor/src/settings-mode/editor-pages.dom.test.tsx
```

Expected: FAIL because the host routes and host-backed client do not exist.

- [ ] **Step 3: Implement the routes and host-backed preset store**

Keep the existing `userPathPresetFrom` validation in the editor for immediate feedback; the host repeats it because the route is a trust boundary. Writes are loopback and origin checked. The editor store keeps the same `activeUserPathPresets`, subscription, and revision APIs so the Add pane and Settings page need only a source change.

- [ ] **Step 4: Run the suites**

```bash
npx vitest run packages/host/src/server/pack-routes.test.ts packages/editor/src/path-presets.test.ts packages/editor/src/settings-mode
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/web/packages/host/src/server/pack-routes.ts src/web/packages/editor/src/path-presets.ts src/web/packages/editor/src/settings-mode/pages/path-presets-page.tsx src/web/packages/editor/src/editor-main.ts
git commit -m "feat: host path presets and migrate local ones

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 10: Document the data-pack ownership and run the gate

**Files:**
- Modify: `docs/architecture.md`
- Modify: `docs/product.md`

- [ ] **Step 1: Update the docs**

State that installed widget packs and path presets are host-owned; the editor and MCP read the same rows; the starter theme is a bundled `yunari-theme-package`; the default widget pack is bundled content; no generator composes them at runtime.

- [ ] **Step 2: Run the gate**

```bash
cd src/web
npm run gate
echo "exit=$?"
```

Expected: `exit=0`.

- [ ] **Step 3: Commit**

```bash
git add docs/architecture.md docs/product.md
git commit -m "docs: describe host-owned data packs

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```
