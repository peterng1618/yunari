# Fonts and assets — the type library, the Assets pane, and import

- **Date:** 2026-10-25
- **Status:** draft for review. Plan: [`2026-10-25-fonts-and-assets.md`](../plans/2026-10-25-fonts-and-assets.md).
- **Supersedes in part:**
  - [`2026-09-27-font-trio-catalog-design.md`](2026-09-27-font-trio-catalog-design.md) —
    the generated catalogue, pinned faces, bound presets and Unbind stand; its
    face picker, facet selects, favourites-only filter, trio select and
    type-preset panel sections do not.
  - [`2026-10-08-editor-design-language-design.md`](2026-10-08-editor-design-language-design.md)
    §5.2 (Add absorbs the Assets pane) and §5.3 (type presets edited in Tokens):
    this design restores a fifth rail slot named Assets and moves preset
    editing to the inspector.
  - `vg-154`'s ruling that the Assets pane should not exist is reversed by the
    user on 2026-10-25, for the reason recorded in R1.
- **Related:** [`2026-10-21-asset-finder-design.md`](2026-10-21-asset-finder-design.md)
  (the finder, its source registry and its host-owned providers),
  [`2026-10-12-theme-store-design.md`](2026-10-12-theme-store-design.md)
  (the theme viewer this design's preview modal follows),
  [`2026-10-24-text-elements-design.md`](2026-10-24-text-elements-design.md)
  (type presets as text treatments), `requirements.md` §132.

## What this is, and is not

**This is** one connected change to type authoring and to the theme's asset
library: a fifth **Assets** pane that owns every declared file and every local
import; a Fonts finder that browses provider families and trios with a real
preview; two explicit trio outcomes; single-font presets that bind their face;
an inspector that edits the selected token; and an opt-in cleanup that keeps a
package from growing forever.

**This is not** a new package format, a second asset registry, or a new renderer
path. Every byte still goes through `AssetManager`, every provider through
`ASSET_SOURCES`, and every package through the existing theme package.

## Rulings taken 2026-10-25

Provenance: R1–R14 are the user's decisions in the session that produced the
approved mockups in `docs/design/mockups/current/`; the quoted turns are in that
session's transcript.

**R1 — The Assets pane returns, as a fifth rail slot.** The user asked for a new
"Asset" rail item and panel holding local font and media import. The 2026-10-08
ruling that Add absorbs the Assets pane was made when import meant "place"; the
distinction that reverses it is R2. `RailSlot`, `RAIL_SLOTS`, `RAIL_GLYPHS`,
`uiCopy.rail.slots`, `ShellHosts` and `DESIGN.md` §7.2 move together. Add stays
insertion-only.

**R2 — Import declares bytes; placement is a separate act.** The user's words:
importing into the theme's asset library is not the same as placing a canvas
object that references it. A row action **Place on canvas** places an image or
an SVG; **Set as background** applies a picture or a video. Import no longer
places as a side effect.

**R3 — Import still performs one automatic placement where the kind makes it
unambiguous.** Font → no placement (metadata form, then a preset). Image/SVG →
place in the canvas centre. Video → set as background media. The OS file picker
returns files, never an intent, so the pane offers two controls: **Import**
(routes by kind) and **Import as background** (forces an image or video into
background media, so a raster image has both paths). A selected card exposes
every eligible action, so a wrong automatic choice is one press away.

**R4 — Local import lives in Assets, not in the finder.** The finder browses
providers only. Its entry is the Assets pane's **Find assets** control and the
File menu; the Add pane's file section and its finder button leave. This mirrors
the rule the user applied to media: you do not open the finder to import a local
file.

**R5 — The finder searches font names.** A query matches family names, trio
names, trio descriptions and the families inside a trio, so `Inter` finds the
family and every trio containing it. Results mix trios and families in one grid
with a provider badge per tile; `All / Trios / Fonts` filters and the provider
chips replace the three exclusive facet selects and the rule sentence.

**R6 — The preview is a specimen card plus the author's sample text.** A trio
renders heading, body and mono together in the card; a family renders the
selected cut. Choosing a tile opens the preview panel; the result list is never
replaced by the preview.

**R7 — Two explicit trio outcomes, and the preview names the consequence.**
**Apply to theme** rewrites family and weight on every preset carrying a role
and creates any missing role preset; size, line-height and letter-spacing are
preserved. **Add 3 presets** creates `Heading — X`, `Body — Y`, `Mono — Z`
without touching existing presets. The preview reads the scope and each change
(`Heading × 6 · Body × 6 · Mono × 1`, `Clock 108 · 300 → Manrope 700`). Apply is
disabled with a reason when there are no role-tagged presets. This makes the old
silent rewrite legible instead of removing the one-click convenience.

**R8 — A trio is a provider bundle, not three presets.** A type preset is one
treatment (family, size, weight, line-height, tracking) with an optional role
tag. The starter scale is 13 presets — 6 heading, 6 body, 1 mono — and applying
a trio reskins all 13 because text objects reference them. Role becomes editable
per preset; today only the starter 13 can participate.

**R9 — A single font creates a preset; it never rewrites one.** **Add as type
preset** names it role-first (`<Role> — <Family>`), sizes it by role, and defaults
the role to Body. **Apply to selected preset** is a secondary action only when
the canvas selection resolves to a preset, and it names the target. Import is
non-destructive by default. A font may stay declared without a preset; that is
the work-in-progress case R12 protects.

**R10 — A preset that carries an adopted face is bound.** Family and weight are
read-only and show the packaged face; **Unbind** releases them. This closes
`vg-549`. The validator still refuses a hand-edited package whose face and
family disagree.

**R11 — Providers are host-owned asset sources.** `curated-fonts` (the Fonttrio
catalogue) and `google-fonts` (Fontsource, filtered to `type: "google"`) become
entries in `ASSET_SOURCES` with `category: "font"` and `body: "font-picker"`,
following the icons and images. The generated catalogue moves out of the editor
into the host, so the editor bundle drops it. Local file is not a search source.
Search runs through `/api/assets/search`; bytes through `/api/assets/bytes`.
Fontsource was chosen because it is keyless, CORS-open, licence-correct,
subset-aware and version-pinned; Google's own metadata has no licence and no pin.

**R12 — Cleanup is opt-in on both save flows and never automatic.** **Save to
library** and **Save package** each show the same dialog only when unused assets
exist: the count, the names, an unchecked **Move removed fonts and assets to the
Recycle Bin** checkbox, and the warning that the removed assets and their
credits go to the OS trash and can be restored from it. With no unused assets
the dialog does not appear. The checkbox is never remembered, so a WIP theme
keeps its spares by leaving it off. No background pruning, no publish-time
pruning. If the trash fails, the save aborts and the host's reason is shown;
nothing is lost.

**R13 — Cleanup has one reachability rule and one owner.** An asset is used when
`assetReferencedBy(objects, id)` or `EditorDocument.holdsAsset(id)` is true.
`cleanUnusedAssets()` removes unreferenced declarations, bytes, preview URLs and
credits whose `assetId` is one of them. Credits without an `assetId` (existing
packages) are never auto-removed — there is no link to prove what they belong
to.

**R14 — The preview modal keeps its facts on the right, even for a portrait
item.** A bottom band spends the media's own height, which is what a portrait
asset has least to spare. The asset preview opens almost fullscreen at the
finder's own box; the theme viewer keeps its 960px box from the store spec. Both
panels are 270px, stack badges and pills, and hold the eligible commands as a
Lucide glyph plus one word so four fit. The asset preview's shape is
`docs/design/mockups/current/assets-preview.html`; the theme viewer's is
`store-detail.html`.

## Ruling taken 2026-10-26

**R15 — A provider's specimen loads from the provider; the theme's bytes go
through the host.** The finder's preview column builds its specimen faces from
the cut's own pinned, CORS-open `previewUrl`. R11's "bytes through
`/api/assets/bytes`" governs the bytes a theme adopts, and those still travel
that way; a specimen is a preview of a font the theme does not hold yet, and it
loads the way the provider intends. Routing specimens through the host is
`vg-736`'s — for the machine whose browser cannot reach the CDN, where the
panel falls back today while Apply still writes the real cut.

## The model

A **type preset** is `{ family, size, weight?, letterSpacing?, lineHeight?,
face?: { assetId }, trioRole?: "heading" | "body" | "mono" }`. Nothing in this
design changes its persisted shape; it adds no field.

A **trio** is a provider result carrying three role faces. It is not persisted;
its faces become assets and presets only through an explicit action.

An **import** writes, in one operation:

1. bytes into the package through `AssetManager`;
2. an asset declaration carrying family, weight, style, format, subset, source
   URL and licence (local files may lack the URL and licence);
3. the preset(s) the author chose;
4. a credit carrying `assetId` (new optional field on `ThemeCreditsEntry`).

## Surfaces

### The rail and the Assets pane

- Fifth slot **Assets**, glyph `folder`-family, between Add and Tokens in rail
  order: Composition, Add, Assets, Tokens, Document. At most one pane open, as
  before.
- The pane's title is **Assets** with the file count; controls are **Import**,
  **Import as background** and **Find assets**.
- The body is a **card per file**, grouped by kind (Fonts, Images, Icons,
  Videos), mirroring the composition pane's rhythm: thumbnail or `Aa`, name,
  metadata line, an In use/Unused badge, and — only on the chosen row — 26px
  Lucide action glyphs with tooltips and accessible names: preview (eye), place
  (square-plus), background (image), replace (refresh), remove (trash). Font
  cards add **Create type preset**. This is `assets-pane.html`; the font form is
  `assets-font-import.html`.
- The Add pane keeps shapes, text and cards; it no longer owns a file section.

### The finder, Fonts tab

- Same modal and header as the other tabs; search, provider chips, an
  `All / Trios / Fonts` filter, sort, a four-column mixed result grid, and a
  336px preview panel that opens on selection (`asset-finder-fonts.html`,
  `asset-finder-font-family.html`).
- A trio tile names its three families; a family tile shows its name in its own
  face, its provider and cut count.
- The preview panel holds the fixed specimen card, an author-editable sample
  line, then the action block: for a trio, the scope and before→after rows and
  **Apply to theme** / **Add 3 presets**; for a family, the cut chips and **Add
  as type preset**, plus **Apply to selected preset** when applicable.
- Loading is per tile and never blocks the list. The 379-row unwindowed list
  (`vg-551`) does not survive; results are virtualised and keyboard focus is
  roving inside the grid.

### The Tokens pane and the inspector

- The pane lists **paint tokens and type presets only**; it holds no inline
  fields and no face select, preview or trio select. Type preset rows show a
  specimen `Aa` in the preset's family, the name, a role badge and the
  resolution; paint rows are unchanged (`type-presets.html`).
- Choosing a token selects it and shows its properties in the **inspector**:
  for a preset — name, role, face (bound or free family), size, weight, line
  height, letter spacing, usage; for a paint token — its existing properties.
  Token selection and canvas selection are exclusive: choosing a token clears
  the canvas selection, choosing on the canvas clears the token selection.
- The pane keeps **New type preset** and **Import font…**; the latter opens the
  finder on Fonts. Delete and reassign stay where they are.

### The preview modal

- **Asset preview** (`assets-preview.html`): no title bar; a fixed stage takes
  every pixel the 270px panel does not; the box is
  `min(1132px, 100vw − 48px) × min(852px, 100vh − 48px)` — the finder's inset-24
  size. Header: name, kind badge, close. Body: a one-line status, File, Shape,
  Attribution pills, and the used-by/removal note. Foot: **Remove**, **Replace**,
  **Background**, **Place**, each a glyph plus a word; Remove keeps `--hot` and
  the same box geometry as the others. A video replaces the still with a player
  and drops Place; Background is its primary.
- **Theme viewer** (`store-detail.html`): the existing `store-mode/item-modal`
  gains the same right panel at 270px — name, kind, author, version; description;
  Reads, Shape, Style pill groups; provenance line; foot **Delete**, **Export**,
  **Assign**, **Edit** as glyph plus word. The box stays 960px and the stage
  keeps its one height for every item; the caption band is removed.

### Save dialogs

`save-cleanup.html`: the same small confirmation for both save flows, drawn only
when unused assets exist — count, names, the unchecked Recycle Bin checkbox, the
warning, Cancel/Save.

## Architecture

- **Provider ownership.** `ASSET_SOURCES` gains `curated-fonts` and
  `google-fonts`, both `category: "font"`, `body: "font-picker"`. Every search
  and byte call stays the host's (finder R3). `AssetSearchRequest` gains an
  optional `body` (default `"grid"`) so `searchSources` asks only the sources the
  calling surface owns.
- **Wire.** `AssetResult` gains an optional `font` payload:
  `{ cuts: FontCut[]; trio?: FontTrioInfo }`, where a cut carries family, weight,
  style, subset, a pinned preview URL, licence and format, and `FontTrioInfo`
  carries its id, name and a role → cut map. Types live in `renderer-core`'s
  assets wire so host and editor cannot disagree.
- **Catalogue.** `font-trios.generated.ts` and the generator's output path move
  from the editor to the host (`host/src/assets/fonts/`). The editor imports no
  catalogue; it receives results over the wire and keeps only the preset-rewrite
  rules.
- **Document writes.** `EditorDocument` gains the explicit actions this design
  needs and keeps one write path (`setTypes`): add presets from a trio, add one
  preset from a cut with a role, apply a trio to the theme, unbind a preset face,
  set a preset role. All are undoable through the existing history owner.
- **Reachability and cleanup.** `EditorDocument` exposes the unused declarations
  (declarations minus `holdsAsset` and `assetReferencedBy`) and a prune that
  removes declarations, bytes, previews and linked credits. Naming and policy
  live in one module beside `AssetManager`; both save flows call it.
- **Trash.** `themes/trash.ts` gains file variants beside its folder routes.
  The host accepts the bytes to discard, stages them under its data directory,
  and trashes them only on a successful move; a failure answers with a reason
  and the editor aborts the save. Loopback-only and same-origin-only, like the
  asset routes.
- **Schema.** `fontAssetReference` widens: `format` becomes
  `woff2 | woff | ttf | otf`; the path pattern accepts those extensions;
  `sourceUrl` and `license.url` become optional for local files, with
  `license.name` defaulting to `unknown` when absent. `ThemeCreditsEntry` gains
  optional `assetId`. Both are widening-only; no migration and no converter.
  `schema/theme-document.schema.json`, the reader types and the sync tests move
  together.
- **Selection.** Token selection is its own store in `shell-layout`, exclusive
  with canvas selection. The inspector host renders the token section when it is
  set; `selection-inspector` is suppressed rather than left to write a second
  answer into the same column.

## Failure modes

- **A provider or CDN fails.** The tile keeps its name in the fallback face and
  stays selectable; the grid is never blanked by one source. Applying a face
  whose download fails writes nothing and says why.
- **A late search answer for an abandoned query.** Discarded, not rendered (the
  finder's existing rule).
- **A local font the validator refuses.** The metadata form reports the exact
  rule and keeps the declared file; no preset is written.
- **A bound preset edited by hand.** Validation refuses the mismatch; Unbind is
  the supported route.
- **The trash fails during an opt-in cleanup.** The save aborts with the host's
  reason; declarations, bytes and credits are untouched.
- **Trash succeeds but the save fails afterwards.** The package still holds
  references it no longer has bytes for; the document is untouched on disk and
  the next save says so. The trash move is ordered last, after the save is
  otherwise ready.
- **A theme saved before this change.** Missing `assetId` on credits and a
  `.woff2`-only model both remain valid; no cleanup removes those credits.

## Reuse, and what was searched

- Rung 1–2: `ASSET_SOURCES`, `AssetSource`, `/api/assets/*`, `AssetManager`,
  `holdsAsset`, `assetReferencedBy`, `themes/trash.ts` and the theme package's
  credits already own every seam this design needs. They are extended, not
  replaced.
- Rung 3: the platform supplies the trash (PowerShell VisualBasic, Finder,
  `gio`, `trash-put`) and the browser supplies `FontFace`/`document.fonts`; no
  dependency is added.
- Rung 4–5: Fontsource's registry (2,103 families, `type: "google"`, licence,
  weights, subsets, `npmVersion`) is the Google backing; the Fonttrio registry
  (380 pairing documents, 379 usable trios, 261 faces) is the curated backing.
  Google's own metadata was probed and rejected for having no licence and no
  pin. No comparable in-repo font browser exists to reuse.
- Rung 6: the mockups were rendered and measured (finder 1180×900 with a 336px
  preview; viewers at 1132×852 and 960×760 with 270px panels).
- Rung 7: the build is the phases below.

## Landing order

1. Schema and credits widening.
2. Host font sources, the catalogue move and the font wire payload.
3. Rail slot and Assets pane, with import moved out of Add.
4. Finder Fonts rebuild.
5. Document writes: presets from cuts/trios, role, unbind.
6. Tokens pane and inspector split.
7. Local font import and Create type preset.
8. Cleanup, trash and the save dialogs.
9. Preview modal and theme viewer panel.

Phases 1–2 are the contract; 3 can proceed beside them. 4 and 5 must land
together, because Apply is only testable when both exist. 7 depends on 1, 3 and
5. 8 depends on 1 and 7. 9 is independent of the font work and can land beside
it.

## Acceptance

- The rail shows five slots; Assets opens the card library; Add contains no file
  section.
- Importing an image places it at the canvas centre; importing a video sets the
  background; importing a font opens the metadata form and writes a preset only
  on **Create type preset**.
- The finder finds a family by name and a trio by a family inside it; selecting
  either shows the specimen preview; the grid stays virtualised.
- Apply to theme rewrites role presets and reports each before→after; Add 3
  presets leaves the canvas unchanged.
- A bound preset's family and weight are read-only; Unbind makes them editable.
- A token's properties render in the inspector, and canvas and token selection
  never both show.
- Save to library and Save package offer cleanup only when unused assets exist;
  the checkbox is off by default; a refused trash aborts the save.
- A package saved after an opt-in cleanup omits the removed bytes, declarations
  and credits.
- The asset preview and the theme viewer render their right panels at 270px with
  the four glyph+word actions; the asset preview keeps no facts in a bottom band.
- `DESIGN.md` §7.2 and the design-language spec's §5.2/§5.3 point at this
  document; the mockup README stays the gate.

## Non-goals

- Variable-font axes, font subsetting, and font conversion between formats.
- Arbitrary network font providers; the registry is the extension point.
- Mood/use-case/superfamily facets; they were deleted, not hidden.
- Default paint tokens for a blank theme and the starter generator's removal;
  separately scheduled.
- Automatic network download of remote fonts at publish; only what was imported
  travels.
- Migrating existing packages to `assetId` credits.

## Measurements

| Fact | Value | Where measured |
|---|---|---|
| Fonttrio pairings fetched | 380 documents, 379 usable trios | 2026-09-27 probe |
| Faces in the curated catalogue | 261, 174 families, 238 distinct (family, weight) | 2026-09-27 probe |
| Fontsource Google families | 2,103 | 2026-10-25 probe |
| Google Fonts metadata families | 1,950 (no licence, no pin, not CORS-readable) | 2026-10-25 probe |
| Starter theme presets | 13 — 6 heading, 6 body, 1 mono | `new-fabric-theme-globals.ts` |
| Finder grid | four columns, 336px preview panel | `asset-finder-fonts.html` |
| Asset preview box | 1132×852 at the 1180×900 canvas, 270px panel | `assets-preview.html` |
| Theme viewer box | 960×760, 270px panel | `store-detail.html` |
