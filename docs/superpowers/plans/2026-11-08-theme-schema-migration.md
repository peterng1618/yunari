# Theme Schema 3.0.0 Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make theme schema `3.0.0` the current document format, migrate every readable 2.x document on read, persist the upgrade from the host library, and provide a script that converts the themes on this machine.

**Architecture:** `renderer-core` owns the version constant, the migration chain and the one strict validator. `readFabricThemeEnvelope` already chains migrations before validation, so every reader (host, player, editor, catalogue) accepts old documents without a second branch. The host owns storage: `createThemeStore().list()` repairs `theme.json` atomically after a migrated document validates. A thin host script reuses both owners for an explicit batch report and rewrite.

**Tech Stack:** TypeScript, Node 22+, Vitest, `@yunari/renderer-core`, `@yunari/host`, `tsx`.

**Spec:** `docs/superpowers/specs/2026-11-08-theme-schema-migration-design.md`

## Global Constraints

- Run every npm command from `src/web/`.
- Node `>=22`; do not add a runtime dependency.
- A breaking document-shape change is a **major** version bump; the migration registry is the only bridge.
- A migration is pure and idempotent; the strict write validator is never bypassed.
- A file that does not validate after migration is left byte-identical.
- `npm run gate` must exit 0 before the work is called done.
- The ADR is written **before** the first production edit (`AGENTS.md` reuse gate).

## Review Focus

1. A theme with both `background.color` and `background.fill` holding different paint — the migration must choose `fill`, and the visual result should be the composition-visible paint.
2. A `2.1.0` document that already has the current shape — it must migrate without changing anything but the version stamp.
3. A legacy integer `2` and integer `3` — `2` must enter the chain, `3` must normalise to `3.0.0`.
4. A save starting while `list()` is repairing the same id — the save's bytes must win; repair must skip or wait, never overwrite the save.
5. A corrupt or otherwise unvalidatable `theme.json` — `list()` must not rewrite it and the script must report it.

---

### Task 1: ADR, `2 → 3` migration, version bump and legacy integers

**Files:**
- Create: `docs/decisions/0127-theme-schema-version-rule.md`
- Modify: `src/web/packages/renderer-core/src/theme/fabric-envelope.ts:20`
- Modify: `src/web/packages/renderer-core/src/theme/migrations.ts:39-40,90-118`
- Test: `src/web/packages/renderer-core/src/theme/migrations.test.ts`
- Test: `src/web/packages/renderer-core/src/theme/fabric-envelope-version.test.ts`
- Modify: `schema/theme-document.schema.json:3,10`
- Modify: `README.md:20`, `docs/architecture.md:146,176,374`, `docs/product.md:8,144`
- Fixtures: every file reported by the sweep in Step 6, except the two version tests above.

**Interfaces:**
- Consumes: `SUPPORTED_SCHEMA_VERSION`, `SUPPORTED_SCHEMA_MAJOR`, `MIN_SUPPORTED_SCHEMA_MAJOR`, `parseSchemaMajor`, `isRecord`, `validateFabricThemeEnvelope`.
- Produces: `SUPPORTED_SCHEMA_VERSION = "3.0.0"`; `SCHEMA_MIGRATIONS[2]` is `(input: Readonly<Record<string, unknown>>) => Readonly<Record<string, unknown>>`; `migrateFabricThemeEnvelope(input): MigrationResult` keeps its signature.

- [ ] **Step 1: Write the ADR**

Follow `docs/decisions/README.md`. Title: `0127 — a breaking theme shape change is a major version`. List every file this plan modifies in `Paths:` (the reuse gate matches exact files). Fill the seven rungs from the spec's **Research summary** and **Rejected alternatives**. Decision: version comparison stays major-only, every breaking shape change bumps the major, `SCHEMA_MIGRATIONS` is the only bridge, reads upcast, the host repairs storage on `list()`, and no migration library is added.

- [ ] **Step 2: Write the failing tests**

Append to `migrations.test.ts`, reusing the existing `envelope()` helper:

```ts
function legacy2(background: Record<string, unknown>): Record<string, unknown> {
  return {
    ...envelope("2.0.0"),
    globals: {
      ...(envelope("2.0.0")["globals"] as Record<string, unknown>),
      palette: {
        board: { name: "Board", value: { kind: "solid", color: "#101216" } },
        band: { name: "Band", value: { kind: "solid", color: "#202428" } },
      },
    },
    assets: [{ id: "clip", kind: "video", path: "assets/clip.mp4" }],
    background,
  };
}
```

