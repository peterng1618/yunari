# 0100 — A preset is editor-local data, not an imported asset

- **Date:** 2026-10-24
- **Status:** accepted
- **Paths:** `src/web/packages/editor/src/editor-session.ts`

## The problem

The finder's Colours tab serves two payloads: a palette (a list of hex colours)
and a gradient (an angle and stops). Choosing one must land it in the colour
picker's or gradient picker's preset row. That row is editor-local and stored in
localStorage; nothing is authored into the theme document.

The non-obvious part is the path. The finder's established action for every
other kind is `importAsset`: fetch bytes from the host, hand them to the asset
manager, write a `ThemeCreditsEntry`, then place the result. A palette has no
bytes, no MIME type, no asset reference and no author, so that path would have
to invent all four. The question is where a preset-shaped result branches.

## Rung 1 — Yunari

Searched: the finder's source registry, the search/bytes routes, `asset-finder/actions.ts`,
`preset-library/index.ts`, `renderer-core/color.ts`, the session's `importAsset`.

Found: `presetLibrary.addColours`/`addGradient` already own storage, dedupe,
hex normalisation and the 0..1 offset check; `parseColor`/`formatColor` are the
one colour parser. No existing path carries a palette into the library — the
picker's seeds are static. Nothing needed to be built for storage or validation.

## Rung 2 — dependencies

Searched: installed packages for a preset/palette catalogue or gradient parser.

Found: culori (via `renderer-core`) and no palette data. No new dependency is
justified; the payload is a few strings and numbers.

## Rung 3 — platform

Searched: `fetch`/`AbortSignal` on the host, `Storage` in the editor.

Found: the host already fetches and the browser already stores. Neither leaves
an ownership decision — they decide transport, not where a preset is kept.

## Rung 4 — ecosystem

Searched: "palette picker add to palette api", "gradient preset import editor",
the docs and network surfaces of Coolors, Color Hunt, ColorSwoop, UI Gradients
and WebGradients, and how CSS gradient serialisation is reused across editors.

Found: none of them exposes a preset payload as an asset with bytes and
attribution; the recurring shape is *copy the values into the editor's own
palette list*, and the closest analogue is a swatch copied into a palette panel.
Dead ends: Coolors has no public API and blocks scripted reads (403), so its
own hand-off could not be observed; Color Hunt's feed carries no name or role,
which is why a palette stays a bare list of colours.

## Rung 5 — comparison

| Option | Fit | Cost | Risk | Verdict |
|---|---|---|---|---|
| Route presets through `importAsset` (fake bytes + synthetic credit) | one path | fabricated MIME, credit with no author, asset manager caps for data | a false credit entry and an unused asset per palette | rejected |
| A second session method beside `importAsset` | clear split | a second hook through the finder | two near-identical finder actions | rejected |
| Branch on `result.preset` at the top of `importAsset` (chosen) | one entry point, shape decides | one early return | none: the union already distinguishes the payload | chosen |

## Rung 6 — probe

No measurement was needed for the branch itself; the payload shape is fixed by
the wire contract (`AssetPreset`) and the store's existing add contract. The
round-trip that matters — hex in, normalised hex stored — is proved by
`preset-library`'s own validation, and the action reuses it rather than
re-checking.

## Decision

`importAsset` returns `applyPreset({ ...result, preset: result.preset })` when
`result.preset` is present, before `assetBytes` is called. A preset is
editor-local data with its own owner, so it must not acquire an asset reference
or a `ThemeCreditsEntry` (the entry `credits.json` persists); the wire union
already says which rows are presets, so the branch costs one check and no new
finder action.
