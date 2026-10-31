# 0020 — A theme listing says whether a picture exists

- **Date:** 2026-10-31
- **Status:** accepted
- **Paths:** `src/web/packages/host/src/server.ts`, `src/web/packages/host/src/themes/thumbnails.ts`, `src/web/packages/host/public/theme-list.js`

## Problem

`theme-list.js` draws a row per stored theme and always points an `<img>` at
`/api/themes/<id>/thumbnail`, swapping in a placeholder when the request fails.
A theme without a picture is normal, so every such theme costs one 404 in the
console — eleven on the e2e fixture — which is indistinguishable from a real
missing asset (#168). The page cannot tell "no picture" from "picture failed"
without asking.

## Rung 1 — internal owner

Searched: `theme-list.js` and its two callers (`library.html`, `settings.html`
via `/api/themes/active`), the thumbnail route in `server.ts`, and
`themes/thumbnails.ts`.

Found: the thumbnail store already owns where a picture lives (`FILE`,
`read`, `write`, `remove`) but answers no presence question; the listing route
calls `themeStore.list()` and forwards its entries unchanged. Nothing else
needs the fact, and no second listing exists that would have to agree.

## Rung 2 — installed dependencies

Searched: nothing to reuse — the answer is one `fs.stat`.

## Rung 3 — native platform

Searched: Node `fs.stat` / `fs.access`, and HTTP caching headers.

Found: `stat` answers existence without reading the file, which is the cost the
listing must not pay per theme. A cache header cannot help a resource that is
never fetched.

## Rung 4 — public solutions

Searched: how comparable galleries avoid missing-image requests — `<img>` with a
server-known presence flag, versus `IntersectionObserver` laziness, versus a
blank CSS background.

Found: lazy loading still requests when the row is shown, and a CSS background
still issues the request; only the server-known flag removes it. This is the
standard "listing carries its own media availability" pattern.

## Rung 5 — integration comparison

| Option | Fit | Unsolved work | Verdict |
|---|---|---|---|
| Keep requesting; 404 is the fallback | Works, noisy | every clean load logs N 404s | rejected: noise hides real failures |
| Read every picture during `list()` | Truthful | inflates the listing | rejected: listing is deliberately one small read per theme |
| `thumbnails.has(id)` in the listing | Exact; stat-only | one stat per theme | chosen |
| Lazy `<img>` / CSS background | no request saved | none | rejected: still requests |

## Rung 6 — smallest probe

The store test asserts `has()` answers true after `write` and false after
`remove` and for an invalid id; the route test reads `/api/themes/active` and
asserts the flag appears only for a theme with a picture; the page test asserts
no `<img>` is created for a row without the flag.

## Decision

The thumbnail store gains `has(id)` (`stat`, invalid id refused as `false`), the
listing route adds `thumbnail: true` to the themes that have one, and
`theme-list.js` draws the placeholder directly when the flag is absent. A
picture that exists but is corrupt still answers 404, which is the honest
answer for a file the reader refuses.
