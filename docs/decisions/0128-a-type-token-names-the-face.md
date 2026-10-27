# 0128 — A type token names the face; size, leading and tracking belong to the run

- **Date:** 2026-10-27
- **Status:** accepted
- **Paths:** `src/web/packages/renderer-core/src/theme/type-size.ts`, `src/web/packages/editor/src/editor-session.ts`

Spec: [`docs/superpowers/specs/2026-10-27-type-token-model-design.md`](../superpowers/specs/2026-10-27-type-token-model-design.md).
Plan: [`docs/superpowers/plans/2026-10-27-type-token-model.md`](../superpowers/plans/2026-10-27-type-token-model.md).

## The problem

One record carries both the face and how it is worn. `TypePreset` holds
`family`, `weight`, `face.assetId` beside `size`, `lineHeight`,
`letterSpacing`, plus a `trioRole` tag any number of records may share. A text
object's size *is* its preset's size, so two headings that share a face need
two presets differing only in size; the starter theme grew twelve of them, all
one family. The role tag then distinguishes nothing, because the thing that
actually differs between two "heading" presets is their size.

The question is where the split belongs: which part of typography is theme
vocabulary and which is a property of the element.

## Rung 1 — Yunari

Searched: `TypePreset`/`typePresets` across `src/web/packages` (60 source and
test files), the resolver in `renderer-core/src/scene/plan.ts`, the inspector
projection in `editor/src/selection-inspector/appearance.ts`, the starter
records in `editor/src/new-fabric-theme-globals.ts`.

Found: `plan.ts` already resolves the run's own `style` map *after* the
token's contribution (`...resolveTypePreset(...)`, then
`...resolveStyleMap(run.style, ...)`), so a per-run `fontSize` overrides the
record today with no renderer change. `appearance.ts` prints "Inter 600 16px"
from the preset, which is how size reaches the author's eye. The starter theme
declares 12 presets, one family (`Segoe UI, sans-serif`), sizes 17–108, weights
300–600, roles heading/body only. Nothing enforces one record per role.

## Rung 2 — dependencies

Searched: installed packages' own handling of text metrics and typography —
Fabric (`Textbox.fontSize`, `lineHeight`, `charSpacing`), Base UI (select
surface), Biome/TS types (no typography model).

Found: Fabric owns the three numbers on the object; nothing in our dependencies
offers a shared typography token model to adopt. The font pipeline (Fontsource
registry JSON, `FontFace`) is ours to assemble.

## Rung 3 — platform

Searched: CSS Font Loading (`FontFace` descriptors, `document.fonts`),
`@font-face` `unicode-range`, Fabric text properties.

Found: `unicode-range` is the platform's mechanism for choosing between
subsets of one family, and `FontFace` accepts it as a descriptor, so a cut
never needs to be an authoring choice. Ordering is load-bearing: faces that
share a family are matched by range, and a face without a range covers
everything, so a rangeless face registered for a family shadows the ranged
ones (CSS Fonts 3; CSS Font Loading orders manually added faces by insertion).
Our registration already threads descriptors through
(`scene-fabric/src/font-assets.ts`).

## Rung 4 — ecosystem

Searched: Figma text styles and variables, Penpot typographies, Sketch text
styles, Tokens Studio typography tokens, Tailwind theme namespaces, Google
Fonts css2 and Fontsource subset CSS.

Found: the shared-style tools put size inside the style. Figma's text style
includes family, weight, size, line height and tracking, and a styled layer
cannot change size without detaching
(help.figma.com/hc/en-us/articles/360039957034). Penpot's typography is the
same composite, and varying one layer means unlinking while keeping properties
(help.penpot.app/user-guide/design-systems/assets/). Sketch stores size in the
style and marks a divergent layer as a modified style
(sketch.com/docs/symbols-and-styles/text-and-layer-styles/text-styles/). That
is precisely the shape that produced our twelve presets.

The design-token tools split it. Figma variables bind `fontFamily`/`fontStyle`
as strings and `fontWeight`, `lineHeight`, `letterSpacing` as numbers, with
`FONT_SIZE` as a separate scope (developers.figma.com/docs/plugins/
working-with-variables/). Tokens Studio's typography composite is nine
independently referenceable tokens rather than one record
(docs.tokens.studio/manage-tokens/token-types/typography/). Tailwind keeps
`--font-*` (family), `--font-weight-*`, `--text-*` (size), `--leading-*` and
`--tracking-*` in separate namespaces (tailwindcss.com/docs/theme).

On subsets: Google Fonts css2 emits one `@font-face` per named subset with a
`unicode-range`, and its `subset=` parameter is ignored where ranges are
supported (developers.google.com/fonts/docs/getting_started). Fontsource's
default CSS carries the ranges; its per-subset files are named
(fontsource.org/docs/getting-started/subsets). So the ranges are available, and
a cut need not be persisted as a choice.

## Rung 5 — comparison

| Option | Fit | Cost | Risk | Verdict |
|---|---|---|---|---|
| Keep size in the shared record (Figma/Penpot/Sketch) | The shape that produced 12 near-identical presets | None now | The one-face-two-sizes case needs a duplicate record forever | Rejected |
| Split face from size, size on the element (Tokens Studio / Tailwind namespaces) | Matches the model the renderer already resolves | Break at the same schema version | Two inspectors must write the same run style | **Chosen** |
| Keep the record but let the element override size | Cheapest diff | Two owners for one number, defaults diverge between editor and player | Rejected |
| Cut as a token field | Explicit | A fourth dropdown for glyph coverage | Rejected |
| Cut resolved by `unicode-range` | Author never sees it | A subset→range table; ordering rules | **Chosen** |

## Rung 6 — probe

Read, not measured in a browser: the resolver's merge order (run style after
the token) at `renderer-core/src/scene/plan.ts`; the size the inspector prints
at `editor/src/selection-inspector/appearance.ts`; the starter set's 12
records and single family at `editor/src/new-fabric-theme-globals.ts`; that
`loadFontAssets` already forwards `FontFace` descriptors
(`scene-fabric/src/font-assets.ts`). Not measured: the browser's subset
matching under our own registration order — the plan's Task 2.2 test has to
show two faces of one family coexisting, and Phase 6's browser proof has to
show a Vietnamese character resolving to its subset.

## Decision

The token holds the face (`family`, `weight`, `face.assetId`); role is its id
(`heading`, `body`, `mono`, non-removable); size, line height and tracking live
on the run's `style`, with a renderer-owned default derived from the artboard
height so editor and player agree. The persisted key moves to `typeTokens` and
the key set, refused by validation rather than converted; the schema version stays 2 because the app is unreleased. Subsets are persisted as
metadata and resolved by `unicodeRange`, never offered as a choice.

Reason: the split is the one the renderer already implements, and it removes
the only reason two records ever needed to exist for one face.
