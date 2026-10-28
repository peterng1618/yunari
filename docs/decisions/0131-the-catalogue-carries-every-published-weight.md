# 0131 — The catalogue carries every published weight, and a trio asks the host for its families' cuts

- **Date:** 2026-10-28
- **Status:** accepted
- **Paths:** `src/web/scripts/generate-font-trios.mjs`

## The problem

A type token lists the weights its *packaged* faces hold, so any weight the
author cannot see is a weight they cannot choose. The curated catalogue records
only the cut each trio role recommends: 261 faces across 174 families, one to
three weights per family. A trio import therefore packages three faces and the
weight field offers three entries, while the same family reached through the
online Google source offers all nine.

The data is not the hard part — Fontsource's metadata already lists every
published weight for every family the generator asks about. The question is
**where those weights travel**: the trio is one search result among 379 the
curated source returns in a single page, and copying each family's cuts onto
each trio duplicates shared data hundreds of times.

## Rung 1 — Yunari

Searched: `CURATED_FACES`, `CURATED_TRIOS`, `toFontCut`, `toFontTrioInfo`,
`resultOfFamily`, `resultOfTrio` (host); `AssetSource`, `SearchPage`,
`bytesOf` (host asset port); `FaceChoice`, `facesOf`, `WeightField`
(editor token inspector); `familyCutsOf`, `cutsOf`, `leadCutOf` (finder
preview); `applyFontTrio`, `addTypeTokensFromTrio`, `#trioCuts`, `#adoptCuts`,
`addTypeTokenFromCut` (editor document); `google.ts` (host).

Found: the weight list reads the document's **packaged** faces
(`facesOf(family)` → `FaceChoice[]`), so a weight is choosable only when its
bytes are declared. Solo family import already adopts every cut the result row
lists (`familyCutsOf`), which for the Google source is every published cut and
for the curated source is the catalogued one to three. Trio import adopts
exactly the three role cuts (`#trioCuts`). Role tokens already bind the trio's
recommended cut through `rolePreset`, so "start on the recommended weight" is
today's behaviour once more weights exist. Nothing in the repo carries a
family's weight list as data of its own.

## Rung 2 — dependencies

Searched: the generator's own Fontsource calls (`/v1/fonts/:id` →
`weights`, `styles`, `subsets`, `npmVersion`, `license`); the editor's packaged
asset metadata (`CuratedFontFace`); installed packages for anything that reads
weights from a font file.

Found: the generator already fetches every field needed to emit every weight's
pinned WOFF2 URL. No new dependency is needed, and parsing the font binaries
(`fontkit`, `opentype.js`) would answer a question the provider already answers.

## Rung 3 — platform

Searched: Node's `fetch` (already the generator's transport); browser
`document.fonts` and `FontFace`; CSS `font-weight`.

Found: no platform API enumerates a remote family's weights. `document.fonts`
knows only faces already loaded, and CSS renders the nearest declared weight
rather than saying which exist. The list has to be data.

## Rung 4 — ecosystem

Searched: web search for Google Fonts metadata/CSS2 weight enumeration and
Fontsource's v1 metadata — **the session's search tool answered that no web
search was available**, so this rung rests on the sources already in the repo
plus the live provider probe in rung 6, and is recorded as such rather than
presented as a survey.

Found: Google Fonts metadata exposes `fonts[{weight, style}]` per family and
CSS2 encodes weights in the family tuple; Fontsource's v1 metadata (the
provider this catalogue already pins) exposes `weights`, `styles`, `subsets`
and `npmVersion`. Both mean the same thing: a family's weight list is
provider metadata, not something to discover from files.

## Rung 5 — comparison

| Option | Fit | Cost | Risk | Verdict |
|---|---|---|---|---|
| Every trio result carries its three families' full cuts | Direct; no new surface | Measured 691 KB → 3.4 MB per keystroke search | Search latency on every query | Rejected |
| Page-level family → cuts map on the search answer | Shared data sent once | ~250 KB/search plus page plumbing into the preview panel | Wire field the other sources never fill | Rejected |
| Family rows carry their cuts; trios fetched on demand at import | Family previews stay truthful; trio payload unchanged | One route, three localhost requests per trio import | New host route | **Chosen** |
| Runtime Google lookup at apply | No committed data change | Needs the online provider at import time | Import depends on the network; rejected when the approach was chosen | Rejected |
| Free-weight ladder that unlinks the face | Smallest code | No bytes behind most weights | The token model exists to stop the browser fallback | Rejected |

## Rung 6 — probe

`https://api.fontsource.org/v1/fonts` against the committed catalogue's 174
family ids: 0 missing; **1,003** Latin/normal faces if every weight is emitted
(currently 261); weight counts per family 1–9 (22 families with one, 48 with
nine). Approximated search payloads from the same metadata: trio results with
full family cuts 691 KB → 3,423 KB; family rows alone +~185 KB.

## Decision

The generator emits every published Latin normal weight of every curated family,
so the catalogue itself is the offline authority. `role` and `clamped` move onto
a trio-only face subtype, which removes the "whichever pairing reached the face
first" caveat rather than extending it to 742 new faces.

Search results stay lean: family rows carry their full cut list (their preview
chips and `N cuts` become true, and solo import needs no code change), while a
trio keeps its three role cuts and asks the host for each role family's cuts at
import time through `GET /api/assets/family-cuts`. Duplicating shared cuts
across 379 trio results is what the measurement rejected; fetching them when one
trio is actually imported is three local requests.
