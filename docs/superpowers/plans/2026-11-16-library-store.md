# Library and Store Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One catalogue and one Library surface for themes, app themes, widgets, shapes, providers and panel drivers, with collections that install several listings in one press.

**Architecture:** Catalogue entries gain derived `members`; a new `collection` listing carries `includes` (catalogue ids). The host keeps a per-kind catalogue-origin register and installs a collection by pre-flighting every chosen member before writing any. The editor's third shell mode becomes Library with flat type navigation, member-aware cards, an expanded detail modal and a collection install sheet.

**Tech Stack:** TypeScript, React 19, Base UI, Vitest, Cloudflare Workers (D1, R2), Node host, Fabric.

**Spec:** `docs/superpowers/specs/2026-11-16-library-store-design.md`

## Global Constraints

- Run every npm command from `src/web/`. Node `>=22`.
- No new runtime dependency; a new one needs a `THIRD-PARTY-NOTICES.md` entry.
- American English in every user-facing string.
- Theme schema and the Fabric envelope are unchanged. No second scene model.
- No fabricated telemetry: a missing provider reading stays absent with its reason.
- `DESIGN.md` is normative; change it with `editor-shell.css`, then run `npm run design:check`.
- Store package paths, sizes, hashes and readers remain the validators. The host revalidates every member before writing.
- No compatibility glue for the superseded internal store shape.
- `npm run gate` must exit 0.

## Review Focus

- A collection whose member is unpublished or killed between plan and install: the install must refuse by name and write nothing, never partially install a silently smaller set.
- A legacy `theme-origins.json` on an existing machine: every installed theme keeps its origin and the read never throws.
- A catalogue entry naming a member kind this build does not ship: the entry is kept and the identifier is printed; nothing crashes.
- A member card pressed for a widget inside a pack: the pack installs once, and a second press does not double-write or fail.
- A partial install failure mid-collection: the result names what installed and what did not, and retry skips installed members.
- Unticking an optional member that another member needs (marking both optional by mistake): the sheet warns from the collection manifest and never claims the remaining set works.

---

### Task 1: Record the reuse decision

**Files:**
- Create: `docs/decisions/0132-library-store.md`

**Interfaces:**
- Consumes: the spec, `docs/decisions/README.md` template, `docs/decisions/0113-store-distribution.md`, `docs/decisions/0114-executable-extensions.md`.
- Produces: the decision note the reuse gate expects before watched writes.

- [ ] **Step 1: Read the template and the two related notes**

Run: `sed -n 1,80p docs/decisions/README.md && sed -n 1,60p docs/decisions/0113-store-distribution.md`

- [ ] **Step 2: Write `docs/decisions/0132-library-store.md`**

