# 0054 — A credit carries the asset it attributes

- **Date:** 2026-10-31
- **Status:** accepted
- **Paths:** `src/web/packages/editor/src/editor-session.ts`

## Problem
Two import paths mint a `credits.json` entry but record no `assetId`: the
finder's `creditOf` and a Wallpaper Engine import's `creditsEntryOf`. Without
the id the preview can read only the asset declaration's licence and source,
never the credit's author, and removing an asset leaves its attribution in the
package. The credit type and its reader already own an optional `assetId`.

## Rung 1 — internal owner
Searched: `ThemeCreditsEntry` / `asEntry` in `packages/theme-package/src/credits.ts`;
`EditorDocument.credits` / `addCredit` / `canAddCredit` / `pruneAssets` in
`packages/editor/src/editor-document.ts`; `#commitFont` and the finder and
video import paths in `packages/editor/src/editor-session.ts`;
`creditOf` in `asset-finder/actions.ts`; `creditsEntryOf` in
`wallpaper-engine/client.ts`; `AssetPreviewInput` in
`panes/assets/preview-modal.tsx`.
Found: the type and reader already accept `assetId`, `pruneAssets` already
deletes credits whose id matches a removed asset, and the font path already
writes an id. The two missing writers and one missing reader are the owners to
extend; a second credit shape or a parallel id map is not needed.

## Rung 2 — installed dependencies
Searched: `packages/theme-package/src/credits.ts` and its tests; the host's
`themes/import.ts`, `store.ts` and `wire.ts` credit flows.
Found: the reader drops an absent or empty `assetId` and keeps a present one;
the host package path treats credits as opaque authored state. No dependency
supplies the id-to-credit join.

## Rung 3 — native platform
Searched: no browser, Node or OS API is involved beyond `Array.find`.
Found: the join is an in-memory list lookup; the document already owns the list.

## Rung 4 — public solutions
Searched: attribution metadata conventions (IPTC/XMP `xmpMM:DerivedFrom`, DCMI
`dcterms:isVersionOf`) for identifying the work a credit describes.
Found: these identify by a content identifier and leave the join to the
consumer, as `credits.json` does. No library is warranted for one list lookup.

## Rung 5 — integration comparison
| Option | Fit | Unsolved work | Verdict |
|---|---|---|---|
| Second id→credit map | duplicates the document list | invalidation on prune and add | rejected |
| Join in the pane from `document.credits()` | pane cannot reach the document | none, but leaks ownership | rejected |
| Read through `EditorDocument` | one owner, existing list | one method | chosen |

## Rung 6 — smallest probe
No executable probe: the failure is a missing field in an existing persisted
shape, and existing tests already exercise `addCredit`, `pruneAssets` and the
preview's attribution pills.

## Decision
Record the asset id at the two import seams, in the same transaction that
declares the bytes. Add `EditorDocument.creditForAsset` as the one join, pass
its supplier from the session into the Assets pane, and restore the preview's
`credit` input so Attribution can read licence, author and source from the
credit. Cap checks before a fresh declaration ask the list's length, because the
id is assigned by the declaration and a legacy key could otherwise mask a full
list.
