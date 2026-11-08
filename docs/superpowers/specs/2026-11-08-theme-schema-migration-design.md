# Theme document schema versioning and 2 → 3 migration

- **Date:** 2026-11-08
- **Status:** design approved, awaiting spec review
- **Decision record:** `docs/decisions/0127-theme-schema-version-rule.md`
- **Paths:** `src/web/packages/renderer-core/src/theme/fabric-envelope.ts`,
  `src/web/packages/renderer-core/src/theme/migrations.ts`,
  `src/web/packages/renderer-core/src/theme/migrations.test.ts`,
  `src/web/packages/renderer-core/src/theme/fabric-envelope-version.test.ts`,
  `src/web/packages/host/src/themes/store.ts`,
  `src/web/packages/host/scripts/migrate-theme-library.ts`,
  `schema/theme-document.schema.json`, `docs/product.md`

## Problem

A theme document is persisted with a semantic `schemaVersion`, but the reader
compares only its **major** (`SUPPORTED_SCHEMA_MAJOR`). Breaking shape changes
have landed as minor bumps: `2.0.0 → 2.1.0` moved the background paint from
`background.color` to `background.media.color` and began refusing a document
that carries both. The migration registry is keyed by major, so the chain never
runs for a 2.0.0 document, and the strict validator refuses it.

On this machine, 73 of 133 stored themes fail to load:

| Issue | Themes | Cause |
|---|---:|---|
| `duplicate-background-color` | 72 | 2.0.0 wrote `background.color` beside `background.media` |
| `background.fill` unknown | 5 | `fill` merged into `color` on 2026-11-05 with no migration |
| `media.region` unknown | 1 | `region` renamed `composition` on 2026-11-05 with no migration |
| `globals.typePresets` | 2 | Pre-v2 token vocabulary; a separate, larger conversion |

A probe applying one shape transform in memory makes 131/133 validate. The two
`typePresets` themes need a v1-style token/run migration and are out of scope.

The root cause is that the document format’s version rule and the reader’s
comparison disagree. A minor bump cannot be both “compatible” and “refused”.

## Goal

1. A breaking document-shape change is a major bump, and the migration registry
   is the one place that bridges it.
2. Old documents load on every surface without a per-reader branch.
3. Stored documents converge to the current shape while the host runs.
4. A one-off conversion script can report and rewrite an existing library using
   the same migration owner.

**Non-goals:** converting the two `typePresets` themes; rewriting catalogue or
store-package copies; adding a migration library.

## Research summary

