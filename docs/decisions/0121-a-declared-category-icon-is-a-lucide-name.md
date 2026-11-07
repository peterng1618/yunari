# 0121 — A declared category icon resolves through the chrome icon vocabulary

- **Date:** 2026-11-07
- **Status:** accepted
- **Paths:** `src/web/packages/extension-api/src/manifest-contributions.ts`, `src/web/packages/editor/src/editor-shell/icons.ts`, `src/web/packages/editor/src/asset-finder/modal.tsx`

## Problem

`contributes.assetCategories[].icon` is required by the manifest reader and
carried on the wire, but the finder tab drew `finderTabGlyph(category)`, whose
built-in map has no entry for a declared id. Every plugin category therefore
wore the picture fallback, so the declared value was dead data. The boundary is
the finder's tab surface; a wrong choice either draws a second icon family or
lets a hostile manifest smuggle a URL into a chrome mark.

## Rung 1 — internal owner

Searched: CodeGraph `finderTabGlyph`, `FINDER_TAB_GLYPHS`,
`FINDER_TAB_FALLBACK_GLYPH`, `declarativeCategories`, `DeclarativeCategory`,
`readAssetCategory`, `AssetFinder`.

Found: `FINDER_TAB_GLYPHS` in `editor-shell/icons.ts` is the one chrome glyph
map and `finderTabGlyph` the one lookup with a decided fallback. `icons.ts`
already holds the one Lucide vocabulary import. `modal.tsx` builds the tab row
and is the only caller. `readAssetCategory` accepted any string for `icon`.

## Rung 2 — installed dependencies

Searched: `lucide-react` 1.66 `dist/lucide-react.d.ts` and
`dist/esm/createLucideIcon.mjs`.

Found: the package exports every icon under its PascalCase component name; a
component it created carries `displayName`, while its non-icon exports (`Icon`,
`createLucideIcon`) do not. There is no exported name→component map, so the
package's own export namespace is the registry.

## Rung 3 — native platform

Searched: React element rendering through the existing `Glyph` wrapper, and
`Object.hasOwn` for the lookup.

Found: rendering a Lucide component needs no new platform API. `Object.hasOwn`
keeps inherited keys (`constructor`, `toString`) out of the lookup, as the
existing finder test already requires.

## Rung 4 — public solutions

Searched: Lucide's icon naming convention (kebab-case icon names, PascalCase
React exports and aliases such as `ImageIcon`), and the host's generated
`LUCIDE_ICONS` list (`scripts/generate-lucide-icons.mjs`) which names the same
icon set for the Lucide asset source.

Found: the public convention is a Lucide name in either casing. The host's
generated list is data for an asset source, not a React chrome vocabulary, so
it cannot draw a tab mark; a hand-maintained subset would leave most declared
names dead, which is the reported defect.

## Rung 5 — integration comparison

| Option | Fit | Unsolved work | Verdict |
|---|---|---|---|
| Resolve the name through the `lucide-react` export namespace in `icons.ts` | Complete, one family, one weight through `Glyph` | Bundle includes the full icon set | Chosen |
| A hand-maintained name→glyph subset | Small bundle | Most declared names still dead | Rejected |
| Render the declared string as an image URL | No | A manifest-controlled URL in chrome; second visual family | Rejected |
| Delete the field from the manifest reader | No new code | Existing manifests with `icon` become unknown-key refusals | Rejected |

## Rung 6 — smallest probe

The regression tests mount the findings: the resolver returns the named
component for `shapes`/`Shapes`/`image-icon`, the tab row renders
`lucide-shapes` for a declared category, and the manifest reader refuses a URL,
data reference or path. The resolver test fails against the old one-argument
lookup.

## Decision

Keep the manifest field and treat it as a Lucide icon name. The manifest
boundary refuses anything that is not a name (`CATEGORY_ICON_PATTERN`), and
`declaredCategoryGlyph` converts either casing to the package's component name
and returns it only when it has a `displayName`. `finderTabGlyph` asks the
built-in map first and the declared name second, so built-ins keep their own
glyph and an unknown name keeps the picture fallback. `modal.tsx` passes the
declared value from the category it already holds.

The full namespace import is the cost of honouring any declared name; the
editor has no gzip budget, and a lazy subset would reintroduce dead data.
