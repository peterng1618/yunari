# Store Distribution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish, review, install, update, and revoke every package kind through the existing store, with store-derived publisher identity, a held-update policy, and a kill list.

**Architecture:** The Worker keeps its version ladder and status machine, adds generic metadata and review columns, and validates non-theme packages at finalize. The host downloads by kind, verifies size and digest, dispatches to the existing widget-pack, path-preset, theme, editor-theme, or plugin installer, and refuses a killed plugin. Publisher identity is written by the Worker from the account, never read from a manifest.

**Tech Stack:** Cloudflare Workers, D1, R2, TypeScript, Vitest Workers pool, Node `crypto` and `fetch`. No new runtime dependency.

**Spec:** `docs/superpowers/specs/2026-11-06-extension-platform-design.md`

**Prerequisite:** `2026-11-06-data-pack-foundations.md` and `2026-11-06-extension-core.md`.

## Global Constraints

- Item kinds are exactly `dashboard-theme`, `editor-theme`, `widget-pack`, `path-preset-pack`, `plugin`.
- `dashboard-theme` keeps `envelope_json`. Other kinds write `metadata_json`; `envelope_json` is `{}`.
- A version is never trusted from the client. Existing status, remix, download, author-listing, and quota rules stay the owners.
- Publisher comes from the store account, never the manifest. Reserved publishers cannot be claimed.
- Hardware plugins (`panelFamilies`, `usb:device`, `serial:device`) require review before `published`.
- A package is validated by the store and revalidated by the host before install. No package executes before validation and consent.
- The kill list blocks a plugin from loading. The disabled list overrides consent.
- Kill-list unknown fields are ignored so older clients still revoke.
- Run every npm command from `src/web/`. `npm run gate` must exit 0 without network access.

## Review Focus

- A non-theme submission whose uploaded bytes do not match the declared SHA-256 or size: finalize must refuse and leave no published version.
- A plugin manifest that claims `publisher: "yunari"`: the store must ignore it and use the account's publisher; a reserved account name must be refused.
- A hardware plugin submitted by a verified author: it must enter review, not publish automatically.
- A refused update that adds a capability or device: the host must hold it and keep the previous approved version running.
- A killed plugin that still has consent: it must not load, and uninstall must clear its registry rows and consent.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/web/packages/renderer-core/src/theme/catalogue-index.ts` | `STORE_ITEM_KINDS`, kind guard, and kind-neutral catalogue entry fields. |
| `src/web/packages/store-worker/migrations/0006_extension_kinds.sql` | Metadata, publisher, review, and kill-list columns/tables. |
| `src/web/packages/store-worker/src/catalogue/kinds.ts` | Per-kind metadata validation and default facets. |
| `src/web/packages/store-worker/src/catalogue/publisher.ts` | Store-account publisher slug and reserved-name refusal. |
| `src/web/packages/store-worker/src/catalogue/review.ts` | Hardware-review requirement and review transitions. |
| `src/web/packages/store-worker/src/routes/kill-list.ts` | Public `kill-list.json` and admin mutation. |
| `src/web/packages/host/src/extensions/kill-list.ts` | Fetch, cache, parse, and block killed plugins. |
| `src/web/packages/host/src/store/install.ts` | Download, verify, dispatch by kind, and update policy. |
| `src/web/packages/host/src/store/update-policy.ts` | Auto-update only when access and publisher do not grow. |

---

### Task 1: Record the store-distribution reuse decision

**Files:**
- Create: `docs/decisions/0113-store-distribution.md`

**Interfaces:**
- Consumes: the spec's `Store and distribution` and `Security invariants` sections.
- Produces: exact `Paths:` claims for the Worker and host store files.

- [ ] **Step 1: Write the decision note**

Header:

```markdown
# 0113 — store distribution

- **Date:** 2026-11-06
- **Status:** accepted
- **Paths:** `src/web/packages/renderer-core/src/theme/catalogue-index.ts`
  `src/web/packages/store-worker/migrations/0006_extension_kinds.sql`
  `src/web/packages/store-worker/src/catalogue/kinds.ts`
  `src/web/packages/store-worker/src/catalogue/publisher.ts`
  `src/web/packages/store-worker/src/catalogue/review.ts`
  `src/web/packages/store-worker/src/routes/kill-list.ts`
  `src/web/packages/host/src/extensions/kill-list.ts`
  `src/web/packages/host/src/store/install.ts`
  `src/web/packages/host/src/store/update-policy.ts`
