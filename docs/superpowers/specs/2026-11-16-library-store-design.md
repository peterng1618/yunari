# Library and store design (packages, members, collections)

## Status

Design approved in conversation. This written spec awaits review before an
implementation plan is written.

## Goal

One Library surface and one catalogue model for every user-extensible surface in
Yunari: dashboard themes, app themes, widgets, shapes, sensor providers, asset
sources, panel drivers and custom data sources, plus curated collections that
install several of them in one press.

The store must stay a distribution and trust layer. Content formats and their
readers remain the owners of what an item is; the store owns how it is found,
installed, verified, updated and revoked.

## Current state

The backend is already kind-neutral; the UI is not.

| Area | Today | Gap |
|---|---|---|
| Store kinds | `dashboard-theme`, `editor-theme`, `widget-pack`, `path-preset-pack`, `plugin` (`renderer-core/src/theme/catalogue-index.ts` `STORE_ITEM_KINDS`) | No collection kind; a catalogue entry is one indivisible item |
| Catalogue wire | `CatalogueEntry` carries one `kind`, facets, package facts | No members, no collection membership |
| Store worker | `catalogue/kinds.ts` validates each non-theme kind from its package reader; `entryOf` derives the wire entry | No collection validation or member derivation |
| Host install | `store/install.ts` dispatches by kind and writes to the kind's own store | No multi-item install, no collection pre-flight |
| Installed origin | `settings/theme-origins.ts`, keyed by library theme id | Theme-only, so packs, presets, editor themes and plugins cannot report installed state |
| Editor surfaces | Themes mode (`StoreModeRegion`) reads only `DASHBOARD_THEME_KIND`; plugins live in Settings → Extensions; widget packs in the Add pane; path presets in the shape tool | Five kinds, four disconnected surfaces, no shared navigation, filter or detail |
| Catalogue producer | One: the Worker's `/index.json` (`routes/public.ts`); one parser (`parseCatalogueIndex`) | Good — one producer and one parser to extend |

Per the project owner, nothing has been published. Catalogue wire changes
therefore need no migration of published rows.

## Decisions

1. **The listing is the install unit. The member is the browse unit.** A listing
   is one catalogue item with one package and one version ladder. Its members are
   the things a person shops for: a widget, a shape, a theme, a provider.
2. **A collection is a listing of listings.** Its package is a JSON manifest of
   catalogue ids. Installing a collection installs its member listings; after
   install every member is an ordinary item. The collection leaves provenance,
   not a container.
3. **Collections resolve latest.** Members are ids, not pinned versions.
   A member update needs no collection release; a new collection version adds or
   removes ids.
4. **Install is a preset with opt-out.** Optional includes may be unticked;
   required ones are locked and carry the provider a data member needs.
5. **One install sheet, aggregated consent.** A collection's sheet lists every
   member and every code member's authority in one place. Consent is still
   recorded per plugin by the existing consent store.
6. **Anyone may publish a collection over published listings**, with member
   attribution. A collection cannot claim a member's publisher or a reserved
   publisher name.
7. **Still one grid with a state filter**: All · On this PC · Not installed.
8. **Flat type navigation**: Dashboard themes, App themes, Widgets, Shapes,
   Sensor providers (Sensors · Data sources), Asset sources, Panel drivers, plus
   Collections and My submissions.
9. **The shell's third mode is renamed Library.** Settings keeps trust only.
10. **Rejected:** one listing per kind (cannot ship a matching set as one unit,
    and consent/update/revocation would fragment per kind); a new unified package
    format (rewrites every reader and its safety checks); pinned collections (a
    collection resolves latest by decision 3); per-item install from a preset
    (breaks one-consent and makes partial-update reasoning per subset).

## Model

### Nouns

| Noun | Meaning | Owner |
|---|---|---|
| Listing | One catalogue item, one package, one version ladder. Kinds: `dashboard-theme`, `editor-theme`, `widget-pack`, `path-preset-pack`, `plugin`, `collection`. | store-worker `item` / `item_version`; each kind's host store for content |
| Member | One browseable unit inside a listing. Every listing has at least one. | Derived once at finalize from the package the store validated |
| Collection | A listing whose package lists catalogue ids. | store-worker `catalogue/kinds.ts`; storefront for presentation |

### Member kinds

`dashboard-theme`, `editor-theme`, `widget`, `shape`, `sensor-provider`,
`asset-source`, `panel-driver`, `data-source`.

The vocabulary is wire data and lives in `renderer-core` beside
`STORE_ITEM_KINDS`. A member kind this build does not ship is still readable and
prints its identifier, matching the rule the catalogue already applies to unknown
listing kinds.

### Derivation per listing kind

Derived by the store at finalize from the package it has already validated, using
the package's own reader. A member is never declared by a submission.

| Listing kind | Members | Source of id and name |
|---|---|---|
| `dashboard-theme` | one | `FabricThemeEnvelope.id`; listing name |
| `editor-theme` | one | The document's `name` |
| `widget-pack` | each derived unit | `readWidgetPackage` units (`id`, `label`) |
| `path-preset-pack` | each preset | `readPathPresetPack` presets (`id`, `label`) |
| `plugin` | each contribution | `contributes.sensorProviders`, `customSources`, `assetSources`, `panelFamilies` → `sensor-provider`, `data-source`, `asset-source`, `panel-driver`. `settingsPages` and `assetCategories` are not members |
| `collection` | none | Its included listings are `includes`, not members |

