# 0051 — The finder's specimens read the host's asset route

- **Date:** 2026-10-31
- **Status:** accepted
- **Paths:** `src/web/packages/editor/src/asset-finder/client.ts`, `src/web/packages/editor/src/asset-finder/font-preview-panel.tsx`, `src/web/packages/editor/src/asset-finder/font-preview-panel.dom.test.tsx`

## Problem

A finder specimen must draw the same face Apply writes. Loading the provider's
`previewUrl` from the browser makes the two disagree whenever the browser cannot
reach the CDN: the card falls back while Apply, which reads `/api/assets/bytes`
through the host, still writes the real bytes. Bundling every curated face was
measured at 392 faces and 7.19 MB, which the owner rejected on size; the owner
ruled that specimens be fetched through the host instead.

## Rung 1 — internal owner

Searched: `codegraph_explore "FontCut previewUrl useSpecimens font-preview-panel
finder-card assetBytesUrl assetBytes"`; source of `font-preview-panel.tsx`,
`asset-finder/client.ts`, `asset-finder/finder-card.tsx` and the host's
`assets` routes.

Found: `useSpecimens` is the only owner of specimen loading, and `FontCut`
carries the same `source` and `id` Apply hands `assetBytes`. `client.ts` already
owned the host bytes route as an assembler function (`assetBytesUrl`) called
inside `assetBytes`; it was private to that call. Extending that function to be
exported gives the specimen the exact URL Apply reads, with one owner for the
query shape — not a second spelling of it in the panel.

## Rung 2 — installed dependencies

Searched: the host's static-asset response path (`/api/assets/bytes`), Fabric 7
(no font loading), Vite 8 asset handling (unused now that nothing is bundled).

Found: the host route already streams the cut's bytes with CORS-free same-origin
service and the editor is already served by that host, so no dependency change
is needed. No installed package fetches provider bytes for a browser.

## Rung 3 — native platform

Searched: `FontFace`, `document.fonts`, CSS `@font-face` URL sources.

Found: `FontFace(family, url(...))` accepts any URL the browser can fetch; a
same-origin host URL needs no CORS or CSP allowance. The platform offers no way
to build a face from bytes that are neither present nor fetchable, so the URL
must resolve — which the host route guarantees.

## Rung 4 — public solutions

Searched: Context7 `/mdn/content` — "FontFace constructor url source"; MDN's
`FontFace` page and the CSS Font Loading API.

Found: the constructable-face API is the documented path for handing the
browser a face by URL, and a same-origin URL is the ordinary case. The
alternatives in the wild are a CDN URL (the reported bug), bundled bytes (the
rejected 7.19 MB option), and a runtime fetch-then-blob-URL. The blob path adds
a fetch, a lifetime and a revoke without changing which bytes are drawn; the
direct URL lets the browser's font cache do it.

## Rung 5 — integration comparison

| Option | Fit | Unsolved work | Verdict |
|---|---|---|---|
| Provider `previewUrl` in `FontFace` | draws the real face only with CDN reachability | the reported bug | rejected (status quo) |
| Host `/api/assets/bytes` URL | same origin, same bytes Apply writes, no new owner | host must reach the provider | chosen |
| Bundle the 392 curated faces | offline-safe | 7.19 MB in the repo | rejected by the owner (size) |
| Runtime fetch → blob URL | same bytes | extra fetch, lifetime, revoke; no gain | rejected |
| One generated CSS `@font-face` sheet | curated faces only | same bytes as bundling; curated set only | rejected with bundling |

## Rung 6 — smallest probe

The host route is already exercised by `assetBytes` for Apply and by the host's
asset tests; no new endpoint is introduced. Measured against the alternative:
the complete curated specimen set is 392 faces / 7,191,344 B, so the request the
specimen now makes replaces a multi-megabyte build artefact with one GET on an
existing, already-tested route.

## Decision

Export `assetBytesUrl` from `asset-finder/client.ts` and have `useSpecimens`
build every `FontFace` source from it, so a specimen draws whatever the host
serves for the cut Apply would write. A provider cut goes through the same route
with its own `source` and `id`. `assetBytes` keeps calling the same function, so
the query shape has one owner. A load that fails still leaves the card on its
fallback family.