Work the seven rungs from the template. Record: the internal owners (`catalogue-index.ts`, `catalogue/kinds.ts`, `store/install.ts`, `theme-origins.ts`, `store-mode/`); installed dependencies re-read (`theme-package` readers, `extension-api` manifest); native platform (D1 columns already present, no new table); public solutions (Orca's catalogue `contributes[]` and marketplace model); the integration comparison; the smallest probe if any behaviour is in doubt; and the build/reuse decision. Reject one-listing-per-kind, a unified package format and pinned collections, citing the spec's **Decisions**.

- [ ] **Step 3: Commit**

```bash
git add docs/decisions/0132-library-store.md
git commit -m "docs(decisions): record the library store reuse decision"
```

---

### Task 2: Catalogue wire shape

**Files:**
- Modify: `packages/renderer-core/src/theme/catalogue-index.ts`
- Modify: `packages/renderer-core/src/index.ts`
- Test: `packages/renderer-core/src/theme/catalogue-index.test.ts`

**Interfaces:**
- Consumes: existing `CatalogueEntry`, `parseCatalogueIndex`, `parseCatalogueItemFile`, `isCatalogueId`.
- Produces:
```ts
export const MEMBER_KINDS = [
  "dashboard-theme", "editor-theme", "widget", "shape",
  "sensor-provider", "asset-source", "panel-driver", "data-source",
] as const;
export type MemberKind = (typeof MEMBER_KINDS)[number] | (string & {});
export interface MemberRecord {
  readonly id: string;
  readonly kind: string;
  readonly name: string;
}
// CatalogueEntry gains:
readonly members: readonly MemberRecord[];
readonly includes?: readonly string[];
```
`STORE_ITEM_KINDS` gains `"collection"`.

- [ ] **Step 1: Write the failing tests**

Add to `catalogue-index.test.ts`:
```ts
it("keeps a member kind this build does not ship", () => { /* entry with members [{id:"a",kind:"future-thing",name:"A"}] parses */ });
it("refuses includes on a non-collection entry", () => { /* dashboard-theme entry with includes -> malformed refusal */ });
it("accepts a collection with includes and no members", () => { /* kind "collection", members [], includes [uuid] */ });
it("refuses a malformed member", () => { /* member missing name -> entry refused as malformed */ });
```
Assertions: unknown member kind stays; every other case lands in `refused` with `reason: "malformed"`.

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd src/web && npx vitest run packages/renderer-core/src/theme/catalogue-index.test.ts`
Expected: FAIL — `collection` not a kind, `members` unknown.

- [ ] **Step 3: Implement the wire shape**

Add the kind and member vocabulary, the `MemberRecord` type, `members` on `CatalogueEntry`, and `includes` on collection entries only. In `asEntry`, require `members` to be an array whose entries have three non-empty strings; keep unknown member kinds. Validate `includes` only when `kind === "collection"`, each an `isCatalogueId`, and refuse `includes` on any other kind. Apply the same checks in `parseCatalogueItemFile`. Export the new names from `index.ts`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd src/web && npx vitest run packages/renderer-core/src/theme/catalogue-index.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/renderer-core/src/theme/catalogue-index.ts packages/renderer-core/src/index.ts packages/renderer-core/src/theme/catalogue-index.test.ts
git commit -m "feat(renderer-core): add catalogue members and collections to the wire"
```

---

### Task 3: Collection package reader

**Files:**
- Create: `packages/theme-package/src/collection-package.ts`
- Modify: `packages/theme-package/src/index.ts`
- Test: `packages/theme-package/src/collection-package.test.ts`

**Interfaces:**
- Consumes: `isCatalogueId` and `CATALOGUE_ID_PATTERN` from `@yunari/renderer-core`.
- Produces:
```ts
export const COLLECTION_PACKAGE_FORMAT = "yunari-collection-package";
export const MAX_COLLECTION_INCLUDES = 64;
export interface CollectionInclude { readonly id: string; readonly optional: boolean }
export interface CollectionPackage {
  readonly name: string;
  readonly description: string;
  readonly includes: readonly CollectionInclude[];
}
export type CollectionPackageResult =
  | { readonly ok: true; readonly package: CollectionPackage }
  | { readonly ok: false; readonly message: string };
export function readCollectionPackage(bytes: Uint8Array): CollectionPackageResult;
```

- [ ] **Step 1: Write the failing tests**

`collection-package.test.ts`:
```ts
it("reads a minimal collection");
it("refuses bytes that are not UTF-8");
it("refuses a wrong format or version");
it("refuses an empty name, an empty includes list, and more than 64 includes");
it("refuses a non-catalogue id and a duplicate id");
it("defaults optional to false");
```
Assertions: the minimal read returns `{name:"Acme Kit",description:"",includes:[{id:<uuid>,optional:false}]}`; every refusal is `ok:false` with a sentence naming the bad field.

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd src/web && npx vitest run packages/theme-package/src/collection-package.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the reader**

Decode with `new TextDecoder("utf-8", { fatal: true })`, parse JSON, require `format === COLLECTION_PACKAGE_FORMAT` and `version === 1`. Bounds: name 1–200 characters, description at most 2000, includes 1–64, each id matches the catalogue UUID pattern, no duplicates. `optional` absent is `false`, present must be boolean.

- [ ] **Step 4: Run the test to verify it passes and export it**

Run: `cd src/web && npx vitest run packages/theme-package/src/collection-package.test.ts`
Expected: PASS. Export the module from `packages/theme-package/src/index.ts`.

- [ ] **Step 5: Commit**

```bash
git add packages/theme-package/src/collection-package.ts packages/theme-package/src/collection-package.test.ts packages/theme-package/src/index.ts
git commit -m "feat(theme-package): read the collection package"
```

---

### Task 4: Store worker accepts, validates and serves collections

**Files:**
- Modify: `packages/store-worker/src/catalogue/kinds.ts`
- Modify: `packages/store-worker/src/catalogue/entry.ts`
- Modify: `packages/store-worker/src/routes/me.ts`
- Modify: `packages/store-worker/src/db/items.ts`
- Test: `packages/store-worker/src/catalogue/kinds.test.ts`
- Test: `packages/store-worker/src/catalogue/entry.test.ts`

**Interfaces:**
- Consumes: Task 3's `readCollectionPackage`; Task 2's `MemberRecord`; `VersionRow.metadata_json`.
- Produces:
```ts
// kinds.ts
export function validateCollectionIncludes(
  includes: readonly CollectionInclude[],
  published: ReadonlySet<string>,
): { readonly ok: true } | { readonly ok: false; readonly message: string };
// items.ts
export async function publishedIdsOf(db: D1Database, ids: readonly string[]): Promise<ReadonlySet<string>>;
// entry.ts (internal)
function membersOf(item: ItemRow, version: VersionRow): readonly MemberRecord[];
```

- [ ] **Step 1: Write the failing tests**

`kinds.test.ts`:
```ts
it("finalizes a collection package into its name and includes");
it("refuses a collection including an unpublished id");
it("refuses a collection including itself");
it("refuses a nested collection");
```
`entry.test.ts`:
```ts
it("derives one member for a dashboard theme");
it("derives a widget member per unit");
it("derives a shape member per preset");
it("maps plugin contributions to member kinds");
it("serves includes and no members for a collection");
```
Assertions: member `kind` values are `widget`, `shape`, `sensor-provider`, `asset-source`, `panel-driver`, `data-source`; `settingsPages` and `assetCategories` produce no member; a collection row's entry has `members: []`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd src/web && npm run test -w @yunari/store-worker -- src/catalogue/kinds.test.ts src/catalogue/entry.test.ts`
Expected: FAIL — collection branch missing.

- [ ] **Step 3: Implement**

`validateFinalizedPackage` gains a `collection` branch: `readCollectionPackage(bytes)`, metadata `{ name, description, includes }`. After it, the finalize route validates includes with `publishedIdsOf` and refuses self-reference (same `item.id`) and any included item with `kind === "collection"`. `membersOf` reads the metadata the finalize already stores (`units`, `presets`, `manifest.contributes`) and the envelope for a dashboard theme; collection entries get `members: []` and `includes`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd src/web && npm run test -w @yunari/store-worker`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/store-worker/src/catalogue packages/store-worker/src/routes/me.ts packages/store-worker/src/db/items.ts
git commit -m "feat(store-worker): publish and serve collections with members"
```

---

### Task 5: Catalogue-origin register for every kind

**Files:**
- Create: `packages/host/src/settings/catalogue-origins.ts`
- Delete: `packages/host/src/settings/theme-origins.ts` and its test after the new test covers the legacy read
- Modify: `packages/host/src/main.ts`, `packages/host/src/server/options.ts`
- Modify: `packages/host/src/server/themes-routes.ts`, `pack-routes.ts`, `extension-routes.ts`, `theme-writes.ts`
- Test: `packages/host/src/settings/catalogue-origins.test.ts`
- Test: `packages/host/src/server/pack-routes.test.ts`, `extension-routes.test.ts`

**Interfaces:**
- Consumes: `ThemeOrigin` rows in `theme-origins.json`; `StoreItemKind`.
- Produces:
```ts
export interface CatalogueOrigin {
  readonly kind: StoreItemKind;
  readonly catalogueId: string;
  readonly version: string;
  readonly installedAt: string;
  readonly collections?: readonly string[];
}
export interface CatalogueOriginsStore {
  read(): Promise<Readonly<Record<string, CatalogueOrigin>>>;
  write(kind: StoreItemKind, installedId: string, origin: CatalogueOrigin): Promise<void>;
  remove(kind: StoreItemKind, installedId: string): Promise<void>;
}
export function createCatalogueOriginsStore(directory: string): CatalogueOriginsStore;
```
File `catalogue-origins.json`, keys `<kind>:<installedId>`. A legacy `theme-origins.json` is read as `dashboard-theme` rows and is not deleted on read.

- [ ] **Step 1: Write the failing tests**

```ts
it("reads a legacy theme-origins row as a dashboard theme");
it("keeps two kinds with the same installed id apart");
it("drops a malformed row without blanking the map");
it("writes and removes one kind's row");
```
Route tests: `GET /api/widget-packs` and `GET /api/extensions` include `origin` where one exists; `GET /api/editor-themes` lists installed app themes with `origin`; a legacy theme still returns `origin` on `/api/themes`.

- [ ] **Step 2: Run to verify they fail**

Run: `cd src/web && npx vitest run packages/host/src/settings/catalogue-origins.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement and wire**

Create the store following `theme-origins.ts` (atomic rename write, `Object.fromEntries`, stable-id guard on the installed id). Replace `themeOrigins` options/usages with `catalogueOrigins`. Each listing route joins its rows' origin. Add `GET /api/editor-themes` that reads the directory and returns `[{ id, name, origin }]`, loopback-only, bounded to `.yunari-theme` files.

- [ ] **Step 4: Run to verify they pass**

Run: `cd src/web && npx vitest run packages/host/src/settings/catalogue-origins.test.ts packages/host/src/server/pack-routes.test.ts packages/host/src/server/extension-routes.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/host/src/settings packages/host/src/main.ts packages/host/src/server
git commit -m "feat(host): record catalogue origins for every package kind"
```

---

### Task 6: Host collection plan and install

**Files:**
- Create: `packages/renderer-core/src/theme/collection-plan.ts` (wire types only)
- Modify: `packages/renderer-core/src/index.ts`
- Modify: `packages/host/src/store/install.ts`
- Modify: `packages/host/src/server/theme-writes.ts`
- Test: `packages/host/src/store/install.test.ts`

**Interfaces:**
- Consumes: `readCollectionPackage`, `planCollection`'s member `item.json` reads via `catalogueItemUrl` and `parseCatalogueItemFile`; existing `downloadPackage`, `installByKind`.
- Produces:
```ts
export interface CatalogueInstallRequest {
  /* existing fields */
  readonly items?: readonly string[]; // chosen includes; absent means all
}
export interface CollectionPlanMember {
  readonly id: string;
  readonly kind: StoreItemKind;
  readonly name: string;
  readonly version: string;
  readonly bytes: number;
  readonly publisher: string;
  readonly optional: boolean;
  readonly installedVersion?: string;
  readonly consent?: {
    readonly key: string;
    readonly name: string;
    readonly execution: ExecutionProfile;
    readonly capabilities: readonly string[];
    readonly devices: readonly string[];
  };
}
export interface CollectionPlan {
  readonly members: readonly CollectionPlanMember[];
  readonly missing: readonly { readonly id: string; readonly reason: string }[];
  readonly totalBytes: number;
}
export async function planCollection(request: CatalogueInstallRequest, options: CatalogueInstallOptions): Promise<{ok:true; plan: CollectionPlan} | {ok:false; message:string; stage: "download" | "integrity" | "package" | "store"}>;
```
`CollectionPlan` and `CollectionPlanMember` live in `renderer-core` (the host answers them, the editor reads them); the host re-exports nothing and imports them. Routes: `POST /api/store/collection/plan` → plan; `POST /api/store/install` with `kind:"collection"` installs.

- [ ] **Step 1: Write the failing tests**

```ts
it("refuses the collection and writes nothing when one member is unpublished");
it("refuses the collection and writes nothing when a member's hash does not match");
it("installs only the chosen optional members");
it("refuses an omitted required member");
it("reports installed and failed members when a later write fails");
it("skips an already installed member on retry");
it("plans each code member's capabilities and devices without writing");
```
Assertions: the refusal names the member id; no store's install function was called in refusals; retry calls the installed member's store only once.

- [ ] **Step 2: Run to verify they fail**

Run: `cd src/web && npx vitest run packages/host/src/store/install.test.ts`
Expected: FAIL — collection case missing.

- [ ] **Step 3: Implement**

Split the current download/verify from apply: `fetchVerified(request, options)` returns bytes or a refusal. `planCollection` downloads the collection package, verifies it, resolves each include from `catalogue/<id>/item.json`, verifies each member, reads plugin manifests for consent, and returns the plan without writing. `installByKind` gains `collection`: resolve chosen ids (`request.items ?? all includes`), refuse when a required include is missing, pre-flight every chosen member, then apply each in order and collect outcomes. Record `collections: [request.catalogueId]` on each written origin. Parse `items` in `parseCatalogueInstallRequest` as a bounded array of catalogue ids (at most 64).

- [ ] **Step 4: Run to verify they pass**

Run: `cd src/web && npx vitest run packages/host/src/store/install.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/host/src/store/install.ts packages/host/src/server/theme-writes.ts packages/host/src/store/install.test.ts
git commit -m "feat(host): plan and install collections with pre-flight"
```

---

### Task 7: Editor model and sources for every type

**Files:**
- Modify: `packages/editor/src/store-mode/local-source.ts`
- Modify: `packages/editor/src/store-mode/online-source.ts`
- Create: `packages/editor/src/library-mode/sources.ts`
- Test: `packages/editor/src/store-mode/local-source.test.ts`, `online-source.test.ts`
- Test: `packages/editor/src/library-mode/sources.test.ts`

**Interfaces:**
- Consumes: Task 2's `MemberRecord`, `MemberKind`; host endpoints `/api/themes`, `/api/editor-themes`, `/api/widget-packs`, `/api/path-presets`, `/api/extensions`.
- Produces:
```ts
export interface StoreItem {
  /* existing fields */
  readonly members: readonly MemberRecord[];
  readonly includes?: readonly string[];
}
export type LibraryPage =
  | "dashboard-themes" | "app-themes" | "widgets" | "shapes"
  | "sensor-providers" | "asset-sources" | "panel-drivers"
  | "collections" | "submissions";
export interface LibraryPageSource {
  readonly page: LibraryPage;
  /** Listings that carry at least one member of this page's kind. */
  readonly memberKind: MemberKind | "collection" | "listing";
  list(): Promise<readonly StoreItem[]>;
}
export function catalogueSourceFor(page: LibraryPage, options?): LibraryPageSource;
export function librarySourceFor(page: LibraryPage, clients: LibraryClients): LibraryPageSource;
```
`localThemeSource` and `catalogueItemOf` fill `members` (a theme is one member of itself; a collection carries `includes`); every existing `StoreItem` fixture gains `members`.

- [ ] **Step 1: Write the failing tests**

```ts
it("maps a catalogue entry's members and includes");
it("keeps an unknown member kind in the listing");
it("filters a page to the listings carrying its member kind");
it("maps each host listing to the same StoreItem shape");
it("fills a library theme as its own single member");
```
Assertions: Widgets page keeps `widget-pack` listings with a `widget` member and drops one with none; Sensor providers keeps `plugin` listings with `sensor-provider` or `data-source`; Collections keeps only `collection` entries.

- [ ] **Step 2: Run to verify they fail**

Run: `cd src/web && npx vitest run packages/editor/src/library-mode/sources.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Extend `StoreItem`; update `localThemeSource`, `onlineThemeSource`, `catalogueItemOf`, `mine-source.ts`, `item-fixture.ts` and existing tests. `catalogueSourceFor` reads `/index.json` once and filters by member kind. `librarySourceFor` adapts the existing clients (theme library, editor themes, widget packs from `card-library`, path presets, `useExtensions`) into `StoreItem` rows with `members` derived from each row.

- [ ] **Step 4: Run to verify they pass**

Run: `cd src/web && npx vitest run packages/editor/src/store-mode packages/editor/src/library-mode`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/editor/src/store-mode packages/editor/src/library-mode
git commit -m "feat(editor): list every catalogue member kind behind one source"
```

---

### Task 8: Library shell, navigation and state filter

**Files:**
- Modify: `packages/editor/src/editor-shell/shell-layout.tsx`
- Create: `packages/editor/src/library-mode/nav.ts`
- Create: `packages/editor/src/library-mode/region.tsx`
- Modify: `packages/editor/src/store-mode/region.tsx` (export the pieces the new region composes)
- Modify: `packages/editor/src/ui-copy.ts`, `DESIGN.md`, `packages/editor/src/editor-shell/editor-shell.css`
- Test: `packages/editor/src/library-mode/region.dom.test.tsx`, `nav.test.ts`
- Test: `packages/editor/src/editor-shell/shell-layout.dom.test.tsx`

**Interfaces:**
- Consumes: Task 7's `LibraryPage`, sources.
- Produces:
```ts
export type LibraryState = "all" | "on-this-pc" | "not-installed";
export interface LibraryPageEntry {
  readonly id: LibraryPage;
  readonly group: "browse" | "publish";
  readonly label: string;
  readonly glyph: LucideIcon;
}
export const LIBRARY_PAGES: readonly LibraryPageEntry[];
export function LibraryRegion(props: { readonly page: LibraryPage; readonly onPage: (page: LibraryPage) => void; readonly state: LibraryState; readonly onState: (state: LibraryState) => void }): React.JSX.Element | null;
```
`ShellMode` becomes `"library" | "editor" | "settings"`; the header label is `Library`.

- [ ] **Step 1: Write the failing tests**

```ts
it("lists the eight browse destinations and My submissions in order");
it("gives every page a label from uiCopy");
it("draws the header's third mode as Library");
it("filters the visible rows by the state");
it("keeps the editor body unmounted-hidden across a Library switch");
it("filters the Sensor providers page between Sensors and Data sources");
it("states a failed read with retry instead of drawing an empty listing");
```
Assertions: page ids equal `["dashboard-themes","app-themes","widgets","shapes","sensor-providers","asset-sources","panel-drivers","collections","submissions"]`; state filter drops a store row with no origin and drops a library row with one; the Sensors filter keeps `sensor-provider` members and the Data sources filter keeps `data-source` members; a rejected `list()` draws `uiCopy.store.unreadable` with the retry control.

- [ ] **Step 2: Run to verify they fail**

Run: `cd src/web && npx vitest run packages/editor/src/library-mode packages/editor/src/editor-shell/shell-layout.dom.test.tsx`
Expected: FAIL — `library` is not a mode.

- [ ] **Step 3: Implement**

Rename the mode value and every reference (`MODE_NAMES`, glyph constant, dirty-document guard). Add `library-mode/nav.ts` on the `settings-mode/nav.ts` pattern. Add the navigation column and the state filter using the existing `Segmented` primitive; the Dashboard themes page mounts today's store grid, the other pages mount their source. The Sensor providers page draws a `Sensors · Data sources` segmented control that filters its source by member kind. A failed read keeps the existing failure sentence and retry control; it is never drawn as an empty listing. Add `uiCopy.modes.library`, `uiCopy.library.pages.*`, `uiCopy.library.state.*`. Update `DESIGN.md`'s three-mode paragraph and any token change in `editor-shell.css`.

- [ ] **Step 4: Run to verify they pass**

Run: `cd src/web && npx vitest run packages/editor/src/library-mode packages/editor/src/editor-shell && npm run design:check`
Expected: PASS in all three commands.

- [ ] **Step 5: Commit**

```bash
git add packages/editor/src/library-mode packages/editor/src/editor-shell packages/editor/src/ui-copy.ts DESIGN.md
git commit -m "feat(editor): make Library a mode with type navigation and a state filter"
```

---

### Task 9: Member cards, pack expansion and install state

**Files:**
- Modify: `packages/editor/src/store-mode/gallery.tsx`
- Create: `packages/editor/src/library-mode/cards.ts`
- Test: `packages/editor/src/library-mode/cards.test.ts`
- Test: `packages/editor/src/store-mode/gallery.dom.test.tsx`

**Interfaces:**
- Consumes: `StoreItem.members`, `installStateOf`, `InstallControl`.
- Produces:
```ts
export interface StoreCard {
  readonly key: string;
  readonly listing: StoreItem;
  readonly member: MemberRecord | undefined; // undefined for a pack card
}
export function cardsOf(items: readonly StoreItem[]): readonly StoreCard[];
```
`Gallery` gains `readonly expanded: ReadonlySet<string>; readonly onExpand: (key: string) => void;` and draws member cards for an expanded pack.

- [ ] **Step 1: Write the failing tests**

```ts
it("draws a single-member listing as a member card");
it("draws a multi-member listing as a pack card with its member count");
it("expands a pack into its member cards and collapses it again");
it("installs the listing when a member card's Install is pressed");
it("shows Installed, Update or Install from the origin version");
it("reads a partially installed collection as N of M installed");
```
Assertions: `aria-expanded` flips; a member press calls `onInstall` once with the listing id; a second press in flight is refused by `useInstall`; a collection with two of four required members installed draws `2 of 4 installed` and Update.

- [ ] **Step 2: Run to verify they fail**

Run: `cd src/web && npx vitest run packages/editor/src/library-mode/cards.test.ts packages/editor/src/store-mode/gallery.dom.test.tsx`
Expected: FAIL — `cardsOf` missing.

- [ ] **Step 3: Implement**

`cardsOf` emits a member card for a one-member listing and a pack card plus member cards for a multi-member one (expanded only when keyed). Update the gallery cell to draw a member's name and kind badge while keeping the listing's picture. Install state comes from the listing's origin as `installStateOf` already decides.

- [ ] **Step 4: Run to verify they pass**

Run: `cd src/web && npx vitest run packages/editor/src/library-mode packages/editor/src/store-mode`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/editor/src/store-mode/gallery.tsx packages/editor/src/library-mode
git commit -m "feat(editor): draw member cards and expandable packs"
```

---

### Task 10: Detail modal with per-kind actions and trust block

**Files:**
- Modify: `packages/editor/src/store-mode/item-modal.tsx`
- Modify: `packages/editor/src/store-mode/item-panel.tsx`
- Modify: `packages/editor/src/store-mode/cell-actions.ts`
- Modify: `packages/editor/src/ui-copy.ts`
- Test: `packages/editor/src/store-mode/item-modal.dom.test.tsx`

**Interfaces:**
- Consumes: `StoreCard`, `MemberRecord`, `StoreItem.includes`, origin collections.
- Produces: `CellAction = "open" | "assign" | "export" | "delete" | "apply" | "insert" | "enable" | "configure" | "status"`; `actionsFor(kind: string): readonly CellAction[]`.

- [ ] **Step 1: Write the failing tests**

```ts
it("draws only the actions its member kind allows");
it("lists members and their publishers");
it("lists the collections an item belongs to");
it("draws a code member's execution, capabilities and devices");
it("links the trust block to Settings Extensions");
it("draws Collection Install and Update instead of the four library actions");
```
Assertions: a widget draws `insert`; a panel driver draws `assign` and `status`; a plugin draws `configure`; a collection draws no `open`.

- [ ] **Step 2: Run to verify they fail**

Run: `cd src/web && npx vitest run packages/editor/src/store-mode/item-modal.dom.test.tsx`
Expected: FAIL — unknown actions and missing fields.

- [ ] **Step 3: Implement**

Extend the action union and the modal's sections. "Part of" comes from a `collectionsOf(items, itemId)` helper over the catalogue's collection entries; publishers are listed per member. The trust block reads the plan route's consent for a collection, and the extension listing for an installed plugin; it links to Settings with the Extensions page selected. Add the copy keys under `uiCopy.store.detail.*`.

- [ ] **Step 4: Run to verify they pass**

Run: `cd src/web && npx vitest run packages/editor/src/store-mode/item-modal.dom.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/editor/src/store-mode packages/editor/src/ui-copy.ts
git commit -m "feat(editor): give every member kind its own detail and actions"
```

---

### Task 11: Collection install sheet and update diff

**Files:**
- Create: `packages/editor/src/library-mode/collection-sheet.tsx`
- Create: `packages/editor/src/library-mode/collection-install.ts`
- Modify: `packages/editor/src/store-mode/use-install.ts`
- Modify: `packages/editor/src/ui-copy.ts`
- Test: `packages/editor/src/library-mode/collection-install.test.ts`
- Test: `packages/editor/src/library-mode/collection-sheet.dom.test.tsx`

**Interfaces:**
- Consumes: Task 6's plan route and install request (`items`), `InstallControl`, the extension consent route.
- Produces:
```ts
export interface CollectionChoice {
  readonly chosen: ReadonlySet<string>;
  readonly missingRequired: readonly string[];
}
export function choicesOf(plan: CollectionPlan): CollectionChoice;
export function updateDiff(plan: CollectionPlan, installed: readonly string[]): {
  readonly missing: readonly string[];
  readonly dropped: readonly string[];
};
```
`useInstall` gains `onInstallCollection(item, items, onPlan)` that calls `/api/store/collection/plan`, then `/api/store/install` with the chosen ids, then grants each code member's consent with its fingerprint.

- [ ] **Step 1: Write the failing tests**

```ts
it("chooses every member by default and locks required ones");
it("refuses a plan with a missing required member");
it("warns when an unticked member is not marked optional");
it("diffs missing and dropped members against the origin records");
it("grants consent per code member after a successful install");
it("does not grant consent when the install wrote nothing");
```
Assertions: `choicesOf` returns every id chosen; unticking a required id yields `missingRequired`; the install body's `items` equals the chosen set; grants are one POST per plugin key.

- [ ] **Step 2: Run to verify they fail**

Run: `cd src/web && npx vitest run packages/editor/src/library-mode/collection-install.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Sheet sections in this order: included items with publisher/size/checkbox, total size, aggregated code-member consent, Install. Fetch the plan on open; a changed plan between open and Install replaces the sheet rather than installing a stale set. Update mode uses `updateDiff`; dropped members are offered for removal and never removed automatically.

- [ ] **Step 4: Run to verify they pass**

Run: `cd src/web && npx vitest run packages/editor/src/library-mode packages/editor/src/store-mode/use-install.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/editor/src/library-mode packages/editor/src/store-mode/use-install.ts packages/editor/src/ui-copy.ts
git commit -m "feat(editor): install collections with an opt-out sheet and a diff"
```

---

### Task 12: My submissions and the collection builder

**Files:**
- Modify: `packages/editor/src/store-mode/use-submit.ts`
- Modify: `packages/editor/src/store-mode/mine-source.ts`
- Create: `packages/editor/src/library-mode/collection-builder.tsx`
- Modify: `packages/editor/src/ui-copy.ts`
- Test: `packages/editor/src/store-mode/use-submit.test.ts`
- Test: `packages/editor/src/library-mode/collection-builder.dom.test.tsx`

**Interfaces:**
- Consumes: the Worker's pack submission (`kind`, `metadata`, `sha256`, `bytes`) and Task 3's manifest.
- Produces:
```ts
export interface CollectionDraft {
  readonly name: string;
  readonly description: string;
  readonly includes: readonly CollectionInclude[];
}
export function collectionManifest(draft: CollectionDraft): Uint8Array;
export function parseCollectionDraft(value: unknown): CollectionDraft | undefined;
```
`use-submit` submits `kind: "collection"` with the manifest bytes and its SHA-256; My submissions lists collections beside the other kinds.

- [ ] **Step 1: Write the failing tests**

```ts
it("submits a collection manifest with its bytes, size and digest");
it("refuses a draft with no includes or a duplicate include");
it("refuses a draft naming its own listing");
it("lists a submitted collection under My submissions");
it("reports the owner's refusal sentence beside the draft");
```
Assertions: the posted metadata name matches the draft; the digest is 64 lowercase hex characters; a refusal names the field.

- [ ] **Step 2: Run to verify they fail**

Run: `cd src/web && npx vitest run packages/editor/src/library-mode/collection-builder.dom.test.tsx packages/editor/src/store-mode/use-submit.test.ts`
Expected: FAIL — draft builder missing.

- [ ] **Step 3: Implement**

Builder: search published listings, add rows, toggle optional, reorder is not required. `collectionManifest` serializes the exact format Task 3 validates. Submission reuses the existing signed-in flow; a signed-out press asks to sign in exactly as other kinds do.

- [ ] **Step 4: Run to verify they pass**

Run: `cd src/web && npx vitest run packages/editor/src/library-mode packages/editor/src/store-mode/use-submit.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/editor/src/library-mode packages/editor/src/store-mode/use-submit.ts packages/editor/src/store-mode/mine-source.ts packages/editor/src/ui-copy.ts
git commit -m "feat(editor): publish collections from My submissions"
```

---

### Task 13: Cross-links and removal of the duplicated surfaces

**Files:**
- Modify: `packages/editor/src/panes/add/add-pane.tsx`
- Modify: `packages/editor/src/preset-library/use-preset-library.ts` or its consuming surface
- Modify: `packages/editor/src/editor-shell/editor-theme-settings.tsx`
- Modify: `packages/editor/src/settings-mode/region.tsx`, `plugin-manager.tsx`
- Delete: `packages/editor/src/store-mode/halves.tsx`, `StoreTab`, the theme-only `uiCopy.store.halves`, `uiCopy.store.cell.kinds`'s one-entry map
- Test: affected dom tests

**Interfaces:**
- Consumes: `LibraryPage`; the shell's page selection.
- Produces: one `openLibrary(page)` callback threaded to the three context surfaces.

- [ ] **Step 1: Write the failing tests**

```ts
it("opens the Widgets page from the Add pane");
it("opens the Shapes page from the preset list");
it("opens the App themes page from the appearance section");
it("draws Settings Extensions as trust only, with no installed listing of themes or packs");
it("prints an unknown kind identifier rather than a blank badge");
```
Assertions: each press calls `openLibrary` with its page; `uiCopy.store.cell.kinds` covers every `MEMBER_KINDS` entry exactly.

- [ ] **Step 2: Run to verify they fail**

Run: `cd src/web && npx vitest run packages/editor/src/panes/add packages/editor/src/store-mode packages/editor/src/settings-mode`
Expected: FAIL — no `openLibrary`, kinds map incomplete.

- [ ] **Step 3: Implement**

Thread the callback from the shell. Replace halves with the state filter's surface. Keep Settings' install-from-file and consent/device/provider-order controls; remove any installed-content listing that duplicates the Library. Add copy for the new links.

- [ ] **Step 4: Run to verify they pass**

Run: `cd src/web && npx vitest run packages/editor/src/panes/add packages/editor/src/store-mode packages/editor/src/settings-mode packages/editor/src/editor-shell`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/editor/src packages/editor/src/ui-copy.ts
git commit -m "feat(editor): link the context surfaces into the Library"
```

---

### Task 14: Documentation and the gate

**Files:**
- Modify: `docs/product.md` (store distribution and library section)
- Modify: `docs/architecture.md` (catalogue origins, collection install)
- Modify: `docs/operations.md` (collection publication and revocation)
- Modify: `DESIGN.md` if Task 8 left any token unsynced
- Test: none new; existing suites must stay green

**Interfaces:**
- Consumes: everything above.
- Produces: docs that state the current invariants, not the change history.

- [ ] **Step 1: Update the three docs**

`product.md`: seven member kinds, collections resolve latest, the install sheet grants per plugin. `architecture.md`: one catalogue-origin register; collection install pre-flight; members derived from validated metadata. `operations.md`: publishing a collection; a killed member blocks install; collections carry no review.

- [ ] **Step 2: Run the full gate**

Run: `cd src/web && npm run gate`
Expected: exit 0. If any step fails, fix it and rerun; do not proceed on a non-zero code.

- [ ] **Step 3: Run the built Library flow**

Run: `cd src/web && npm run build && npm run test:e2e`
Expected: exit 0, including a Library e2e that opens each page, expands a pack, opens a detail and installs a fake collection.

- [ ] **Step 4: Commit**

```bash
git add docs/product.md docs/architecture.md docs/operations.md DESIGN.md
git commit -m "docs: describe the library, members and collections"
```

## Self-Review Notes

- Spec coverage: wire (Task 2), reader (3), store (4), origins (5), install (6), model/sources (7), shell (8), cards (9), detail (10), sheet (11), publishing (12), cross-links/cleanup (13), docs/gate (14).
- The spec's `members` derivation is satisfied by metadata already stored at finalize (`units`, `presets`, `manifest`), so no new D1 column is introduced.
- Deferred by the spec and not planned: per-member facets, per-member pictures, collection nesting.