Per-member pictures are not part of v1. A member card draws its listing's
picture or ground.

## Wire shape

`renderer-core/src/theme/catalogue-index.ts`:

- `STORE_ITEM_KINDS` gains `"collection"`.
- `MEMBER_KINDS` is the closed member vocabulary above.
- `CatalogueEntry.members: readonly MemberRecord[]` is required;
  `MemberRecord = { id, kind, name }`. A collection entry carries `members: []`.
- `CatalogueEntry.includes?: readonly string[]` is present only on a collection
  and holds catalogue ids.
- `parseCatalogueIndex` requires `members` to be an array of records with three
  usable strings and refuses only a malformed member; an unknown member kind is
  kept. `includes` is validated as catalogue ids on a collection entry and is
  refused on any other kind.
- The catalogue's `item.json` carries the same fields as `/index.json`, because
  `itemFileOf` is one projection.

Collection membership is read only from collection entries. "Part of" is a
derived view over the index, not a reverse field on every member listing, so one
entry owns the fact. Unknown or unpublished included ids are reported by the
surface as unavailable and block collection install.

## Store worker

- `catalogue/kinds.ts` gains the `collection` package:
  `{ format: "yunari-collection", version: 1, name, description, includes: [{ id, optional? }] }`.
  `optional` defaults to `false`. The package is validated as JSON with bounded
  size and verified by SHA-256 and byte count like every other kind. It is never
  executed.
- Finalize refuses a collection that names an unknown or unpublished id, a
  duplicate id, itself, or another collection. Collections are one level deep.
- `entryOf` emits `members` from the table above and `includes` from the
  collection manifest. The entry's `name` for a collection is the manifest name;
  its facets are the listing's default facets.
- No new table: `item.kind`, `item_version.metadata_json`, `package_key`,
  `bytes` and `sha256` already carry a collection. The version ladder is
  unchanged.
- `routes/public.ts` keeps serving one `/index.json` and one `item.json` per
  item; caching and ETag rules are unchanged.

## Host

- `store/install.ts` gains a `collection` case. The host reads the collection
  package, then for each chosen include fetches
  `catalogue/<id>/item.json` from the configured store origin — never a
  client-supplied URL — and resolves that listing's latest published version.
- **Pre-flight before any write:** verify every chosen member's size and SHA-256,
  validate each with its existing package reader, check the kill list and resolve
  consent. One refused member refuses the collection by name and writes nothing.
- A `POST /api/store/collection/plan` route returns that verified member list and
  each code member's consent summary without writing, so the install sheet can
  show capabilities and devices before the person presses Install. Install
  re-runs the pre-flight and never trusts the plan.
- **Then install each chosen member through its existing per-kind path.** A write
  failure part-way reports which members installed and which did not; a retry
  skips members already installed. This is the accepted non-atomic edge.
- The install request names the chosen listing ids. Required includes must all be
  present; optional includes may be omitted. The host re-checks the collection
  manifest rather than trusting the request's shape.
- **Catalogue origins:** generalize `settings/theme-origins.ts` into one register
  for every kind, storing
  `{ kind, catalogueId, version, installedAt, collections? }` per installed
  object, keyed `<kind>:<installed id>`. The file is read additively: existing
  bare-id theme rows are read as `dashboard-theme` and are never dropped; a write
  rewrites that entry in the new shape. The kind in the key is what keeps two
  objects with the same id apart.
- Each kind's listing route returns the origin for its rows (`/api/themes`
  already does; widget packs, path presets, editor themes and extensions gain the
  same field). The editor's state filter and update check read that one fact.
- Plugin consent, update holds (`decideUpdate`), kill-list behaviour and device
  access are unchanged and stay with their owners.

## Library UI

**Shell.** `ShellMode`'s `themes` mode becomes `library`; the header's third
segment reads **Library**. `DESIGN.md` and `editor-shell.css` change together,
then `npm run design:check`. The header remains the only horizontal bar.

**Navigation.** Inside Library, a fixed navigation column, grouped as Settings'
destinations already are:

- **Browse** — Dashboard themes · App themes · Widgets · Shapes ·
  Sensor providers · Asset sources · Panel drivers · Collections
- **Publish** — My submissions

The Sensor providers page carries a `Sensors · Data sources` sub-filter. Mine
keeps `use-submit` and becomes My submissions.

**Per-type page.** Header right region: state filter `All · On this PC · Not
installed`. Page toolbar: search, facets, sort, density — the existing gallery
pattern. Facets are the listing's record plus a **Collection** facet; theme
facets stay on the theme page. Grid cells:

- member card: picture or ground, name, publisher, state badge, Install control;
- pack card: cover, member count, an expand button with `aria-expanded`, opening
  the pack's member cards in place;
- pressing Install on a member installs its listing.

