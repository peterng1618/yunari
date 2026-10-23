# The asset finder — sources, credentials, and one surface

- **Date:** 2026-10-21
- **Status:** landed — except the Wallpaper Engine tab (§3's local source, §8's
  absence row), which the [Wallpaper Engine plan](../plans/archive/2026-10-21-wallpaper-engine-import.md)
  now owns: it builds the host module and the tab's body, and this spec's tab entry
  is drawn when that plan lands.
- **Related:** [`2026-10-21-wallpaper-engine-import-design.md`](2026-10-21-wallpaper-engine-import-design.md)
  (the local source and `credits.json`), [`2026-10-12-theme-store-design.md`](2026-10-12-theme-store-design.md)
  (the media normalizer), `requirements.md` §132, `docs/superpowers/plans/2026-09-27-font-trio-catalog.md`.

## What this is, and is not

**This is** one surface where an author finds and imports outside material —
fonts, icons, and a Wallpaper Engine theme already on disk — built on an
**expandable registry of sources** and a host-side **credential store** that the
host's future data providers will share.

**This is not** a second file picker. Add → File stays, and the asset manager
stays the only owner of imported bytes. It is also not a licence-clearance
service: it records what each source declares and refuses to import without a
credits entry.

## Rulings taken 2026-10-21

**R1 — One surface, a modal.** A Base UI `Dialog`, the primitive Settings
already uses. It is opened from the Add pane's file section and the File menu.
The canvas is covered while browsing; that is the cost of giving search grids and
specimens full width.

**R2 — Sources are a registry, and the list is data.** Adding an icon provider
is one entry in one table plus its adapter. The tabs are **derived from the
registry's categories**, so a category with no source draws no tab.

**R3 — Every provider call is the host's.** The browser never holds a key and
never calls a provider. This is the same split the Wallpaper Engine library
already uses, and it is the only way the key store has one owner.

**R4 — The curated catalogue is the first font source.** No live Fontsource
search in v1; it joins later through the same registry.

**R5 — The import action follows the kind.** `Place on canvas` and
`Set as background` for an icon or image, `Set as background` for a video,
`Apply to preset` for a font, `Open in Wallpaper Engine` for a scene. The
footer names the action; it never says a bare "Import".

**R6 — Credentials are a host store beside the other settings, and write-only to
the browser.** Plaintext JSON protected by filesystem permissions, never
returned by a route, never logged, shown only as a four-character hint. Stated
plainly because it is a limit, not a design flourish: without a new dependency
there is no OS vault binding in Node.

**R7 — Attribution is not optional.** An imported result without a credits
entry is not imported. The entry is written into the theme package's
`credits.json` (the Wallpaper Engine spec defines the member).

**R8 — Wallpaper Engine is the only fixed source.** It is local, needs no key,
and cannot be removed from the registry by configuration. Everything else is
pluggable.

**R9 — One grid per category, sources mixed.** The tab is the category, never a
provider. Every enabled source's results share one grid, interleaved, and each
row is badged with the source that supplied it — the licence differs per row, and
the author is choosing a legal obligation without changing tabs. Sources are
enabled and disabled by chips above the grid.

**R10 — v1 authenticates with a bearer credential only.** The store's type admits
a `cookie` kind so a future account-login source has somewhere to land, but no
cookie handler ships and no source may declare one: a session cookie is a
credential with more power than a scoped key, it expires silently, and driving a
provider's login is the automation this product has already refused elsewhere.

## 1. The surface

```
┌─ Assets ────────────────────────────────────────────────┐
│ Fonts  Icons  Wallpaper Engine                          │  tabs, derived
├─────────────────────────────────────────────────────────┤
│ [ search… ]                                             │
│ [x] Lucide  [x] Font Awesome Free          sources      │
│ ┌─────────────────────────────────────────────────────┐ │
│ │  ░house      ░house      ░home       ░house         │ │  mixed grid
│ │  house·Lucide house·FA   home·Lucide house·FA       │ │  + source badge
│ └─────────────────────────────────────────────────────┘ │
│ 40 results · 2 sources      [Cancel]  [Place on canvas] │
└─────────────────────────────────────────────────────────┘
```