```

Rungs: the Worker's version ladder, status machine, `finalize` copy, and catalogue entry are the owners; D1/R2 already provide the persistence; Orca's publisher, review, update, and kill-list mechanics are the public prior art; the probe is a widget-pack submission with a mismatched digest being refused at finalize. Decision: extend the existing tables and routes, not a second catalogue.

- [ ] **Step 2: Verify the hook accepts the claims**

```bash
echo '{"tool_input":{"file_path":"src/web/packages/store-worker/src/catalogue/kinds.ts"}}' | node scripts/reuse-gate.mjs
echo "exit=$?"
```

Expected: `exit=0`.

- [ ] **Step 3: Commit**

```bash
git add docs/decisions/0113-store-distribution.md
git commit -m "docs(decisions): authorise store distribution

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 2: Make the catalogue kind-neutral

**Files:**
- Modify: `src/web/packages/renderer-core/src/theme/catalogue-index.ts`
- Test: `src/web/packages/renderer-core/src/theme/catalogue-index.test.ts`

**Interfaces:**
- Produces:

```ts
export const STORE_ITEM_KINDS = [
  "dashboard-theme",
  "editor-theme",
  "widget-pack",
  "path-preset-pack",
  "plugin",
] as const;
export type StoreItemKind = (typeof STORE_ITEM_KINDS)[number];
export function isStoreItemKind(value: unknown): value is StoreItemKind;

export interface CatalogueEntry {
  readonly id: string;
  readonly kind: StoreItemKind;
  readonly name: string;
  readonly version: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly downloads: number;
  readonly favorites: number;
  readonly packageUrl: string;
  readonly thumbnail: string;
  readonly facets: FacetRecord;
  readonly publisher?: string;
  /** The wire value of the plugin's execution profile; a theme or pack has none. */
  readonly executionProfile?: string;
  readonly remixOf?: ThemeRemix;
}
```

`CatalogueItemFile` keeps the same omission rules. `parseCatalogueItemFile` accepts `publisher` and `executionProfile` when present and refuses an unknown kind rather than treating it as a theme.

- [ ] **Step 1: Write the failing test**

```ts
it("accepts a plugin entry and refuses an unknown kind", () => {
  expect(parseCatalogueItemFile({ ...itemFile(), kind: "plugin", publisher: "acme", executionProfile: "declarative" })).toMatchObject({
    ok: true,
    file: { kind: "plugin", publisher: "acme", executionProfile: "declarative" },
  });
  expect(parseCatalogueItemFile({ ...itemFile(), kind: "sensor-pack" })).toEqual({
    ok: false,
    reason: 'item.json\'s "kind" must be one of dashboard-theme, editor-theme, widget-pack, path-preset-pack, plugin.',
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run packages/renderer-core/src/theme/catalogue-index.test.ts
```

Expected: FAIL because `kind` is an open string and the new fields are not read.

- [ ] **Step 3: Implement the kind vocabulary**

Move `DASHBOARD_THEME_KIND` to a re-export of `STORE_ITEM_KINDS[0]`. Keep `CatalogueEntry` construction in the store's `entryOf` as the only writer.

- [ ] **Step 4: Run the catalogue suite**

```bash
npx vitest run packages/renderer-core/src/theme/catalogue-index.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/web/packages/renderer-core/src/theme/catalogue-index.ts src/web/packages/renderer-core/src/theme/catalogue-index.test.ts
git commit -m "feat(store): add the five item kinds to the catalogue

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 3: Add metadata, publisher, review, and kill-list persistence

**Files:**
- Create: `src/web/packages/store-worker/migrations/0006_extension_kinds.sql`
- Modify: `src/web/packages/store-worker/src/db/types.ts`
- Test: `src/web/packages/store-worker/tests/apply-migrations.ts`

**Interfaces:**
- Produces:

```sql
ALTER TABLE item ADD COLUMN publisher TEXT NOT NULL DEFAULT '';
ALTER TABLE item ADD COLUMN review_state TEXT NOT NULL DEFAULT 'none'
  CHECK (review_state IN ('none', 'pending', 'approved', 'rejected'));