Migration tests, each asserting `result.ok === true`, then `result.document`, then `validateFabricThemeEnvelope(result.document).ok === true`:

1. `"moves the background paint onto a declared media"` — `{ color: { ref: "palette.board" }, media: { assetId: "clip", bounds: "theme" } }`; expect `background.color` absent, `background.media.color` equal to the board ref, `schemaVersion === "3.0.0"`.
2. `"prefers fill over color when both painted the media"` — `{ color: { ref: "palette.board" }, fill: { ref: "palette.band" }, media: { assetId: "clip", bounds: "theme" } }`; expect `media.color` equal to `{ ref: "palette.band" }` and neither old key present.
3. `"keeps the page paint when no media is declared"` — `{ color: { ref: "palette.board" }, fill: { ref: "palette.band" } }`; expect `background.color` equal to the board ref and `fill` absent.
4. `"moves fill onto the page when color is absent"` — `{ fill: { ref: "palette.band" } }`; expect `background.color` equal to the band ref.
5. `"converts a linear region into an anchored composition"` — `{ media: { assetId: "clip", bounds: "display", region: { bottom: 0.53, blend: { shape: "linear", edge: "bottom", length: 0.05 } } } }`; expect `media.composition` `{ anchor: "top", extent: 0.47, fade: 0.05 }`, `region` absent, `background.mode === "advanced"`.
6. `"converts opposite insets to a centred composition"` — `region: { left: 0.2, right: 0.3 }`; expect `anchor: "center"`.
7. `"renames a basic background mode"` — `{ mode: "basic", color: { ref: "palette.board" } }`; expect `mode === "simple"`.
8. `"is idempotent on a current document"` — pass `result.document` from test 1 through `migrateFabricThemeEnvelope` again; expect `ok` and an identical document (`toEqual`).
9. `"stamps a 2.1.0 document without changing its background"` — `{ ...envelope(), schemaVersion: "2.1.0" }`; expect `schemaVersion === "3.0.0"` and `background` identical to the input.

Legacy-integer tests in `migrateFabricThemeEnvelope`:

10. `"migrates the legacy integer one major below the current one"` — `{ ...legacy2({ color: { ref: "palette.board" }, media: { assetId: "clip", bounds: "theme" } }), schemaVersion: 2 }`; expect `ok`, `schemaVersion === SUPPORTED_SCHEMA_VERSION`, `fromMajor === 2`.
11. `"normalises the legacy integer equal to the current major"` — `{ ...envelope(), schemaVersion: SUPPORTED_SCHEMA_MAJOR }`; expect `ok` and the current version.
12. Keep the refusal cases for `SUPPORTED_SCHEMA_MAJOR + 1` and `MIN_SUPPORTED_SCHEMA_MAJOR - 1`.

Remove the old assertion at `fabric-envelope-version.test.ts:95-120` that a 2.0.0 media-plus-colour document is refused; migration test 1 replaces it.

- [ ] **Step 3: Run the tests to verify they fail**

Run: `cd src/web && npx vitest run packages/renderer-core/src/theme/migrations.test.ts`
Expected: FAIL — 2.0.0 and integer-2 documents are refused or unchanged, and `SCHEMA_MIGRATIONS[2]` is missing.

- [ ] **Step 4: Implement the migration, the version bump and the integer normalisation**

In `fabric-envelope.ts`, set `SUPPORTED_SCHEMA_VERSION = "3.0.0"`.

In `migrations.ts`, add and export `migrateFrom2To3`; register `SCHEMA_MIGRATIONS = { 2: migrateFrom2To3 }`. Update the registry comment: it is no longer empty; it holds the step from the previous major.

Migration rules, in order:

1. Copy the input shallowly; only write into `background`/`media` copies.
2. If `background.media` is a record:
   - `media.color ??= background.fill ?? background.color`.
   - delete `background.fill` and `background.color`.
   - if `media.region` is a record and `media.composition` is absent, build the composition:
     - finite insets are `left`, `top`, `right`, `bottom`;
     - `left`+`right` both present **or** `top`+`bottom` both present → `{ anchor: "center" }`;
     - otherwise the side with the largest finite inset → `anchor` is the opposite side, `extent = Math.min(1, Math.max(0.1, 1 - inset))`;
     - a linear blend with a finite `length` → `fade: length`; a radial blend with a finite `length` → `anchor: "center", fade: length`;
     - no finite inset → `{}`;
     - delete `media.region`; if `background.mode` is absent set it to `"advanced"`.
