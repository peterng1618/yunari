# 0139 — library store

- **Date:** 2026-11-16
- **Status:** accepted
- **Paths:** `src/web/packages/renderer-core/src/theme/catalogue-index.ts`
  `src/web/packages/renderer-core/src/theme/collection-plan.ts`
  `src/web/packages/renderer-core/src/theme/catalogue-location.ts`
  `src/web/packages/renderer-core/src/index.ts`
  `src/web/packages/store-worker/src/catalogue/kinds.ts`
  `src/web/packages/store-worker/src/catalogue/entry.ts`
  `src/web/packages/store-worker/src/routes/public.ts`
  `src/web/packages/host/src/store/install.ts`
  `src/web/packages/host/src/settings/catalogue-origins.ts`
  `src/web/packages/host/src/settings/theme-origins.ts`
  `src/web/packages/host/src/presets/path-presets.ts`
  `src/web/packages/host/src/themes/install.ts`
  `src/web/packages/host/src/extensions/install.ts`
  `src/web/packages/host/src/extensions/service.ts`
  `src/web/packages/host/src/server/theme-writes.ts`
  `src/web/packages/host/src/server/themes-routes.ts`
  `src/web/packages/host/src/server/extension-routes.ts`
  `src/web/packages/host/src/catalogue/build-index.ts`
  `src/web/packages/editor/src/store-mode/region.tsx`
  `src/web/packages/editor/src/store-mode/local-source.ts`
  `src/web/packages/editor/src/store-mode/online-source.ts`
  `src/web/packages/editor/src/store-mode/mine-source.ts`
  `src/web/packages/editor/src/store-mode/item-modal.tsx`
  `src/web/packages/editor/src/store-mode/gallery.tsx`
  `src/web/packages/editor/src/store-mode/install-item.ts`
  `src/web/packages/editor/src/store-mode/use-install.ts`
  `src/web/packages/editor/src/editor-shell/shell-layout.tsx`
  `src/web/packages/editor/src/editor-shell/editor-shell.css`

## Problem

One Library must find, install, update and revoke every user-extensible thing:
dashboard themes, app themes, widgets, shapes, sensor providers, asset sources,
panel drivers, data sources, and collections that install several listings in
one press. The store must stay the distribution and trust layer; package readers
stay the owners of what an item contains.

A wrong integration fails quietly in four places: a collection that partially
installs while claiming success; a member derived from a submission rather than
the bytes the store validated; installed state keyed by theme id only, so two
kinds with one id disagree; and a submitter-supplied package format that bypasses
the existing reader, size and digest checks. The design also rejects three
alternatives in the spec's **Decisions**: one listing per kind, a unified package
format, and pinned collections.

## Rung 1 — internal owner

Searched: CodeGraph for `STORE_ITEM_KINDS`, `CatalogueEntry`,
`parseCatalogueIndex`, `parseCatalogueItemFile`, `entryOf`, `itemFileOf`,
`readPackSubmission`, `validateFinalizedPackage`, `defaultFacetsFor`,
`installCatalogueItem`, `installByKind`, `createThemeOriginsStore`,
`StoreModeRegion`, `StoreTab`, `ItemSource`, `install-item.ts`, `use-install.ts`;
source of the same files and their callers.

Found: the backend is already largely kind-neutral.

- `renderer-core/src/theme/catalogue-index.ts` owns the wire:
  `STORE_ITEM_KINDS` is the five listing kinds, `CatalogueEntry` carries one
  `kind`, one package and one version; `parseCatalogueIndex` reports an entry
  whose kind this build does not ship as `unknown-kind` rather than dropping it,
  while `parseCatalogueItemFile` refuses such a kind. There is no member record,
  collection kind or `includes`.
- `store-worker/src/catalogue/kinds.ts` owns non-theme submissions and
  validation: `readPackSubmission`, `validateFinalizedPackage` (which calls
  `readWidgetPackage`, `readPathPresetPack`, `readEditorThemePackage`,
  `readPluginPackage`) and `defaultFacetsFor`. `catalogue/entry.ts` `entryOf`
  and `itemFileOf` are one projection from rows to the wire. Neither knows a
  collection.
- `store-worker/src/routes/public.ts` `handlePublic` serves `/index.json` and
  `item.json` from those projections. The host's offline catalogue generator
  `catalogue/build-index.ts` writes the same `CatalogueEntry` shape, so the wire
  has one parser and one projection rather than a per-surface format.
- `host/src/store/install.ts` `installCatalogueItem` downloads, checks size and
  SHA-256, then `installByKind` switches over `dashboard-theme`, `widget-pack`,
  `path-preset-pack`, `editor-theme` and `plugin`. There is no collection case,
  no plan route and no multi-item pre-flight.