ALTER TABLE item_version ADD COLUMN metadata_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE item_version ADD COLUMN execution_profile TEXT;
ALTER TABLE item_version ADD COLUMN review_state TEXT NOT NULL DEFAULT 'none'
  CHECK (review_state IN ('none', 'pending', 'approved', 'rejected'));

CREATE TABLE kill_list (
  plugin_key TEXT PRIMARY KEY,
  advisory_url TEXT,
  created_at TEXT NOT NULL
);
```

`ItemRow` gains `publisher`, `review_state`. `VersionRow` gains `metadata_json`, `execution_profile`, `review_state`.

- [ ] **Step 1: Write the failing migration test**

Assert that applying all migrations yields the five new columns, the two review constraints, and the `kill_list` table; insert a row with `review_state = 'bogus'` and expect the constraint to fail.

- [ ] **Step 2: Run the Worker suite to verify it fails**

```bash
cd src/web
npm run test:worker -- --run tests/apply-migrations.ts
```

Expected: FAIL because the columns and table do not exist.

- [ ] **Step 3: Write the migration and types**

Keep the default `'none'` so existing rows migrate without a rewrite. No backfill of publisher; an empty publisher is the legacy dashboard-theme row and `entryOf` omits it.

- [ ] **Step 4: Run the Worker suite**

```bash
npm run test:worker -- --run tests/apply-migrations.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/web/packages/store-worker/migrations/0006_extension_kinds.sql src/web/packages/store-worker/src/db/types.ts
git commit -m "feat(store): persist metadata, publisher and review

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 4: Accept and validate non-theme versions

**Files:**
- Create: `src/web/packages/store-worker/src/catalogue/kinds.ts`
- Modify: `src/web/packages/store-worker/src/routes/me.ts`
- Modify: `src/web/packages/store-worker/src/db/finalize.ts`
- Modify: `src/web/packages/store-worker/src/version/plan.ts`
- Modify: `src/web/packages/store-worker/package.json`
- Test: `src/web/packages/store-worker/tests/packs.spec.ts`
- Test: `src/web/packages/store-worker/src/catalogue/kinds.test.ts`

**Interfaces:**
- Produces:

```ts
export interface PackSubmission {
  readonly kind: Exclude<StoreItemKind, "dashboard-theme">;
  readonly name: string;
  readonly version: string;
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly sha256: string;
  readonly bytes: number;
}

export function readPackSubmission(value: unknown):
  | { readonly ok: true; readonly submission: PackSubmission }
  | { readonly ok: false; readonly message: string };

export function defaultFacetsFor(kind: StoreItemKind): FacetRecord;
export function planPackVersion(previous: string | undefined, candidate: string):
  | { readonly ok: true; readonly version: string }
  | { readonly ok: false; readonly message: string };
export function validateFinalizedPackage(kind: StoreItemKind, bytes: Uint8Array):
  | { readonly ok: true; readonly metadata: Readonly<Record<string, unknown>>; readonly executionProfile: string | null }
  | { readonly ok: false; readonly message: string };
```

Rules:

- `widget-pack` uses `readWidgetPackage`; its version is `document.metadata.version`; metadata is `{ name, units }`.
- `path-preset-pack` uses `readPathPresetPack`; its version is the submission's semver because the pack format has no item version.
- `plugin` uses `readPluginPackage`; its version is the manifest version; metadata is the manifest and its contribution identities; `executionProfile` is the manifest's execution.
- `editor-theme` uses `readEditorThemePackage`; its version is the submission's semver.
- A submission reserves with `envelope_json = '{}'`, `metadata_json = JSON.stringify(metadata)`, and the submitted `sha256` and `bytes`.
- Finalize reads the pending object, checks exact byte length and SHA-256, then validates the package. A mismatch deletes the upload and answers 400.

- [ ] **Step 1: Write the failing tests**

```ts
it("refuses a widget pack whose uploaded digest differs", async () => {
  const reserved = await reserveWidgetPack({ sha256: "00", bytes: 10 });
  const response = await finalize(reserved, widgetPackBytes());
  expect(response.status).toBe(400);
  expect(await response.text()).toContain("does not match");
  expect(await publishedVersions("pack-one")).toEqual([]);
});

it("publishes a declarative plugin under the account publisher", async () => {
  const response = await submitPlugin(validDeclarativePlugin(), { account: "acme" });
  expect(response.status).toBe(200);
  expect((await latestVersion("plugin-one")).publisher).toBe("acme");
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm run test:worker -- --run tests/packs.spec.ts packages/store-worker/src/catalogue/kinds.test.ts
```

