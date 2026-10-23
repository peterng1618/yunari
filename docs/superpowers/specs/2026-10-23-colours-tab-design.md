# The Colours tab — palettes and gradients that land in the presets

- **Date:** 2026-10-23
- **Status:** landed 2026-10-24 — colour-neighbour search is phase two (§9). Plan: [`archive/2026-10-23-colours-tab.md`](../plans/archive/2026-10-23-colours-tab.md).
- **Related:** [`2026-10-21-asset-finder-design.md`](2026-10-21-asset-finder-design.md)
  (the surface, the source port, the first-search notice), [`2026-10-12-colour-and-gradient-rebuild-design.md`](2026-10-12-colour-and-gradient-rebuild-design.md)
  (the picker rebuild and the editor-local preset library).

## What this is, and is not

**This is** a fifth finder category. The Colours tab lists palettes and
gradients from four sources, lets the author filter by kind and switch sources
off, and writes a chosen result into the editor-local preset library that the
colour and gradient pickers read.

**This is not** a second picker, a second preset store, or an import. A palette
or gradient is data the editor already owns a home for; nothing is written into
the theme, the asset manager or `credits.json`.

**Coolors is not a source.** Its site answers 403 to a non-browser request, it
publishes no public API for public palettes, and its terms forbid scraping and
redistributing palettes as a compilation. The replacement set was chosen on
2026-10-23 against live endpoints and stated licences (§2).

## Rulings taken 2026-10-23

**C1 — A palette and a gradient travel as a result payload, not as bytes.**
`AssetResult` gains an optional `preset` member shaped exactly like the preset
library's stored entry, so applying a result is one call and no translation.

**C2 — The action is "Add to presets".** A palette adds one colour preset per
swatch; a gradient adds one gradient preset. The action never touches the asset
manager, and no credit entry is written.

**C3 — The kind filter chooses which sources are asked.** Palettes-only sends no
request to a gradient source. This reuses the disabled-chip rule rather than
filtering rows after the fact.

**C4 — The four sources are live.** No catalogue is vendored. Three are cached
in host memory for the process; Color Hunt is queried per page because its feed
is the catalogue.

**C5 — Colour-neighbour search is phase two.** It needs the rebuilt picker and a
distance contract; this spec leaves room for it (§9) and ships without it.

## 1. The surface

```
┌─ Assets ───────────────────────────────────────────────┐
│ Fonts  Icons  Images  Colours  Wallpaper Engine         │  tabs, derived
├────────────────────────────────────────────────────────┤
│ [ search… ]                                            │
│ ( All ) ( Palettes ) ( Gradients )   kind filter       │
│ [x] Color Hunt  [x] ColorSwoop  [x] UI Gradients …     │  source chips
│ ┌────────────────────────────────────────────────────┐ │
│ │  ███ ███ ███ ███   ╱╱╱╱╱╱╱╱╱╱╱╱╱                 │ │  swatches /
│ │  Cloud Dancer·CS   Vital Ocean·UG                  │ │  gradient strip
│ └────────────────────────────────────────────────────┘ │
│ 12 results · 2 sources      [Add to presets]           │
└────────────────────────────────────────────────────────┘
```

- The category is `colour`; the visible word is **Colours**, matching the
  editor's existing spelling (`ColourPicker`, `uiCopy.panels.colourHex`).
- Tabs remain derived from the registry: registering the first colour source
  draws the tab, and removing every source removes it.
- The kind filter is drawn only when the category has more than one preset kind.
  Its options come from the sources present, never from a fixed list. Changing it
  returns to page one and clears the selection, like a tab change.
- Source chips keep their existing behaviour: at least one enabled, the choice
  stored in the browser. The kind filter narrows the chip set; the enabled set is
  intersected, not rewritten, so switching back to All restores the author's
  earlier choices.
- A late answer for the previous kind is discarded by the existing ticket.
- Result count, numbered pager and failure sentences are the finder's own,
  unchanged.

## 2. The sources

