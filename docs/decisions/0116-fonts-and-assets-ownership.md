# 0116 — Font and media authoring is host-owned, and one rule owns cleanup

- **Date:** 2026-10-25
- **Status:** accepted
- **Paths:**
  `src/web/packages/renderer-core/src/theme/document.ts`,
  `src/web/packages/renderer-core/src/theme/fabric-envelope-validate.ts`,
  `src/web/packages/renderer-core/src/theme/envelope-semantics.ts`,
  `src/web/packages/host/src/server.ts`,
  `src/web/packages/editor/src/editor-shell/shell-layout.tsx`,
  `src/web/packages/editor/src/editor-session.ts`,
  `src/web/packages/editor/src/selection-inspector/view.ts`,
  `src/web/scripts/generate-font-trios.mjs`

## The problem

The editor imported a generated font-trio catalogue and treated the provider
registry as its own. Importing a local `.woff`/`.ttf`/`.otf` file, previewing a
provider family, and pruning unused assets then each needed a second owner —
and the shape that fails invisibly is ownership: nothing throws when two
surfaces disagree about where font bytes come from, or when a "cleanup" removes
a declaration something still references. The persisted reference was
narrower than the files the product must accept, and the catalogue generator
wrote into the editor's source tree.

## Rung 1 — Yunari
Searched: `ASSET_SOURCES`, `AssetSource`, `/api/assets/*`, `AssetManager`,
`holdsAsset`, `assetReferencedBy`, `themes/trash.ts`, the theme package's
credits, `EditorDocument.setTypes`, `selection-inspector`, `RailSlot`.
Found: every seam the design needs already exists. The provider registry,
byte route, asset manager, reachability predicates, trash module and single
document write path are extended, not replaced. The editor's
`font-trios.generated.ts` was the one owner in the wrong package.

## Rung 2 — dependencies
Searched: the workspace manifests and lock for a font catalogue, font browser,
asset-import pipeline, file-type sniffing or font parser.
Found: nothing to adopt. Fabric 7.4.0 is the renderer; no package is added for
this change. Fontsource and the Fonttrio registry are data, fetched by the
host's existing provider machinery, not dependencies.

## Rung 3 — platform
Searched: the OS trash (`PowerShell` VisualBasic, Finder, `gio`, `trash-put`)
and the browser's `FontFace` / `document.fonts`.
Found: the platform supplies the trash operation and font registration. It does
not supply scheduling, buffering, fallback or ownership — which is exactly the
part that still has to be decided here, so a native API is not a discharged
gate.

## Rung 4 — ecosystem
Searched: Fontsource's registry, the Fonttrio pairing registry, and Google
Fonts' own metadata; plus whether a comparable in-repo font browser exists.
Found: Fontsource lists 2,103 `type: "google"` families with licence, weights,
subsets and a pinned `npmVersion`, and serves bytes keyless and CORS-open. The
Fonttrio registry holds 380 pairing documents (379 usable trios, 261 faces).
Google's own metadata lists 1,950 families with no licence, no pin and is not
CORS-readable, so it is rejected as the backing. No comparable in-repo font
browser exists to reuse.

## Rung 5 — comparison
| Option | Fit | Cost | Risk | Verdict |
|---|---|---|---|---|
| Extend the existing host `ASSET_SOURCES` + `/api/assets/*` | Same bytes, same routes, same provider shape | Two source entries and an optional `body` discriminator | Low; one owner already exists | Chosen |
| New font-provider package or service | Duplicates routes, caching and fallback | New dependency and a second byte path | High drift between two owners | Rejected |
| Google Fonts metadata directly | Free catalogue | No licence, no pin, no CORS | Unlicenceable, unpinnable downloads | Rejected |
| Keep the catalogue generated into the editor | No move | Editor bundle carries provider data; host cannot search it | Two owners for one registry | Rejected |

## Rung 6 — probe
What was measured, how, and what it showed:

- Fonttrio probe (2026-09-27): 380 pairing documents fetched, 379 usable trios,
  261 faces, 174 families, 238 distinct (family, weight) pairs.
- Fontsource probe (2026-10-25): 2,103 `type: "google"` families.
- Google Fonts metadata probe (2026-10-25): 1,950 families; no licence field,
  no pinned version, not CORS-readable.
- Mockups rendered and measured: finder 1180×900 with a 336px preview; asset
  preview 1132×852; theme viewer 960×760; both right panels 270px.

The numbers are the evidence that the two registries cover the catalogue the
product needs without a new dependency.

## Decision

Font sources are **host-owned**: both registries join `ASSET_SOURCES` and all
search and byte traffic stays on `/api/assets/*`, so the editor bundle drops the
generated catalogue. Cleanup has **one reachability owner** — the same
`assetReferencedBy` and `holdsAsset` predicates, invoked from one module beside
`AssetManager` by both save flows — because a second definition of "unused" is
the invisible failure this note exists to prevent. The persisted font reference
is widened, not migrated: local formats are additive and no converter is
written.