- `host/src/settings/theme-origins.ts` `createThemeOriginsStore` keeps
  `ThemeOrigin { catalogueId, version, installedAt }` keyed by library theme id.
  `server/themes-routes.ts`, `server/extension-routes.ts` and
  `server/theme-writes.ts` are its readers and writers; `extension-routes.ts`
  serves `/api/extensions` rows without an `origin`. Packs, presets, editor
  themes and plugins have no installed-origin record.
- `editor/src/store-mode/` is theme-only: `StoreModeRegion` renders only when
  `mode === "themes"`, `StoreTab` is `"local" | "online"`, `local-source.ts`,
  `online-source.ts` and `mine-source.ts` pin `DASHBOARD_THEME_KIND`, and
  `region.tsx`, `gallery.tsx`, `item-modal.tsx`, `install-item.ts` and
  `use-install.ts` carry theme-shaped cells, filters and copy. The shell's
  `ShellMode` in `editor-shell/shell-layout.tsx` names the third mode `themes`.

Unsolved: member derivation, a collection listing and package, the collection
plan wire types, collection pre-flight/install, a kind-keyed origin register,
and non-theme Library surfaces.

The collection pre-flight adds no second owner for these mechanisms:
`renderer-core/src/theme/catalogue-location.ts` `catalogueItemUrl` keeps the
one spelling of `catalogue/<id>/item.json` and gains the store origin as an
argument; `host/src/presets/path-presets.ts` owns the pack shape and its
paint-versus-geometry rule, extracted so `addPack` and the pre-flight call one
validator; `host/src/themes/install.ts` owns the dashboard theme's single
origin write, which accepts the merged `collections` rather than leaving a
second writer; `host/src/settings/catalogue-origins.ts` owns the register key
and exposes the rows of one catalogue id; and `host/src/extensions/service.ts`
owns the kill list, so `isKilled` is answered there for the pre-flight.

## Rung 2 — installed dependencies

Searched: `@yunari/theme-package` `readPackageArchive`, `readThemePackage`,
`readWidgetPackage`, `readWidgetPackageFiles`, `readPathPresetPack`,
`readEditorThemePackage`; `@yunari/extension-api` `readPluginPackage`,
`readPluginManifest`, `PluginContributions`, `validateManifestExecution`,
`consentFingerprint`, `accessGrowth`; their tests and callers.

Found: every existing kind already has a pure, bounded reader. A widget pack
yields units with `id`/`label`; a path preset pack yields presets with
`id`/`label`; an editor theme yields its document `name`; a plugin manifest
contributes `sensorProviders`, `customSources`, `assetSources` and
`panelFamilies` as id-bearing groups, with `settingsPages` and
`assetCategories` present but not browseable members. `readPluginPackage`
enforces archive path, entry-count and expanded-size limits before any name
reaches disk, and consent is already recorded per plugin.
`validateFinalizedPackage` already derives the metadata name and per-kind facts
at finalize.

Nothing donates collection reading or member derivation. A collection is plain
JSON, not an archive, so no new archive or runtime dependency is needed: one
small bounded JSON reader beside the existing ones, plus derivation from the
readers the store already calls, covers it.

## Rung 3 — native platform

Searched: D1 schema in `store-worker/migrations/0001_catalogue.sql`,
`store-worker/migrations/0006_extension_kinds.sql` and
`store-worker/src/db/types.ts`; WebCrypto / Node `crypto.subtle` SHA-256;
`JSON.parse` and `TextDecoder`.

Found: `item.kind` is unconstrained `TEXT`, `item_version` already has
`metadata_json`, `envelope_json`, `facets_json`, `package_key`, `bytes`,
`sha256`, `execution_profile`, `review_state` and the version primary key.
A collection version fits those columns unchanged: its manifest is
`metadata_json`, its package facts are `package_key`/`bytes`/`sha256`, and its
members are derived at finalize and emitted from the same rows. No new table,
column or index is needed; the spec records that nothing has been published, so
no published row needs migrating.

The platform does not validate a collection manifest or resolve its ids. D1
stores the row; the store worker must still refuse unknown, unpublished,
duplicate, self and nested ids before writing it. SHA-256 is the primitive the
Worker and host already use, so integrity is unchanged.

## Rung 4 — public solutions

Searched: the installed Orca marketplace artifacts under
`resources/plugins/launch/`: `orca-marketplace.json` (plugin `id`, git `source`,
description, categories), `bundled-plugins.json` (`pluginKey`, path,
`contentHash`), and the shipped plugin manifests, including
`stablyai.orca-vscode-default-themes/orca-plugin.json` and
`stablyai.orca-github-vscode-theme/orca-plugin.json`. Also re-read the prior
comparison in `docs/decisions/0113-store-distribution.md` (VS Code Marketplace
and Open VSX, Figma, Chrome Web Store, Homebrew, npm).

