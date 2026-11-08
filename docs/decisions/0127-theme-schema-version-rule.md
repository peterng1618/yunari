# 0127 — a breaking theme shape change is a major version

- **Date:** 2026-11-08
- **Status:** accepted
- **Paths:** `src/web/packages/renderer-core/src/theme/fabric-envelope.ts`,
  `src/web/packages/renderer-core/src/theme/migrations.ts`,
  `src/web/packages/renderer-core/src/theme/migrations.test.ts`,
  `src/web/packages/renderer-core/src/theme/fabric-envelope-version.test.ts`,
  `src/web/packages/host/src/themes/store.ts`,
  `src/web/packages/host/src/themes/stored-document.ts`,
  `src/web/packages/host/src/themes/store.test.ts`,
  `src/web/packages/host/src/themes/stored-document.test.ts`,
  `src/web/packages/host/scripts/migrate-theme-library.ts`,
  `src/web/package.json`

## Problem

A persisted theme carries a semantic `schemaVersion`, but the reader compares
only its major, so the version rule and the reader disagree. Breaking shape
changes have landed as minor bumps: `2.0.0 → 2.1.0` moved the background paint
to `background.media.color` and began refusing the old combined shape, and
`fill`/`region` were renamed without a migration. The registry is keyed by
major, so no entry can bridge a minor bump: a `2.0.0` document is accepted by
version, refused by the validator and never converted. Stored libraries stop
loading while the version string claims compatibility.

## Rung 1 — internal owner

Searched with CodeGraph: `migrateFabricThemeEnvelope`, `runSchemaMigrations`,
`SCHEMA_MIGRATIONS`, `MIN_SUPPORTED_SCHEMA_MAJOR`, `readFabricThemeEnvelope`,
`validateFabricThemeEnvelope`, plus the readers that call them.

Found: `renderer-core/src/theme/migrations.ts` owns the registry and the chain,
`fabric-envelope-validate.ts` owns the one read path (`migrate` then strict
validate) and every persisted-theme reader already uses it — host store, player,
editor restore, catalogue. `SCHEMA_MIGRATIONS` is empty, so the chain cannot run
for any older major. What remains unsolved is the step itself and the version
rule that lets the step exist, not a new mechanism.

## Rung 2 — installed dependencies

Searched: `src/web/package.json` runtime and dev dependencies for a
version/migration/schema package; the installed JSON Schema and validator
helpers already used by `renderer-core`.

Found: nothing installed models a versioned document with a per-version
converter. The repo's own `isSemanticVersion`, validator helpers and
`ValidationIssue` vocabulary already cover shape and refusal, so no dependency
donates the missing step or its lifecycle.

## Rung 3 — native platform

Searched: JSON Schema draft 2020-12 keywords (`$id`, `const`, `$schema`) and
Node/browser JSON handling.

Found: JSON Schema has no document-version keyword or migration hook; a payload
version field plus immutable published schemas is the standard shape. The
platform provides serialisation and nothing else, so the chain stays in the
module that already owns it.

## Rung 4 — public solutions

Searched: JSON Schema version-management discussion
(json-schema-org/website#197), Snowplow SchemaVer, read-time upcasting
(gaevoy, jsonic), Kubernetes served/stored versions and storage migration,
tldraw's sequence-keyed migrations, and the npm options
`@nanocollective/json-up`, `verzod`, `becomes`, `yuppee`.

Found: SchemaVer classifies a breaking change as a MODEL bump and requires
published versions to stay immutable. Read-time upcasting chains one pure
function per version at the read boundary and leaves storage untouched until an
explicit write. Kubernetes converts on read without rewriting and uses an
explicit storage migration to converge files; tldraw keys migrations by
sequence and migrates automatically on load. Every npm option wraps a second
registry around a schema validator — capability this repo already owns.

## Rung 5 — integration comparison

| Option | Fit | Unsolved work | Verdict |
|---|---|---|---|
| Keep `2.1.0` and key migrations by full semver | Avoids fixture churn | Adds a second version axis; every minor needs an entry; minor compatibility stops meaning anything | Reject |
| Accept both background shapes in the strict validator | No version churn | Two derivations of one rule, storage never converges, write path ambiguous | Reject |
| Bump the major and bridge it in `SCHEMA_MIGRATIONS` | One version rule, one bridge, every reader already chained | The step function and the legacy-integer range | Accept |
| Adopt a migration library | Registry around a validator | Duplicates the owner already in `renderer-core` | Reject |
| In-memory migration only | Themes load | Every load pays the migration; files never converge | Reject |
| Rewrite the whole library on startup | Files converge | The store has no lifecycle; `list()` is the existing visibility and repair point | Reject for this step |

## Rung 6 — smallest probe

A disposable in-memory probe applied the background shape transform to the
authoring machine's stored library: 131 of 133 themes then validate, and the two
that still fail carry the pre-v2 `globals.typePresets` vocabulary, which is a
separate conversion. The probe fixes the migration's order and proves the shape
conversion is sufficient; the two failures are recorded as out of scope rather
than guessed at.

## Decision

Version comparison stays major-only. Every breaking document-shape change bumps
the major, and `SCHEMA_MIGRATIONS` is the only bridge: one pure, idempotent
function per major, registered under the major it migrates from. Reads upcast
through `readFabricThemeEnvelope` before the strict validator runs, so no reader
gains a version branch and the write path still refuses an old document. The
host repairs stored files through the same migration when `list()` makes a theme
visible, so storage converges without a second converter. The legacy integer is
normalised for any integer in
`[MIN_SUPPORTED_SCHEMA_MAJOR, SUPPORTED_SCHEMA_MAJOR]`, which keeps an old
integer `2` readable after the bump. No migration library is added: it would
duplicate this registry and this validator for no new capability.