- JSON Schema has no document-version keyword: `$schema` names the dialect and
  `$id` names the schema, so a payload version field plus immutable schemas is
  the standard shape. The JSON Schema organisation treats version management as
  a software-engineering concern.
  ([json-schema-org/website#197](https://github.com/json-schema-org/website/issues/197))
- SchemaVer (`MODEL-REVISION-ADDITION`) classifies a breaking change as a MODEL
  bump and requires published versions to stay immutable.
  ([Snowplow](https://docs.snowplow.io/docs/fundamentals/schemas/versioning/))
- Read-time upcasting keeps storage untouched and chains one pure function per
  version at the read boundary.
  ([gaevoy](https://gaevoy.com/2026/07/14/upcasting-frontend-schema-evolution.html),
  [jsonic](https://jsonic.io/guides/json-migrations))
- Kubernetes separates the served version from the stored version, converts on
  read without rewriting, and uses an explicit storage migration to rewrite.
  ([Kubernetes](https://kubernetes.io/docs/tasks/extend-kubernetes/custom-resources/custom-resource-definition-versioning/))
- tldraw keys migrations by sequence id, records the persisted sequence
  versions, and migrates automatically on load.
  ([tldraw](https://tldraw.dev/sdk-features/persistence))
- npm options (`@nanocollective/json-up`, `verzod`, `becomes`, `yuppee`)
  duplicate a migration registry around a schema validator. Yunari already
  owns both in `renderer-core`; adding one would create a second derivation of
  the document rule for no new capability.

## Design

### Version rule

`SUPPORTED_SCHEMA_VERSION` becomes `3.0.0`. The published schema’s `$id` and
`schemaVersion.const`, the sync test and the version assertion move with it.
`MIN_SUPPORTED_SCHEMA_MAJOR` remains `max(2, SUPPORTED − 1)` = 2, so the
previous major is still readable.

The legacy integer normalisation generalises: an integer major inside
`[MIN_SUPPORTED_SCHEMA_MAJOR, SUPPORTED_SCHEMA_MAJOR]` becomes
`"<n>.0.0"` and enters the chain. This preserves the old integer `2` after the
bump; today only the integer equal to the current major is normalised.

The strict validator still accepts only the current major. Write paths keep
calling it, so a save cannot smuggle a migrated-but-old document through.

### The `2 → 3` migration

One pure, idempotent function in `migrations.ts`:

1. If `background.media` exists:
   - `media.color ??= background.fill ?? background.color`.
   - Delete `background.fill` and `background.color`.
   - `fill` wins when both slots held different paint: it is the paint the
     composition reveals, which is what `media.color` owns now. The old single
     `color` also painted the letterbox; the new one paint cannot preserve a
     difference, and the composition-visible area is the larger claim.
   - If `media.region` is present and `media.composition` is absent, convert:
     opposite insets (left+right or top+bottom) → `anchor: "center"`; otherwise
     the largest side → the opposite anchor, `extent = clamp(1 − inset, 0.1, 1)`,
     and `fade` from a linear blend’s `length`; a radial blend → `center` + fade;
     no finite inset → `{}` (no authored geometry). Delete `media.region`.
     Ensure `background.mode = "advanced"`.
2. If no media: `background.color ??= background.fill`; delete `background.fill`.
3. `background.mode: "basic"` → `"simple"`.
4. Set `schemaVersion` to `SUPPORTED_SCHEMA_VERSION` last.

Running it on a current 3.0.0 document changes nothing. The chain’s existing
major check then confirms the result is current before the validator sees it.

### Live read and persistence

`readFabricThemeEnvelope` already chains migrations before validation, and
every reader uses it: host store, player, editor shell/draft restore, catalogue.
No reader gains a version branch.

Persistence belongs to the host, which owns the library:

- `createThemeStore().list()` repairs beside `repairScratch` — the existing
  place where “a theme becomes visible” is also where a crash is undone.
- The repair reads `theme.json`, runs the same reader, and writes
  `JSON.stringify(envelope)` to a temporary file in the theme folder followed by
  a rename, only after the migrated document validates. A file that fails is
  left byte-identical.
- Repair participates in the store’s per-id exclusion. A save in flight makes
  the repair skip and retry on the next listing; a read waits for an in-flight
  repair. The store’s `saving`/`swapping` mechanism is the owner of that rule.
- `read()` keeps returning the migrated envelope from memory. It does not write.
  An editor holding a `base` from before a repair sees one save conflict; that
  is the correct answer to a file that changed, never a silent overwrite.

The display-facing `/document` route returns `readEnvelope`, which is the
migrated envelope, so panels and the player load old files without a host
change.

### Conversion script

`src/web/packages/host/scripts/migrate-theme-library.ts`, exposed as
`npm run theme:migrate -- <themes-dir> [--write]` from `src/web/`:

- Default is a dry run: read each `theme.json`, run the reader’s migration and
  strict validation, print the old → new version and every remaining failure
  with its issue codes.
- `--write` calls the store repair path, then re-reports.
- No second converter and no second validator; the script is a thin report over
  the owners.

### Testing

- `migrations.test.ts`: each conversion rule; paint precedence; `fill` with no
  media; `region` linear/radial/opposite-inset; `basic` → `simple`; idempotence;
  integer `2`; a 2.1.0 document with the current shape; a migrated result
  validates.
- `fabric-envelope-version.test.ts`: current version is 3.0.0; the legacy
  integer, malformed versions, newer and older majors keep their answers.
- Schema sync: `$id` and `const` follow the constant.
- Host store: a stored 2.0.0 theme reads, appears in `list()`, and its
  `theme.json` becomes 3.0.0; an invalid old theme is not rewritten; a current
  file is not rewritten; a save during repair leaves the save’s bytes.
- Real library: script dry run reports 131 convertible and the two
  `typePresets` failures; `--write` converts them; the host restarts and the
  editor library shows the themes.
- `npm run gate` exit code recorded.

### Risks and open points

- Three themes (`01b9a811`, `9ed51feb`, `f1f40b36`) had different `color` and
  `fill`; the chosen paint may shift. They need a visual check.
- The one `region` theme (`01b9a811`) is a best-effort geometry conversion;
  visual check required.
- A build pinned to 2.1.0 refuses 3.0.0 as newer. This is the cost of a real
  major bump and is accepted while pre-release.
- Catalogue and store copies are read correctly through the shared reader but
  are not rewritten by the host library repair.

## Rejected alternatives

| Option | Why not |
|---|---|
| Keep 2.1.0 and key migrations by full semver | Avoids fixture churn, but adds a second version axis and every future minor needs an entry; minor-compatibility stops meaning anything |
| Accept both background shapes in the validator | Two derivations of one rule, storage never converges, write path ambiguous |
| Adopt a migration library | Wraps a registry around a schema validator; duplicates the owner already here |
| In-memory migration only | Themes load, but every load pays the migration and files never converge |
| Batch rewrite on startup only | The store has no lifecycle; `list()` is the existing visibility and repair point |