| Source id | Label | Kind | Where its data is | Licence |
|---|---|---|---|---|
| `colorhunt` | Color Hunt | palette | `POST https://colorhunt.co/php/feed.php` | unknown |
| `colorswoop` | ColorSwoop | palette | `GET https://colorswoop.com/api/palettes.json` | CC0-1.0 |
| `uigradients` | UI Gradients | gradient | `GET raw.githubusercontent.com/ghosh/uiGradients/main/gradients.json` | MIT |
| `webgradients` | WebGradients | gradient | `GET raw.githubusercontent.com/itmeo/webgradients/master/gradients.json` | MIT |

### Color Hunt

The feed is undocumented. A form POST with `step=<page-1>`, `sort=new`,
`tags=<query>` and an empty `timeframe` answers 40 entries per page:

```json
[{ "code": "15370d728e6de5cd82fff2b4", "likes": "50", "date": "15 hours" }]
```

`code` is four 6-digit hex colours concatenated. The palette has no name, so the
result is named `Color Hunt <first 6 hex>` and its subtitle is the like count.
The query reaches the feed's tag filter — `sunset` and `blue` both answer — so
keyword search means *this tag*, not a free-text name match; the source cannot
do more. `sort=new` is the site's own default. `totalPages` follows from the
page's own length: a full page reports the following page number, so the pager
can advance even though the feed does not say how many pages remain; a short
page reports its own page as the last; an empty page reports the page before it
(and never below one).

Color Hunt labels its palettes public property, but this spec does not assert a
licence it cannot quote, so the result carries `unknown`, which the finder
displays rather than hides.

### ColorSwoop

A static CC0 catalogue: `meta.count` 3,302, `palettes[]` with `id`, `name`,
`url`, `colors` (four hex) and `tags`. The whole file is fetched once per host
process and cached; a failed fetch clears the promise so the next search retries.
The query filters locally across `name` and `tags`, case- and accent-insensitively.
Pages are 40 results of the filtered list; `totalPages` is the last page.

### UI Gradients

`gradients.json` is 382 `{ name, colors[] }` entries in an MIT repository. Fetched
once and cached. `colors[]` becomes stops evenly spaced from 0 to 1; the site
renders `to right`, which is the editor's stored angle `0`.

### WebGradients

`gradients.json` is 180 entries: `{ name, index, deg, gradient: [{ color, pos }] }`,
MIT. Fetched once and cached. `pos` (0–100) is divided by 100 for the stored
offset. The editor stores angle as `90 - cssDegrees`, so `deg` converts to
`(90 - deg + 360) % 360`.

### Paging and caching

All four serve 40 results a page. ColorSwoop, UI Gradients and WebGradients
paginate their in-memory catalogue; Color Hunt maps the page to a feed step.
Caching is a module-level promise per adapter: one outbound fetch per host
process, including a failed one that is cleared so the next search can retry.
The searches are debounced and abortable through the finder's existing context.

## 3. The wire

```ts
export type PresetKind = "palette" | "gradient";

export interface AssetPresetPalette {
  readonly kind: "palette";
  readonly colours: readonly string[];      // "#RRGGBB", source order
}

export interface AssetPresetGradient {
  readonly kind: "gradient";
  readonly angle: number;                   // editor convention: 0 = CSS 90deg
  readonly stops: readonly {
    readonly offset: number;                // 0–1
    readonly color: string;                 // "#RRGGBB"
  }[];
}

export type AssetPreset = AssetPresetPalette | AssetPresetGradient;
```

- `ListingCategory` gains `"colour"`.
- `AssetResult` gains `readonly preset?: AssetPreset`. Existing results omit it,
  so no adapter outside the colour sources changes.
- `AssetSourceListing` gains `readonly presetKind: PresetKind | null`; the host's
  `AssetSource` gains the optional equivalent. A font or icon source is `null`.
- `AssetSearchRequest` is unchanged. The kind filter is expressed by which source
  ids are enabled, which is already the request's shape.
- The adapters construct the payload from parsed source data, and the preset
  store validates it again on add: an invalid entry is skipped there and the
  message counts what landed. The action never writes a partial entry itself.

## 4. Applying a preset