**Detail modal** (generalize `store-mode/item-modal.tsx`): cover, description,
publisher, version, updated, size, member links, **Part of** collections,
install/update state and held-update notice. Code members add a trust block —
execution profile, capabilities, device ids — linking to Settings → Extensions,
the only place consent and provider order change. Actions by member kind:

| Kind | Actions |
|---|---|
| dashboard theme | Open in editor · Assign to display · Export · Delete |
| app theme | Apply to editor · Export · Delete |
| widget | Insert in canvas · Remove pack |
| shape | Insert · Remove pack |
| sensor provider, data source, asset source | Enable · Configure · Remove plugin |
| panel driver | Assign display · Device status · Remove plugin |
| collection | Install · Update · Remove members |

**Install/update sheet.** Included items with kind, publisher, size and an
optional checkbox (required locked); total size; the aggregated consent section
for code members; then Install. Update is a diff: missing members offered,
dropped members offered for removal, never removed silently. Any unavailable
member is named and blocks the press.

**Collection state and diff.** A collection is *On this PC* when every required
include is installed; a partial install reads as *N of M installed* and offers
Update. The diff resolves the collection's current includes and compares them
with the catalogue-origin records whose `collections` name this collection.
Dropped members are those recorded but no longer included.

**Cross-links, no duplicated lists.** Add pane → Browse widgets; shape preset
list → Browse shapes; app-theme picker → Browse app themes; code detail →
Settings → Extensions. A failed read remains a stated failure with retry, never
an empty listing; an unknown kind prints its identifier.

## Publishing

- Existing kinds keep their submission, validation and version ladder; finalize
  adds member derivation.
- Collections are self-serve and carry no review. My submissions gains a
  collection builder: pick published listings, mark each optional or required,
  name, version, description. All ids must resolve at publish.
- Membership changes ship as a new collection version. Member updates do not
  change a collection, because install resolves latest.

## Trust and security invariants

- A collection is data: it receives no consent of its own and cannot execute
  anything. It cannot authorize a member; each plugin's consent is separate.
- Member cards and the install sheet always show the real publisher. A
  collection cannot imply endorsement by a member's publisher.
- A killed or unpublished member blocks collection install and is named.
  Installed copies follow the existing kill-list rule.
- No fabricated telemetry: when a data member's provider is absent, the runtime
  reports missing readings, never zero or a placeholder.
- Store paths, sizes, hashes, manifests and package readers remain the
  validators. The host revalidates every member before writing.
- Credentials stay in the host; nothing in this design hands a browser or a
  collection a credential.
- LAN and admin rules are unchanged. Plugin management stays loopback-only.

## Migration and deletions

- Local authored themes, widget packs and path presets are untouched.
- Catalogue rows: no migration because nothing is published; the wire change is
  a clean break.
- `theme-origins.json` is read additively as above; no installed theme loses its
  origin.
- The theme-only store code loses its duplicates: `StoreTab` halves, the
  theme-only `ItemSource` sources, theme-only cell/modal facts and the
  one-entry `uiCopy.store.cell.kinds`. The theme facets, gallery, sorting,
  density and install controls are retained and generalized.
- Settings → Extensions becomes the trust page only. Install-from-file remains
  there for development and agent parity.
- The theme-library chooser used to open an existing theme stays; it is not a
  store surface.

## Reuse gate

This changes a mechanism boundary (store distribution and install). Before
implementation, record the seven-rung reuse evidence in a new
`docs/decisions/<next number>-library-store.md` using `docs/decisions/README.md`.
The note cites the existing `0113-store-distribution.md`,
`0114-executable-extensions.md` and this spec, and states the rejected
alternatives in **Decisions**.

## Proof

- store-worker: collection refusals (unknown, unpublished, duplicate, self,
  nested); member derivation for every listing kind; `/index.json` and
  `item.json` carry `members`/`includes`; no second entry per member.
- renderer-core: parser keeps an unknown member kind, refuses a malformed member
  and a non-collection `includes`; membership is derived only from collection
  entries.
- host: pre-flight writes nothing on failure; mid-way failure reports per member;
  retry skips installed members; origin register round-trips legacy theme rows and
  a record for each kind; kill blocks collection install; collection state and
  diff (partial, dropped member) never remove without consent.
- editor: navigation and state filter; pack expansion; opt-out sheet; aggregated
  consent; held update; failed read versus empty; keyboard and aria for the nav,
  expansion and sheet.
- Final gate: `cd src/web && npm run gate` exits 0. The Library flow also runs in
  `npm run build && npm run test:e2e` before it is called done.

## Accepted limits

- A collection downloads each member separately; assets shared between a theme
  and a matching widget pack are duplicated. No shared-bytes container.
- Installs are not reproducible: members resolve to their latest published
  version.
- A collection can break when a member unpublishes or updates; the surface names
  the unavailable member and the sheet shows the versions it actually installs.
- A member update does not change a collection's version, by design.
- Per-member facets for widgets, shapes and code kinds are deferred; type pages
  filter on listing facets, the Collection facet, publisher and name.
- Per-member pictures are deferred; member cards draw their listing's picture.