- **One query, every enabled source.** The grid is a round-robin interleave of
  each source's first page, so the mix is visible before scrolling and no source
  is buried by another's better ranking. There is deliberately **no cross-source
  rank**: the sources' own scores are not comparable, and pretending otherwise
  would be a relevance claim the code cannot support.
- **Load more** asks every source that still has a cursor and appends its next
  page to the same interleave. A source that has run out simply stops
  contributing; the pager stays while any source has more.
- **Result ids are namespaced** as `<source id>:<result id>` on the wire, so two
  sources cannot collide and a result names its origin without a lookup.
- **A failing source does not blank the grid.** Its chip says it failed and the
  other results stay; a source that fails with a credential reason says
  `needs-credential` on its own chip.
- Sources are enabled or disabled per category and the choice is remembered in
  the browser, not on the host: it is a per-viewer convenience, and it must not
  travel to another display. At least one source is always enabled.
- Search is debounced and cancellable. **A late response for an abandoned query
  is discarded**, not rendered as the current result set.
- Paging is the source's: a `cursor` in, a `next` cursor out. A source that
  cannot page returns `next: undefined` and the grid does not draw a pager.
- The empty states are distinct: `no-source` (the category has none — the tab
  would not exist, so this is only reachable on a registry change), `no-results`,
  `needs-credential` (naming the credential and offering the Settings tab), and
  `source-failed` (the source's own message).

## 2. The source port

```ts
export type SourceCategory = "font" | "icon" | "image" | "video";

export interface AssetResult {
  readonly id: string;                 // the source's own id; the host prefixes it
  readonly name: string;
  readonly preview: string;            // a URL the editor may render, or ""
  readonly subtitle: string | undefined; // author, family, collection
  readonly licence: string;            // "ISC", "CC-BY-4.0", "unknown" — never blank
  readonly sourceUrl: string;          // where a person reads the licence
}

export interface SearchPage {
  readonly results: readonly AssetResult[];
  readonly next: string | undefined;
}

export interface SourceBytes {
  readonly bytes: Uint8Array;
  readonly contentType: string;
  readonly filename: string;           // the asset manager decides by extension
}

export interface AssetSource {
  readonly id: string;
  readonly label: string;
  readonly category: SourceCategory | "local";
  /** The credential this source needs, or `undefined`. */
  readonly requires: string | undefined;
  /** False only for Wallpaper Engine, which cannot be disabled (R8). */
  readonly configurable: boolean;
  search(query: string, cursor: string | undefined, ctx: SourceContext): Promise<SearchPage>;
  bytesOf(resultId: string, ctx: SourceContext): Promise<SourceBytes | undefined>;
  creditsOf(result: AssetResult): CreditsEntry;
}

export interface SourceContext {
  readonly credential: (id: string) => string | undefined; // never leaves the host
  readonly signal: AbortSignal;
}
```

`host/src/assets/sources.ts` holds the one array. A source that is remote and
keyless (Font Awesome Free) and one that is local and keyless (Lucide, the
curated catalogue, Wallpaper Engine) differ only in what `search` does, so the
modal has no branch per source.

The search route takes the **enabled source ids** and answers one merged page per
enabled source, with every `id` prefixed by its source's id and every row's
`source` named. A source missing from the enabled list is not called at all —
which is what makes a disabled chip a saving rather than a filter over work
already done.

## 3. The sources in v1

| Tab | Source id | Where its data is | Needs a key |
|---|---|---|---|
| Fonts | `curated-fonts` | `editor/src/font-trios.generated.ts`, 261 faces and their trios | no |
| Icons | `lucide` | the `lucide-react` package **already installed** (ISC) — read locally, so it works offline | no |
| Icons | `fontawesome-free` | remote: the Font Awesome Free icon set | no |
| Wallpaper Engine | `wallpaper-engine` | the local Steam library, through the Wallpaper Engine spec's host module | no |

**Lucide is a local source.** `lucide-react` 1.48.0 is already the editor's icon
dependency (`docs/engineering/dependencies.md:19`, ISC plus MIT for the
Feather-derived icons); the adapter reads its icons rather than fetching
anything. That also keeps the editor's chrome vocabulary and the imported icons
distinguishable: chrome glyphs stay `editor-shell/icons.ts`, and an imported
icon is an asset like any other.

**Font Awesome Free is the remote case**, and the reason §132's precondition
exists. Its icons are CC BY 4.0: an imported icon must carry its attribution, and
the spec does not assert the licence from memory — the adapter reads it from the
package metadata it fetches, and the `credits.json` entry is what discharges the
obligation.

**No source in v1 needs a credential.** The store is built now because the next
keyed source (a stock image or video provider) and the host's data providers both
need it, and a second pass over the same surface is the cost this avoids. The
Connections tab says so: "No source needs a key yet."

## 4. Credentials

```
host/src/settings/credentials.ts        { "<credential id>": { "value": "…", "savedAt": "<ISO>" } }
                                        in the host settings directory, beside theme-origins.json
```

```
GET    /api/credentials                 → [ { id, label, set, hint } ]   never a value
PUT    /api/credentials/<id>            → { ok: true } | { ok: false, message }
DELETE /api/credentials/<id>            → { ok: true }
```

`PUT` takes the value in the body and answers only whether it was stored. The
read answers `hint` — the last four characters — and nothing else about the
value. No route logs a body, and a write failure names the credential, never its
content.

The registry of **known** credentials is a table beside the sources: `{ id,
label, kind, verify? }`. `kind` is `"bearer" | "cookie"`, and **only `bearer` is
implemented in v1** (R10): a `cookie` entry is refused at write time with a
message naming the reason, so the type records the shape without shipping a
handler that would store a full session. A key for an id the table does not know
is refused, so a request cannot fill the file with arbitrary entries. `verify` is
optional and, if present, the Connections tab's **Verify** button calls it
through `POST /api/credentials/<id>/verify` — a typo should fail at the field,
not as an empty search result later.

A credential's value never crosses to the browser in any form, and a source
receives it only through `SourceContext.credential`, inside the host process.

**The Connections tab** is the fourth tab in the editor's Settings dialog
(`settings.tsx:33`'s `SettingsTab`, whose comment already requires the column and
the panels to read the one list). Each row: label, a masked field, `Saved
····ab12` or `Not set`, then Save, Clear and Verify (disabled when the credential
has no verifier).

## 5. Remote input, licence and attribution — §132's precondition

§132 permits a URL-import flow "only after remote input, licence and attribution
behaviour is defined". This spec is that definition:

- **Remote input.** A search term is sent to the source's host and nowhere else.
  The first search of a session names the host it will contact, once, above the
  grid; the modal does not narrate every keystroke. No term is stored, and no
  term is sent to any analytics service — the product has none.
- **Licence.** Every result carries a licence string and a URL a person can read.
  The import's credits entry records both. A source that cannot name a licence
  says `unknown`, and `unknown` is shown rather than hidden.
- **Attribution.** The credits entry is written at import (R7), with
  `kind: "icon"`, the source id, the item name, the source URL and the licence.
  A theme published with an imported icon carries its attribution because the
  package carries it.
- **Offline.** Imported bytes live in the package. Nothing the finder imported
  is fetched again at display time, and the player never calls a source.
- **SVG.** Sanitised before preview (§132); the original is preserved as the
  asset. Monochrome recolour already exists (`content.monochrome`,
  `scene-fabric/src/fabric-image.ts:59`), so an imported icon gets it without new
  work.

## 6. What already exists, and must not be rebuilt

| Need | Owner today |
|---|---|
| Bytes, caps, reference model, previews | `editor/src/asset-manager/index.ts` |
| Declaring and placing an image or SVG | `asset-manager.import` + `placeImage`, `panes/add/file-section.tsx` |
| Background media | `Artboard.backgroundMedia`, `renderer-core` |
| Font browsing, facets, favourites, specimens | `font-picker/`, `font-catalog-query.ts`, `font-specimen-cache.ts` |
| Applying a face to a preset | `EditorDocument.applyPresetFace` |
| The modal primitive | `components/ui/dialog.tsx` (Base UI) |
| Host state files | `host/src/settings/*` — this store is one more of them |
| Credits member | the Wallpaper Engine spec §7 |

The finder adds a registry, a credential store and a surface. It adds no
downloader, no second asset model and no second font catalogue.

## 7. Architecture

```
src/web/packages/host/src/assets/
  source.ts        the AssetSource port and SourceContext
  sources.ts       the one registry array
  search.ts        the route's work: credential gate, abort, page
  routes.ts        the three /api/assets routes, mounted by server.ts
  fonts/curated.ts the curated catalogue as a source (reads nothing at runtime)
  icons/lucide.ts  the local Lucide adapter
  icons/fontawesome.ts the remote adapter

src/web/packages/host/src/settings/
  credentials.ts   the store; credentials-registry.ts the known ids

src/web/packages/editor/src/asset-finder/
  client.ts        sources(), search(), bytesOf() — fetch only, no provider calls
  modal.tsx        tabs, search, grid, footer action
  row.tsx          one result
  actions.ts       per-kind action (R5), through the asset manager

src/web/packages/editor/src/editor-shell/
  settings.tsx     the fourth tab, Connections
```

The curated font catalogue's data lives in the editor bundle today
(`font-trios.generated.ts`), and moving it into the host would copy 261 faces
across a wire for no gain. So `curated-fonts` is served by the **host** like
every other source — one contract, no exception — with the host importing the
generated table from a shared module rather than the editor re-implementing the
port.

## 8. Failure modes

| Situation | Behaviour |
|---|---|
| A source is unreachable | its chip says `source-failed` with the source's own message; the other sources' results stay in the grid |
| Every enabled source fails | the grid says so once, naming each source; it is not an empty result |
| A source needs a credential that is unset | its chip says `needs-credential` and links the Settings tab; no call is made for that source |
| A credential is wrong | `source-failed` after `verify`, with the host's status code; the value is never echoed |
| A credential is declared `cookie` | refused at write time with the reason; v1 stores bearers only (R10) |
| A source is disabled while a search is in flight | its late page is discarded; the grid keeps the enabled sources' |
| A late search response | discarded, never rendered |
| A result's bytes are missing | that row's action refuses, naming the item; the grid stays |
| An import exceeds the asset caps | the asset manager's own refusal, unchanged and shown |
| A source cannot name a licence | `unknown` is recorded and displayed; the import is not blocked |
| A credentials file is hand-edited to nonsense | a bad entry is dropped on read, as `theme-origins.ts` does; the rest survive |
| Wallpaper Engine is absent | its tab is drawn with the WE module's own absence reason, not an error |

## 9. What this does not decide

- Stock image and stock video providers, and their keys. The registry is ready;
  the providers are their own decision, because each brings its own terms.
- **Account-login sources** — providers whose access is a signed-in session
  rather than a token. The type has a place for one (R10) and no handler ships.
  Choosing one is a decision about a named provider's terms, not a generic
  capability: some forbid redistributing an asset inside a theme at all, which
  no auth mechanism can fix.
- Live Fontsource search (R4 defers it).
- Recolour beyond the existing `monochrome` treatment.
- Where a keyed provider's rate limit is enforced: this spec expects the source's
  own adapter to do it and does not add a shared limiter before there is a second
  consumer.
- Whether the host's *data* providers read the same credential store. They will
  (that is why it is not in the finder), but their specs decide how.

## 10. Reuse gate — the seven rungs

**Rung 1 — Yunari.** Searched for an existing source registry, credential store
and asset search. Found: the asset manager (bytes, caps), the font catalogue and
its query/facet/specimen machinery (browse), Settings' dialog and tab model
(modal), and eight host settings stores (none holding a secret). No registry, no
credential store, no search surface.

**Rung 2 — dependencies.** Searched for a keychain binding and a search client.
`keytar` and equivalents are native modules — refused by the dependency rule and
recorded as such in R6. Font Awesome's and Lucide's data come from packages
already present (`lucide-react`) or one HTTP GET (Font Awesome); neither needs a
client library.

**Rung 3 — platform.** Base UI's `Dialog` is the modal already in use. Node's
`fs` writes the credentials file. `AbortSignal` cancels a search. Nothing here
needs a native API the host does not already use.

**Rung 4 — ecosystem.** Searched how other editors host asset search (VS Code's
extension-provided sources, Figma's plugin-run asset panels, Penpot's asset
libraries). The shape that recurs is a **provider port plus a registry**; none
of them solves attribution for a published artifact, which is why `credits.json`
is Yunari's own and the port carries `creditsOf`.

**Rung 5 — comparison.**

| Option | Fit | Cost | Risk | Verdict |
|---|---|---|---|---|
| Sections inside the Add pane | no new surface | five search UIs in a 240px column | the font grid shrinks to unusable | rejected |
| One component per source | independent | N surfaces, N search boxes | the fifth source is a fifth UI | rejected |
| One modal over one registry (chosen) | one owner per concern | one new surface | the registry must stay data | chosen |

**Rung 6 — probe.** Measured: 261 curated faces (the font plan's own figure);
`lucide-react` 1.48.0 present at `dependencies.md:19`; the Settings tab list is
one `readonly SettingsTab[]` with three entries, so a fourth is a data change;
`content.monochrome` exists in `scene-fabric/src/fabric-image.ts`.

**Rung 7 — build.** The smallest build that holds: one port, one registry array,
one credential store, one modal. No dependency, no second asset model.

## 11. Landing order

1. **Credentials** — the store, the known-id registry, the two routes and the
   Connections tab. Independently useful and testable with no source.
2. **The port and the registry** — `source.ts`, `sources.ts`, the search route,
   and `curated-fonts` as the first source. No UI yet; proved by route tests.
3. **The modal, fonts only** — tabs, search, grid, `Apply to preset`, and the
   font picker's move out of the selection inspector.
4. **Lucide** — the local adapter and the Icons tab. Proves "add a source without
   touching the UI", with one source in the category.
5. **Font Awesome Free** — the remote adapter, which is also the second icon
   source and therefore the first mixed grid, the first-search host notice, and
   the credits entry at import.
6. **Wallpaper Engine** — register the WE module as a local source, with the WE
   plan's export flow as its per-kind action. Lands after that plan's host tasks.

Phases 1–4 need no network and no key, so they land behind phase C without
another external gate. Phase 5 is the first remote call and the first §132
discharge; it should land together with the credits member.

## 12. Acceptance

- Adding `lucide` to the registry draws the Icons tab and changes no file under
  `asset-finder/` — the registry is data.
- One search with both icon sources enabled answers results from both, each row
  naming its source, and no two rows share an id.
- Disabling a source removes its rows and issues no call for it.
- A failing source leaves the other source's results in the grid, and its chip
  names the failure.
- `Load more` advances every source with a cursor and appends without reordering
  the rows already shown.
- A credential id the registry does not know is refused with 400; a credential
  declared `cookie` is refused with a message naming R10.
- `GET /api/credentials` returns `set` and `hint` and **no value**, for a stored
  key and for an unset one.
- `PUT` then `GET` shows `set: true` and a four-character hint; `DELETE` returns
  it to `set: false`.
- A source whose `requires` is unset answers `needs-credential` and makes no
  outbound call (asserted with a fetch spy that is never called).
- An abandoned search's late response never renders (asserted with two deferred
  responses resolved out of order).
- An imported icon carries a credits entry with a non-empty `licence` and
  `sourceUrl`, and a theme published with it validates with the member present.
- An imported icon works with the network disabled after import.
- The font picker no longer renders in the selection inspector; the inspector's
  font field opens the modal on the Fonts tab.
- With no listing source available, Add → File behaves exactly as today (the
  existing DOM test passes unchanged).

## 13. Measurements

```text
curated faces the Fonts tab browses       261   (font-trios.generated.ts)
curated trios                             from GENERATED_TRIOS
Settings tabs today                        3    (appearance, keyboard, about)
lucide-react                             1.48.0, ISC + MIT (dependencies.md:19)
known credentials in v1                    0    (no v1 source requires one)
```

All figures read on 2026-10-21 from the files named beside them.
