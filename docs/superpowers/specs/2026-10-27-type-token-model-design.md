# Type tokens name a face; size belongs to the element

- **Date:** 2026-10-27
- **Status:** accepted
- **Spec:** this file

## The problem

A type preset today stores the face (`family`, `weight`, `face.assetId`) and
how it is worn (`size`, `lineHeight`, `letterSpacing`) in one record, and a
`trioRole` tag that any number of presets may carry. A text object's size *is*
its preset's size (`selection-inspector/appearance.ts` prints
"Inter 600 16px" from the preset), so two clocks that share a face cannot be
108 and 72 — they need two presets that differ only in size. That is what made
roles meaningless and left thirteen near-identical presets in the starter
theme.

The word "preset" also stopped matching what the thing is: it is the theme's
named face, not a starting point for anything.

## The model

`globals.typeTokens` replaces `globals.typePresets`.

```ts
interface TypeToken {
  readonly family: string;
  readonly weight?: string | number;
  readonly face?: { readonly assetId: string };
}
```

A token holds **only what identifies a face**. It has no `name`, no `size`, no
`lineHeight`, no `letterSpacing`, and no `trioRole`.

- **Role is the id.** `heading`, `body` and `mono` always exist in every theme
  and cannot be removed; every other id is an unroled token the author added,
  which may be deleted with its references reassigned.
- **The name is computed**, never stored: `[Heading] Manrope 600`, `[Body]
  Inter 400`, `[Mono] Fira Code 400`, and `Manrope 600` for an unroled token.
  Two tokens with the same family and weight would compute the same name, so
  adding one is refused and the existing token is pointed at.
- **Role tokens sort first**, in heading/body/mono order; unroled tokens follow
  by computed name. Every token dropdown in the product uses this order.

A text run keeps its existing reference, renamed: `typeToken:
"typeTokens.heading"`. How the run is worn moves onto the run's own `style`
map, which the renderer already resolves *after* the token
(`renderer-core/src/scene/plan.ts`, `resolveTypePreset` then
`resolveStyleMap`): `fontSize`, `lineHeight`, `letterSpacing`.

### Defaults

A run with no authored `fontSize` gets one from the theme's resolution, in
`renderer-core` so the editor and the player agree:
`Math.round(artboard.height × ratio)` with heading `1/15`, body `1/67.5`,
mono `1/77` (72 / 16 / 14 at 1080). An unroled token uses the body ratio.
Nothing about a default is stored on a token.

### Fonts

The weight dropdown lists the declared faces of the token's family, lightest
first. Applying a face from the finder imports every published weight and
every subset of that family; declared faces persist their `subset`, and
registration (`scene-fabric/src/font-assets.ts`) sets `unicodeRange` from a
subset→range table, so Latin, Vietnamese and Cyrillic characters resolve to
the right file without a cut field. A cut is not an authoring choice and does
not appear in the UI.

## Surfaces

**Token inspector** — name (read-only), family dropdown, weight dropdown,
delete (unroled only). The family and token dropdowns both end with two action
rows: `Import local font…` and `Font finder…`. An action row never changes the
current value. Importing a face that already has a token adopts it; otherwise
it creates an unroled token. A role token is never rewritten by an import.

**Element inspector** — a token dropdown (role tokens first, then action rows
that act on the selected element), plus size, line height and letter spacing
rows writing the selected run's `style`. Changing the token changes only the
face; size and spacing stay as authored.

**Canvas** — resizing a text object writes `fontSize` on its runs, rounded,
and resets the object's scale, so the size row and the canvas move together
and no other element changes.

## The format break

`SUPPORTED_SCHEMA_VERSION` moves from `2.0.0` to `3.0.0`. The reader compares
majors, so a v2 theme must be refused by version rather than read into a shape
that no longer matches. There is no converter and no compatibility branch:
starter themes, the card library, the published `schema/theme-document.
schema.json` and the e2e theme fixtures are regenerated in the new shape.

The starter theme's twelve presets collapse to five tokens — `[Heading] Segoe
UI 600`, `[Body] Segoe UI 400`, `[Mono] Consolas 400`, plus unroled `Segoe UI
300` and `Segoe UI 500` for the clocks and rates that used them — and each
starter run carries the size, line height and tracking its old preset held.

## Non-goals

- No per-element face override: the face belongs to the token.
- No user-renamed tokens.
- No migration from v2.

## Verification

- Unit: the validator refuses `typePresets`, `trioRole`, and any token
  carrying a styling key; computed names and the role-first order; the
  rendering of a run with no authored size at 1080 and 2160; unicode-range
  selection for a Vietnamese character.
- Browser: new heading text measures 72 at a 1080 artboard; resize changes
  that element's size and no sibling's; applying a different token leaves size
  and spacing alone; the token dropdown lists three role tokens first and ends
  with the two action rows; both dropdowns open the import and finder flows.
- A v2 theme is refused with the version message, not read.
