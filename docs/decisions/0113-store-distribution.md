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

## Problem

Every package kind must publish, review, install, update and be revoked through
one store. A wrong integration fails quietly: a non-theme version accepted
without digest verification, a manifest publisher trusted over the account, a
hardware plugin published before review, an update that grows access applied
without review, or a killed plugin that still loads because its consent row
exists.

## Rung 1 — internal owner

Searched: CodeGraph/source for `entryOf`, `requestVersion`, `finalizeVersion`,
`planVersion`, `finalizeStoredVersion`, `item`/`item_version` rows,
`createExtensionService`, `PluginInstaller`, `WidgetPackStore`,
`PathPresetStore`, `installCatalogueItem`, `accessGrowth`.

Found: `store-worker` already owns the version ladder (`version/plan.ts`), the
six-state status machine, the proxied-upload reservation, `finalizeVersion`'s
byte/hash comparison, and the catalogue entry (`catalogue/entry.ts`).
`@yunari/extension-api` already owns the manifest, package reader, consent
binding, `accessGrowth` and `consentRequired`. The host already has one
installed widget-pack store, one path-preset store and one plugin installer.
The unsolved seam is elsewhere: the store has no non-theme version path, no
store-account publisher, no review gate, no kill list, and the host install
route only dispatches `dashboard-theme`.

## Rung 2 — installed dependencies

Searched: `store-worker`'s existing `@yunari/theme-package` dependency
(`readWidgetPackage`, `readPathPresetPack`, `readEditorThemePackage`), and
`@yunari/extension-api` (`readPluginPackage`, `readPluginManifest`,
`validateManifestExecution`, `consentFingerprint`, `accessGrowth`), plus the
Worker's `crypto.subtle` and R2 bindings.

Found: every package reader already exists and is pure; the Worker runs a
library that already extracts zip archives, so no new runtime dependency is
needed. R2 retains the one pending object and the version's package key, and
`crypto.subtle.digest` already verifies the index ETag, so digest verification
is the same primitive. Orca's own extension host donates no code, only the
mechanics named in rung 4.

## Rung 3 — native platform

Searched: Cloudflare Workers `crypto.subtle`, D1 `ALTER TABLE`/`CHECK`
constraints and batched statements, R2 conditional put; Node `node:crypto`
SHA-256 and `node:fs/promises`.

Found: D1 constraints enforce the review vocabulary at the storage boundary,
and one `db.batch` makes a version-and-item review decision atomic. Node
`createHash("sha256")` verifies a host download without a dependency. Neither
platform supplies the per-kind validation rules or publisher derivation, which
remain the app's.

## Rung 4 — public solutions

Searched: VS Code Marketplace publishing/review and Open VSX publisher
namespaces; Figma community manifest publisher rules; Chrome Web Store
publisher verification and item takedown; Homebrew's formula tap trust model
and cask quarantine; npm's deprecation/revocation guidance.

Found: each separates a *publisher identity* verified by the registry from an
author-supplied manifest field, and each treats a takedown as a registry-side
list that clients may ignore fields they do not know in. The store review gate
before publish for privileged items is the same shape as Chrome Web Store's
review tier. None dispenses with host-side revalidation, and none fits Yunari's
existing D1 tables without a second catalogue.

## Rung 5 — integration comparison

| Option | Fit | Unsolved work | Verdict |
|---|---|---|---|
| Extend `item`/`item_version` and the existing finalize path | Keeps one version ladder, one status machine, one catalogue entry; reuses `readPluginPackage` and the host stores | Add kind columns, publisher, review state, kill list; branch `requestVersion` and finalize by kind | Chosen |
| A second catalogue/table for packs and plugins | Leaves themes untouched | Duplicate ladder, status, download counting, author listing; two listings can disagree | Rejected |
| Separate per-kind Workers | Isolates failures | Duplicate auth, uploads, quota and review; no single publisher identity | Rejected |
| Trust a manifest `publisher` | No new columns | Any account can claim `yunari`; consent keys collide | Rejected by spec |
| Client-side digest check only | Less Worker work | The store would publish bytes it never verified | Rejected |

## Rung 6 — smallest probe

The probe is a widget-pack submission whose declared digest differs from the
uploaded bytes: the version request reserves, the PUT stores the bytes, and
finalize must refuse with 400 and leave no `item_version` row. That probe runs
first in the Worker suite (`tests/packs.spec.ts`) before any host wiring, and it
executes the real R2 and D1 loop the design depends on.

## Decision

Extend the existing tables, routes, finalize path and catalogue entry; add one
metadata/review/kill-list migration and one `catalogue/kinds.ts` owner for
per-kind validation. Publisher is derived from the store account and written to
`item.publisher`; hardware plugins enter review. The host gains a kill-list
store and a kind-dispatching installer that reuses the existing theme, widget,
preset and plugin installers. No second catalogue, no new runtime dependency.