`presetLibrary` is the editor-local store landed with the picker rebuild:
`addColours(entries)` and `addGradient(entry)` validate, normalise to hex, skip
exact duplicates and persist under `yunari.editor.presets`.

| Result | Call | Name |
|---|---|---|
| palette, n colours | `addColours(colours.map((value, i) => ({ name: `${result.name} ${i + 1}`, value })))` | one preset per swatch |
| gradient | `addGradient({ name: result.name, angle, stops })` | one preset |

- The outcome is `{ ok: true, message }` when something was added or skipped, so
  the finder can say `Added 4 colours` or `Already in presets`. The existing
  action outcome only carried a failure message; it gains the optional success
  message.
- Nothing is written to the document, so nothing is undoable and no theme save is
  triggered. That is the intent: a preset is a working library, not authored
  state.
- `editor-session.ts` branches on `result.preset` before `assetBytes`. The
  branch is the only session change; the decision note required by the reuse gate
  claims that file.

## 5. Source presentation

- `source-mark.tsx` already falls back to a monogram. None of these four brands
  has a Simple Icons path, so two of them would both read `C`. The marked label
  keeps the accessible name, and the fallback is extended to two letters when the
  first letters collide (`CH`, `CS`), so the card still says where it came from.
- A palette card draws its swatches edge to edge; a gradient card draws the CSS
  linear gradient the preset will store, using the same `90 - angle` formula the
  editor's gradient track uses. Both reuse the row's box, border and selection
  ring.

## 6. Failure modes

| Situation | Behaviour |
|---|---|
| A colour source is unreachable | its chip names the failure; the other sources' rows stay |
| Color Hunt's feed changes shape | that source says it failed with the parse message; no row is invented |
| A cached catalogue fetch failed | the promise is cleared; the next search retries |
| The query matches nothing | the finder's existing `no-results`, with Clear query |
| A palette or gradient entry is malformed | the store skips it; the message counts what landed |
| Every palette in a result is already stored | `Already in presets`, and the store is unchanged |
| The host serves no colour sources | no Colours tab is drawn (tabs are registry-derived) |
| A source is switched off mid-flight | its late page is dropped by the existing ticket |

## 7. Architecture

```
src/web/packages/renderer-core/src/assets/wire.ts
  ListingCategory += "colour"; PresetKind, AssetPreset, listing.presetKind

src/web/packages/host/src/assets/
  colours/colorhunt.ts        the undocumented feed, page → step
  colours/colorswoop.ts       the static CC0 catalogue, cached
  gradients/uigradients.ts    382 named gradients, cached
  gradients/webgradients.ts   180 named gradients with deg and stops, cached
  sources.ts                  four registry entries
  source.ts                   the optional presetKind member

src/web/packages/editor/src/asset-finder/
  modal.tsx                   the kind filter, the colour tab's action label
  row.tsx                     swatch and gradient previews
  actions.ts                  applyPreset → presetLibrary
  source-mark.tsx             the two-letter monogram fallback

src/web/packages/editor/src/
  editor-session.ts           one branch before assetBytes
  preset-library/index.ts     unchanged; the add contract already exists
  ui-copy.ts                  the category, action, filter and messages
```

## 8. Acceptance

- Registering the four sources draws a Colours tab; no other tab changes.
- A keyword on Color Hunt reaches `tags=`; a keyword on ColorSwoop matches names
  and tags; a keyword on either gradient source matches names.
- Choosing Palettes sends no gradient source id in `enabled`, and the gradient
  chips are not drawn; choosing Gradients is the mirror.
- Turning a source off persists across reopen and sends no request for it.
- Adding a four-colour palette stores four colour presets whose values are the
  palette's own hex codes, in source order.
- Adding a gradient stores one preset whose stops and angle equal the source's,
  converted once; a WebGradients `deg: 45` stores angle `45`.
- Adding the same result twice says `Already in presets` and leaves one entry.
- A preset result never calls `/api/assets/bytes` (asserted with a fetch spy).
- A failed source leaves the other rows and names itself.
- The existing font, icon, image, video and Wallpaper Engine behaviour is
  unchanged; their tests pass without edits.

## 9. What this does not decide