Expected: FAIL because only dashboard themes are accepted.

- [ ] **Step 3: Implement kind validation and finalize verification**

Add `@yunari/extension-api` as a workspace dependency of the store Worker; `readPluginPackage` is pure and imports no Node built-in. Branch `requestVersion` on `kind`. Keep the theme branch byte-for-byte. Add `planPackVersion`, which requires a strictly greater semver and refuses an equal or lower one. At finalize, use `crypto.subtle.digest` over the pending object bytes before validation and before the R2 copy.

- [ ] **Step 4: Run the Worker suite**

```bash
npm run test:worker
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/web/packages/store-worker/src/catalogue/kinds.ts src/web/packages/store-worker/src/routes/me.ts src/web/packages/store-worker/src/db/finalize.ts src/web/packages/store-worker/src/version/plan.ts src/web/packages/store-worker/package.json
git commit -m "feat(store): validate pack and plugin versions

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 5: Derive publisher identity and gate hardware review

**Files:**
- Create: `src/web/packages/store-worker/src/catalogue/publisher.ts`
- Create: `src/web/packages/store-worker/src/catalogue/review.ts`
- Modify: `src/web/packages/store-worker/src/routes/me.ts`
- Modify: `src/web/packages/store-worker/src/routes/admin.ts`
- Test: `src/web/packages/store-worker/tests/publisher.spec.ts`
- Test: `src/web/packages/store-worker/tests/review.spec.ts`

**Interfaces:**
- Produces:

```ts
export function publisherFor(input: {
  readonly userId: string;
  readonly displayName: string | null;
  readonly email: string;
}): { readonly ok: true; readonly publisher: string } | { readonly ok: false; readonly message: string };

export function requiresHardwareReview(manifest: PluginManifest): boolean;
export function reviewStateFor(manifest: PluginManifest): "none" | "pending";
```

Rules: publisher is a lower-kebab slug of `author_profile.display_name`, falling back to the email local part, then the user id. It is computed on every version finalize and written to `item.publisher`. `requiresHardwareReview` is true for `panelFamilies` or the `usb:device`/`serial:device` capabilities. A hardware plugin's version gets `review_state = 'pending'`; the item status is `pending` even for a verified author. Admin `POST /api/admin/items/:id/review` with `{ decision: "approved" | "rejected", reason? }` moves the version and item status; only an owner may call it.

- [ ] **Step 1: Write the failing tests**

```ts
it("ignores a manifest publisher and uses the account publisher", async () => {
  const response = await submitPlugin({ ...validDeclarativePlugin(), publisher: "yunari" }, { account: "acme" });
  expect((await latestVersion("plugin-one")).publisher).toBe("acme");
});