3. If no media: `background.color ??= background.fill`; delete `background.fill`.
4. `background.mode === "basic"` → `"simple"`.
5. Set `schemaVersion: SUPPORTED_SCHEMA_VERSION` last.

In `migrateFabricThemeEnvelope`, replace the single-value integer check with: an integer in `[MIN_SUPPORTED_SCHEMA_MAJOR, SUPPORTED_SCHEMA_MAJOR]` becomes `"<n>.0.0"`; everything else is left unchanged and falls through to the existing major checks.

- [ ] **Step 5: Update the schema, docs and version tests**

- `schema/theme-document.schema.json`: `$id` ends `/3.0.0.json`; `schemaVersion.const` is `"3.0.0"`.
- `README.md:20`, `docs/architecture.md:146,176,374`, `docs/product.md:8,144`: state `3.0.0` and “the previous major is the compatibility floor”.
- `fabric-envelope-version.test.ts`: expect `"3.0.0"` and major `3`; later minor `"3.4.9"`; malformed `["3","3.0","3.0.0.0","v3.0.0"]`; newer `["4.0.0","10.0.0"]`; older `"1.0.0"` with the message containing `"3.0.0"`. Keep `parseSchemaMajor("2.4.9") === 2`.
- `migrations.test.ts`: the invalid-integer list becomes `[4, "2", "v2.0.0", {}, null, undefined]`; the newer-major fixture becomes `"4.0.0"`.

- [ ] **Step 6: Sweep the current-version fixtures**

From `src/web`, replace the bare token (it also appears inside messages and comments):

```bash
grep -rl '2\.1\.0' packages tests --include='*.ts' --include='*.tsx' \
  | grep -v 'renderer-core/src/theme/migrations.test.ts' \
  | grep -v 'renderer-core/src/theme/fabric-envelope-version.test.ts' \
  | xargs sed -i 's/2\.1\.0/3\.0\.0/g'
```