Found: Orca separates the marketplace index (discovery and trust) from package
content, and one plugin package contributes many named browseable entries under
`contributes.themes[]`, each `{ id, title, path }`. The index itself lists
plugins, not those entries; the client derives the entries from the validated
manifest. That is the member model: one listing, one package, one version
ladder, many browseable members.

The compared marketplaces publish per-extension listings and either declare
dependencies (VS Code extension packs) or leave composition to the user. None
treats a collection as a first-class listing with one install sheet, one
aggregate consent summary and a non-atomic per-member retry. Collection
semantics therefore remain Yunari's to own, but the store/package split and
derived-member rule can be reused.

## Rung 5 — integration comparison

| Option | Fit | Unsolved work | Verdict |
|---|---|---|---|
| Extend the existing `CatalogueEntry`, version ladder, readers and `installByKind` | One wire, one parser, one version ladder, one review/consent path; every existing reader stays the validator | Add `members`/`includes`, a `collection` kind and package reader, finalize id resolution, host pre-flight/plan route, kind-keyed origins, member-aware Library UI | Chosen |
| One listing per kind, as shipped today | No catalogue change | A matching theme and widget pack cannot ship as one unit; consent, update and revocation fragment per kind; the Library still needs a collection concept | Rejected by the spec's **Decisions** |
| A new unified package format | One container for every kind | Rewrites every reader and its path, size, entry and digest checks; no consumer needs it | Rejected by the spec's **Decisions** |
| Pin collection members to exact versions | Reproducible installs | Every member update needs a collection release; duplicates the version ladder's resolution; the spec chooses latest | Rejected by the spec's **Decisions** |
| A second catalogue/table for collections | Leaves the theme path untouched | Duplicate ladder, status, downloads and listing; two sources can disagree (the same reason 0113 rejected a second catalogue) | Rejected |
| Let a submission declare its own members | No derivation | A package can claim members it does not contain; browse data and installed files disagree | Rejected |
| Install the collection store-side or client-side | No new host path | Moves validation, digest checks and consent out of the host that writes the files | Rejected |

## Rung 6 — smallest probe

No executable probe was warranted. The decision adds no platform primitive:
the collection package is bounded JSON read with the same UTF-8/`JSON.parse`
and record validation as the path-preset branch of `validateFinalizedPackage`,
under the store's existing upload size ceiling; member
derivation is a switch over readers the store already calls; install composes
`installByKind` paths that `host/src/store/install.test.ts` already exercises.
The behaviour in doubt — refusing an unknown, duplicate, self or nested id, and
writing nothing when a member fails pre-flight — is new app logic, not an
unknown platform or library answer, so the plan's Worker and host tests are the
probe rather than a disposable script.

## Decision

Extend the existing catalogue rather than build a second one:

- `renderer-core/src/theme/catalogue-index.ts` gains `MEMBER_KINDS`, a
  `MemberRecord { id, kind, name }`, required `members` on every entry and
  `includes` only on a `collection` entry. `parseCatalogueIndex` and
  `parseCatalogueItemFile` keep an unknown member kind, refuse a malformed
  member, and refuse `includes` on a non-collection.
- `renderer-core/src/theme/collection-plan.ts` owns the plan's wire types
  (`CollectionPlan`, `CollectionPlanMember`); it is types only and derives
  nothing, so the host and the install sheet read one shape.
- `store-worker/src/catalogue/kinds.ts` gains the `collection` package
  (`yunari-collection`, version 1) as bounded JSON, and finalize derives members
  from each kind's own reader. Unknown, unpublished, duplicate, self and nested
  ids are refused before an `item_version` row exists. `catalogue/entry.ts`
  emits `members` and `includes`; no new table or column.
- `host/src/store/install.ts` gains a collection case that resolves included
  ids against the configured store origin, verifies every chosen member's size
  and digest, validates it with its existing reader, checks the kill list and
  consent, and only then installs each member through its per-kind path. A
  refused member refuses the collection and writes nothing; a mid-way failure
  reports which members installed and which did not.
- `host/src/settings/theme-origins.ts` becomes a kind-keyed register
  (`<kind>:<id>`, with `kind`, `catalogueId`, `version`, `installedAt`,
  `collections?`), reading legacy bare-id theme rows as `dashboard-theme`
  additively. The listing routes expose that one fact, including the `origin`
  field on `/api/extensions` rows in `server/extension-routes.ts`.
- `editor/src/store-mode/` and `editor-shell/shell-layout.tsx` generalize the
  theme-only region into the Library mode; the existing gallery, facets, sort,
  density and install controls are kept, and the theme-only duplicates are
  deleted rather than wrapped.

Rejected: one listing per kind (cannot ship a matching set as one unit),
one unified package format (rewrites every reader and its safety checks), and
pinned collections (a collection resolves latest). A second catalogue, a
submission-declared member list and store-side/client-side install are also
rejected for the reasons in rung 5. No new runtime dependency is added.