- **Colour-neighbour search.** Phase two, after the picker rebuild merges. It
  will add an optional `near: { colour, distance }` to the search request and a
  distance in a perceptual space (culori already parses colour in renderer-core),
  reuse the rebuilt picker for input, and land with its own acceptance. This spec
  ships the keyword path only.
- Whether a preset carries provenance (source name, palette URL). The store's
  entry has a name and a value today; adding a source field is a change to that
  owner, not a reason to invent a shadow store here.
- Rate limiting and a disk cache for the live sources. In-memory caching is
  enough for the four sources and their sizes; a second consumer decides more.
- Coolors, ColourLovers (API closed in 2026) and any source whose terms do not
  permit listing.

## 10. Reuse gate — the seven rungs

**Rung 1 — Yunari.** Searched the finder's source registry, the preset library
and the colour parser. Found: the source port and registry (one array), the
search route, the modal's tabs/chips/pager/action, `presetLibrary.addColours` /
`addGradient` with storage and duplicate handling, and `renderer-core/color.ts`.
Nothing lists palettes or gradients.

**Rung 2 — dependencies.** Searched installed packages for a palette catalogue or
an API client. Found: culori (already the colour parser) and no palette data. No
new dependency; these are JSON over `fetch`.

**Rung 3 — platform.** `fetch` and `AbortSignal` are the host's existing route
tools; the browser stores presets in localStorage already. No native API adds
anything.

**Rung 4 — ecosystem.** Searched how palette browsers expose data: Coolors (no
public API, Cloudflare-blocked, compilation redistribution forbidden), Color Hunt
(undocumented feed, tag filter), ColorSwoop (CC0 static JSON), UI Gradients and
WebGradients (MIT JSON in git). The recurring shape is a catalogue plus a
kind-and-name search; none of them gives role semantics, so a palette stays a
list of colours and the author decides what each means.

**Rung 5 — comparison.**

| Option | Fit | Cost | Risk | Verdict |
|---|---|---|---|---|
| A separate preset browser beside the finder | independent | a second surface, a second search | the picker and the finder drift | rejected |
| Bundle every catalogue as generated data | offline | stale data, redistribution questions, release per refresh | MIT/CC0 okay, Color Hunt not | rejected for live sources |
| Extend the finder: one category, one payload, four adapters (chosen) | one surface, one store | one wire member and one filter | Color Hunt's feed is undocumented | chosen |

**Rung 6 — probe.** Read live on 2026-10-23: ColorSwoop `meta.count` 3,302 and
CC0; UI Gradients 382 entries, MIT; WebGradients 180 entries, MIT; Color Hunt
40 entries per page, `sort=new` and tag filtering, no name. Coolors 403 on every
path tried; ColourLovers API returns 410 "closed when the site was rebuilt in
2026".

**Rung 7 — build.** Four adapters over existing `fetch`, one optional wire
member, one listing member, one filter, one preset call. No dependency, no second
store, no vendored catalogue.

## 11. Landing order

1. **The wire and the registry shape** — `colour`, `PresetKind`, `AssetPreset`,
   `presetKind` on the listing and the port. No UI; existing tests unchanged.
2. **The four adapters and their tests** — request shape, parsing, keyword,
   paging, caching, failure. Proved by unit tests with a fake fetch.
3. **The tab** — kind filter, swatch and gradient rows, copy. Proved by DOM tests.
4. **The action** — `applyPreset`, the session branch, decision note 0100 before
   the first write to `editor-session.ts`, and the action's success message.
5. **Browser proof and close-out** — an e2e that adds a gradient and reads the
   preset store from localStorage; STATUS and the ownership map updated.

## 12. Measurements

```text
ColorSwoop palettes                       3302   colorswoop.com/api/palettes.json
UI Gradients                              382   ghosh/uiGradients gradients.json
WebGradients                              180   itmeo/webgradients gradients.json
Color Hunt per page                        40   php/feed.php
results per page in this tab               40   chosen; matches Color Hunt
preset library seeds                       12 colours + 15 gradients
```

All figures read on 2026-10-23 from the endpoints named beside them.