Then fix these by hand, where `"3.0.0"` means a **future** major and must become `"4.0.0"` (and the message's version with it):

- `src/web/packages/editor/src/editor-shell.dom.test.ts:1727`
- `src/web/packages/host/src/catalogue/build-index.test.ts:229`
- `src/web/packages/host/src/themes/store.test.ts:305`
- `src/web/packages/player/src/load-failure-reason.test.ts:161`
- `src/web/packages/player/src/theme-loader.test.ts:114`
- `src/web/packages/renderer-core/src/theme/fabric-envelope-validate.test.ts:301`
- `src/web/packages/theme-package/src/index.test.ts:109`
- `src/web/packages/theme-package/src/version-ladder.test.ts:102`

`version-ladder.test.ts` stops classifying a change if both sides become `3.0.0`; its “schema version changes” fixture must be `"4.0.0"`.

The migration suite is excluded because its `"2.1.0"` values are arbitrary historical steps in chain tests. `fabric-envelope-version.test.ts` is excluded because it is rewritten in Step 5.

- [ ] **Step 7: Run the suites**

Run: `cd src/web && npx vitest run packages/renderer-core/src/theme`
Expected: PASS.

Run: `cd src/web && npm test`
Expected: PASS. This catches the legacy-integer expectations in host, player and theme-package tests that the sweep updated, and any `"3.0.0"`-as-future fixture missed above.

Run: `cd src/web && npm run typecheck`
Expected: exit 0, so the e2e fixture sweep is type-correct.

- [ ] **Step 8: Commit**

```bash
git add docs/decisions/0127-theme-schema-version-rule.md \
  src/web/packages src/web/tests schema/theme-document.schema.json \
  README.md docs/architecture.md docs/product.md
git commit -m "feat(theme)!: migrate the 2.x background shape to schema 3.0.0"
```

---

### Task 2: Host storage repair on `list()`

**Files:**
- Create: `src/web/packages/host/src/themes/stored-document.ts`
- Create: `src/web/packages/host/src/themes/stored-document.test.ts`
- Modify: `src/web/packages/host/src/themes/store.ts` (`THEME_FILE`, `list()`, `write()`)
- Test: `src/web/packages/host/src/themes/store.test.ts`

**Interfaces:**
- Consumes: `readFabricThemeEnvelope`, `FabricThemeEnvelope`, `parseSchemaMajor`, `SUPPORTED_SCHEMA_MAJOR`, `MIN_SUPPORTED_SCHEMA_MAJOR`.
- Produces:
  - `export const THEME_FILE = "theme.json"` — moved here from `store.ts`; `store.ts` imports it.
  - `export function storedDocumentNeedsRewrite(raw: unknown): boolean`
  - `export async function rewriteStoredDocument(folder: string, envelope: FabricThemeEnvelope): Promise<void>`

- [ ] **Step 1: Write the failing pure tests**

In `stored-document.test.ts`:

```ts
it("rewrites only a document older than the current major", () => {
  expect(storedDocumentNeedsRewrite({ schemaVersion: "2.0.0" })).toBe(true);
  expect(storedDocumentNeedsRewrite({ schemaVersion: "2.1.0" })).toBe(true);
  expect(storedDocumentNeedsRewrite({ schemaVersion: 2 })).toBe(true);
  expect(storedDocumentNeedsRewrite({ schemaVersion: 3 })).toBe(true);
  expect(storedDocumentNeedsRewrite({ schemaVersion: "3.0.0" })).toBe(false);
  expect(storedDocumentNeedsRewrite({ schemaVersion: "3.4.9" })).toBe(false);
  expect(storedDocumentNeedsRewrite({ schemaVersion: 4 })).toBe(false);
  expect(storedDocumentNeedsRewrite({ schemaVersion: "nonsense" })).toBe(false);
  expect(storedDocumentNeedsRewrite({})).toBe(false);
});
```

`"3.4.9"` is false deliberately: a later minor from a future build is readable and must not be rewritten down.

- [ ] **Step 2: Write the failing store integration tests**

In `store.test.ts`, add a describe `"migrating a stored document"`:

1. A helper writes a folder with a 2.0.0 `theme.json` (reuse the file's existing fixture builder) carrying `background: { color: { ref: "palette.board" }, media: { assetId: "clip", bounds: "theme" } }`, a video asset declaration and its `assets/clip.mp4` bytes.
2. `list()` includes the id; read `theme.json` and assert `schemaVersion === "3.0.0"` and `background.media.color` exists.
3. An invalid 2.0.0 theme (for example `background: { nope: true }`) is unchanged byte-for-byte after `list()`.
4. A 3.0.0 theme's bytes are unchanged after `list()`.
5. Save during repair. Use the injectable `rename` to hold the save's staging rename:

```ts
let held = false;
let release!: () => void;
const gate = new Promise<void>((resolve) => { release = resolve; });
const store = createThemeStore(tmpDir, {
  rename: async (from, to) => {
    if (!held && path.basename(from).startsWith(".staging-")) {
      held = true;
      await gate;
    }
    await fs.rename(from, to);
  },
});
const saving = store.write(
  "legacy",
  { envelope: envelopeFor("legacy", "Saved"), assets: {} },
  { overwrite: true },
);
while (!held) await new Promise((resolve) => setImmediate(resolve));
const listing = await store.list();
release();
await saving;
await listing;
const stored = JSON.parse(
  await fs.readFile(path.join(tmpDir, "legacy", "theme.json"), "utf8"),
);
expect(stored.metadata.name).toBe("Saved");
```

- [ ] **Step 3: Run to verify failure**

Run: `cd src/web && npx vitest run packages/host/src/themes/stored-document.test.ts packages/host/src/themes/store.test.ts`
Expected: FAIL — the module does not exist and `list()` does not rewrite.

- [ ] **Step 4: Implement `stored-document.ts`**

- `storedDocumentNeedsRewrite(raw)`: false unless `raw` is a record; read `schemaVersion`; an integer inside `[MIN_SUPPORTED_SCHEMA_MAJOR, SUPPORTED_SCHEMA_MAJOR]` → true; a semantic string with `parseSchemaMajor` `< SUPPORTED_SCHEMA_MAJOR` → true; everything else false.
- `rewriteStoredDocument(folder, envelope)`: write `JSON.stringify(envelope)` to `.theme.json.<6 random hex>.tmp` in `folder` with `flag: "wx"`, then `rename` over `theme.json`; remove the temp in `finally` with `force: true`.
- Move `THEME_FILE` here; import it in `store.ts`.

- [ ] **Step 5: Wire repair into `list()` and close the save race**

In `store.ts`:

- Add a local `async function repairStoredTheme(id: string)` inside `createThemeStore`. Its lock sequence is:

```ts
async function repairStoredTheme(id: string): Promise<void> {
  await awaitSwap(id);
  if (saving.has(id)) return;               // a save owns the folder now
  let finish!: () => void;
  const running = new Promise<void>((resolve) => { finish = resolve; });
  const pending = swapping.get(id) ?? new Set<Promise<void>>();
  pending.add(running);
  swapping.set(id, pending);
  try {
    // read, migrate and rewrite (returns early on any refusal)
  } finally {
    finish();
    pending.delete(running);
    if (pending.size === 0 && swapping.get(id) === pending) swapping.delete(id);
  }
}
```

  The body: `readContainedFile(folder, THEME_FILE)`; absent or over `MAX_THEME_FILE_BYTES` → return; `JSON.parse` failure → return; `readFabricThemeEnvelope(raw)` failure → return; `storedDocumentNeedsRewrite(raw)` false → return; `rewriteStoredDocument(folder, validation.envelope)`.
- In `list()`, call `await repairStoredTheme(entry.name)` for each directory entry before `storedEnvelope`.
- In `write()`, move `saving.add(id)` to the top of the method (before `readStoredOrAbsent`) and add `await awaitSwap(id)` before `readStoredOrAbsent`. Remove the later duplicate `saving.add(id)`.

- [ ] **Step 6: Run to verify pass**

Run: `cd src/web && npx vitest run packages/host/src/themes/stored-document.test.ts packages/host/src/themes/store.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/web/packages/host/src/themes/stored-document.ts \
  src/web/packages/host/src/themes/stored-document.test.ts \
  src/web/packages/host/src/themes/store.ts \
  src/web/packages/host/src/themes/store.test.ts
git commit -m "feat(host): repair an old theme document when the library lists it"
```

---

### Task 3: Conversion script

**Files:**
- Create: `src/web/packages/host/scripts/migrate-theme-library.ts`
- Modify: `src/web/package.json` (add `theme:migrate`)

**Interfaces:**
- Consumes: `readFabricThemeEnvelope`, `storedDocumentNeedsRewrite`, `createThemeStore`, `path`, `os`.
- Produces: `npm run theme:migrate -- <themes-dir> [--write]`.

- [ ] **Step 1: Write the script**

Behaviour:

- `const [directory = path.join(os.homedir(), ".yunari", "themes"), ...flags] = process.argv.slice(2); const write = flags.includes("--write");`
- `report()` lists directory entries with a `theme.json`, parses it, and for each:
  - success and `storedDocumentNeedsRewrite(raw)` → print `<id>: <rawVersion> -> 3.0.0`;
  - success and no rewrite → count as current;
  - failure → print `<id>: FAILED <comma-separated issue codes>`.
  - Print a final `convertible`, `current`, `failed` summary.
- If `--write`: `await createThemeStore(directory).list();` then `report()` again.
- Exit 0 always; the report is the output.

- [ ] **Step 2: Add the npm script**

In `src/web/package.json`, add `"theme:migrate": "tsx packages/host/scripts/migrate-theme-library.ts"`.

- [ ] **Step 3: Verify on a throwaway directory**

Create a temp directory outside the repo with one 2.0.0 theme and one invalid theme. Run the dry run, then `--write`; assert the first file becomes 3.0.0 and the second is byte-identical. Record the commands and output in the task report.

- [ ] **Step 4: Commit**

```bash
git add src/web/packages/host/scripts/migrate-theme-library.ts src/web/package.json
git commit -m "feat(host): add a theme-library migration script"
```

---

### Task 4: Convert this machine and prove the gate

**Files:** none new (verification and any doc corrections found here).

- [ ] **Step 1: Dry run against the real library**

Run from `src/web`:

```bash
npm run theme:migrate -- "$USERPROFILE/.yunari/themes"
```

Expected: 131 convertible, 2 failed with `invalid-enum` / `unknown-field` / `missing-field` / `unresolved-global-ref` (the `typePresets` themes). If the counts differ, stop and report before writing.

- [ ] **Step 2: Confirm, then write**

This rewrites the user's theme library. Show the dry-run summary and ask for confirmation before:

```bash
npm run theme:migrate -- "$USERPROFILE/.yunari/themes" --write
```

Expected after: 131 current, 2 failed. Re-run the dry run to confirm the file state.

- [ ] **Step 3: Run the gate and record the exit code**

Stop the host first if it is running, so no save overlaps the repair.

```bash
cd src/web && npm run gate > /tmp/yunari-gate.log 2>&1; echo $?
```

Expected: `0`. If not, read the log and fix the failure rather than weakening the check.

- [ ] **Step 4: Visual check**

Restart the host, open the editor library, open one converted media theme, and confirm the background renders with its composition. Report the result; a panel change needs the user's own visual review before it is called good.

- [ ] **Step 5: Commit any doc corrections**

Only if verification changed a document. No empty commit.