it("holds a hardware plugin for review", async () => {
  const response = await submitPlugin(hardwarePlugin(), { account: "acme", verified: true });
  expect(response.status).toBe(200);
  expect((await itemRow("plugin-one")).status).toBe("pending");
  expect((await latestVersion("plugin-one")).review_state).toBe("pending");
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm run test:worker -- --run tests/publisher.spec.ts tests/review.spec.ts
```

Expected: FAIL because publisher and review are not written.

- [ ] **Step 3: Implement publisher and review**

Use the existing owner check in `routes/admin.ts`; do not add a second admin guard. A review decision is one D1 statement updating both the version and item rows, so a partial write is impossible.

- [ ] **Step 4: Run the Worker suite**

```bash
npm run test:worker
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/web/packages/store-worker/src/catalogue/publisher.ts src/web/packages/store-worker/src/catalogue/review.ts src/web/packages/store-worker/src/routes/me.ts src/web/packages/store-worker/src/routes/admin.ts
git commit -m "feat(store): derive publishers and review hardware plugins

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 6: Serve all kinds in the catalogue

**Files:**
- Modify: `src/web/packages/store-worker/src/catalogue/entry.ts`
- Modify: `src/web/packages/store-worker/src/routes/public.ts`
- Modify: `src/web/packages/host/src/catalogue/build-index.ts`
- Test: `src/web/packages/store-worker/tests/public.spec.ts`
- Test: `src/web/packages/host/src/catalogue/build-index.test.ts`

**Interfaces:**
- `entryOf` reads `metadata_json` for non-themes. `facets_json` remains the one facets owner. `publisher` and `executionProfile` are included when present.
- `packageUrl` keeps the existing `catalogue/<id>/<version>.zip` shape for every kind.
- `buildCatalogueIndex` no longer calls `readFabricThemeEnvelope` for every kind; it validates the item header and uses the stored facets from the same authoring input.

- [ ] **Step 1: Write the failing tests**

```ts
it("lists a widget pack with its metadata name and facets", async () => {
  await publishWidgetPack({ name: "Starter Cards", version: "1.0.0" });
  const index = await getIndex();
  expect(index.entries).toContainEqual(expect.objectContaining({
    kind: "widget-pack",
    name: "Starter Cards",
    version: "1.0.0",
  }));
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm run test:worker -- --run tests/public.spec.ts
npx vitest run packages/host/src/catalogue/build-index.test.ts
```

Expected: FAIL because `entryOf` parses every version as a theme envelope.

- [ ] **Step 3: Implement the kind-neutral entry**

For a theme, keep `remixOf` from `envelope_json`. For a pack or plugin, read `metadata_json`. A row whose metadata is unreadable is skipped and reported by the existing drop path, never emitted with a fabricated name.

- [ ] **Step 4: Run both suites**

```bash
npm run test:worker
npx vitest run packages/host/src/catalogue
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/web/packages/store-worker/src/catalogue/entry.ts src/web/packages/store-worker/src/routes/public.ts src/web/packages/host/src/catalogue/build-index.ts
git commit -m "feat(store): list packs and plugins beside themes

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 7: Serve and honour the kill list

**Files:**
- Create: `src/web/packages/store-worker/src/routes/kill-list.ts`
- Modify: `src/web/packages/store-worker/src/index.ts`
- Create: `src/web/packages/host/src/extensions/kill-list.ts`
- Modify: `src/web/packages/host/src/extensions/service.ts`
- Test: `src/web/packages/store-worker/tests/kill-list.spec.ts`
- Test: `src/web/packages/host/src/extensions/kill-list.test.ts`

**Interfaces:**
- Produces:

```ts
export interface KillList {
  readonly version: 1;
  readonly generatedAt: string;
  readonly plugins: Readonly<Record<string, { readonly advisory?: string }>>;
}

export function readKillList(value: unknown): KillList;
export interface KillListStore {
  load(): Promise<KillList>;
  isKilled(pluginKey: string): Promise<boolean>;
  refresh(): Promise<void>;
}
export function createKillListStore(options: {
  readonly directory: string;
  readonly origin: string | undefined;
  readonly fetch: typeof fetch;
  readonly now: () => string;
}): KillListStore;
```

Store: `GET /kill-list.json` reads the `kill_list` table and answers `cache-control: max-age=60`. Admin `PUT /api/admin/kill-list/:key` with `{ advisoryUrl? }` inserts or updates; `DELETE` removes. The host fetches at startup, on install, and on update checks, caches the last good list under `<settingsDir>/extensions/kill-list.json`, and treats a failed fetch as "use the cached list"; no cached list means nothing is killed. Unknown fields are ignored.

- [ ] **Step 1: Write the failing tests**

```ts
it("blocks a killed plugin that has consent", async () => {
  const service = createExtensionService({ installer, consent: grantedConsent(), killList: killed("local/acme-sensors"), now });
  expect(await service.mayLoad("local/acme-sensors")).toBe(false);
});

it("ignores unknown kill-list fields", () => {
  expect(readKillList({ version: 1, generatedAt: "2026-11-06T00:00:00Z", plugins: { "acme/x": { advisory: "https://example.test", note: "old" } }, future: true })).toEqual({
    version: 1,
    generatedAt: "2026-11-06T00:00:00Z",
    plugins: { "acme/x": { advisory: "https://example.test" } },
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm run test:worker -- --run tests/kill-list.spec.ts
npx vitest run packages/host/src/extensions/kill-list.test.ts
```

Expected: FAIL because the route and store do not exist.

- [ ] **Step 3: Implement the kill list**

The host only accepts an `https:` advisory URL; a malformed entry is ignored. `mayLoad` checks the kill list before consent. The disabled list is the kill list; it has no separate file.

- [ ] **Step 4: Run the suites**

```bash
npm run test:worker -- --run tests/kill-list.spec.ts
npx vitest run packages/host/src/extensions
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/web/packages/store-worker/src/routes/kill-list.ts src/web/packages/store-worker/src/index.ts src/web/packages/host/src/extensions/kill-list.ts src/web/packages/host/src/extensions/service.ts
git commit -m "feat: revoke killed plugins

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 8: Install and update by kind

**Files:**
- Create: `src/web/packages/host/src/store/install.ts`
- Create: `src/web/packages/host/src/store/update-policy.ts`
- Modify: `src/web/packages/host/src/server/theme-writes.ts`
- Modify: `src/web/packages/editor/src/store-mode/install-item.ts`
- Test: `src/web/packages/host/src/store/install.test.ts`
- Test: `src/web/packages/host/src/store/update-policy.test.ts`

**Interfaces:**
- Produces:

```ts
export interface CatalogueInstallRequest {
  readonly packageUrl: string;
  readonly catalogueId: string;
  readonly kind: StoreItemKind;
  readonly version: string;
  readonly sha256: string;
  readonly bytes: number;
  readonly publisher: string;
  readonly executionProfile?: ExecutionProfile;
}

export type CatalogueInstallResult =
  | { readonly ok: true; readonly id: string; readonly consentRequired: boolean }
  | { readonly ok: false; readonly message: string; readonly stage: "address" | "download" | "integrity" | "package" | "store" };

export interface UpdateDecision {
  readonly action: "auto" | "hold";
  readonly reasons: readonly string[];
}
export function decideUpdate(previous: ConsentBinding, next: ConsentBinding, publisherChanged: boolean): UpdateDecision;
```

Install flow: only `https:` and the configured store origin; download with a byte cap; verify exact size and SHA-256; dispatch `dashboard-theme` to `installCatalogueItem`, `widget-pack` to `WidgetPackStore.install`, `path-preset-pack` to `PathPresetStore.addPack`, `editor-theme` to `<settingsDir>/editor-themes/<id>.yunari-theme` with `GET /api/editor-themes/:id` serving the bytes back to the existing Settings import control, and `plugin` to `PluginInstaller.install`. A plugin returns `consentRequired` from `consentRequired(execution)`. The editor posts to `/api/store/install`; keep `/api/themes/install` for the existing theme path.

`decideUpdate` holds on any non-empty `accessGrowth` or a changed publisher; otherwise auto.

- [ ] **Step 1: Write the failing tests**

```ts
it("refuses a download whose digest differs", async () => {
  const result = await installCatalogueItem(request({ sha256: "00" }), { fetch: fetchBytes(WIDGET_PACK_BYTES), stores });
  expect(result).toMatchObject({ ok: false, stage: "integrity" });
});

it("holds an update that adds a capability", () => {
  expect(decideUpdate(binding({ capabilities: ["network:fetch"] }), binding({ capabilities: ["network:fetch", "storage:own"] }), false)).toEqual({
    action: "hold",
    reasons: ["capability:storage:own"],
  });
});

it("auto-updates an unchanged binding", () => {
  expect(decideUpdate(binding(), binding(), false)).toEqual({ action: "auto", reasons: [] });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run packages/host/src/store
```

Expected: FAIL because the dispatcher and policy do not exist.

- [ ] **Step 3: Implement dispatch and policy**

Reuse the existing `InstallResult` stage vocabulary for themes. Use `crypto.createHash("sha256")` over the downloaded bytes. The route is loopback and origin checked, and its body is JSON only; the bytes come from the store, not the browser. A held update surfaces in `install-item.ts` as a review notice naming the plugin key, name, and store publisher; it does not install until the user approves the new binding.

- [ ] **Step 4: Run the host store tests**

```bash
npx vitest run packages/host/src/store packages/host/src/themes/install.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/web/packages/host/src/store src/web/packages/host/src/server/theme-writes.ts src/web/packages/editor/src/store-mode/install-item.ts
git commit -m "feat: install and update every store kind

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 9: Document distribution and run the gate

**Files:**
- Modify: `docs/operations.md`
- Modify: `docs/product.md`

- [ ] **Step 1: Update the docs**

State the five kinds, store-derived publisher, hardware review, update hold, kill list, and the install stages.

- [ ] **Step 2: Run the gate**

```bash
cd src/web
npm run gate
echo "exit=$?"
```

Expected: `exit=0`.

- [ ] **Step 3: Commit**

```bash
git add docs/operations.md docs/product.md
git commit -m "docs: describe store distribution

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```
