# 0022 — A paired display reads the library listing it is offered

- **Date:** 2026-10-31
- **Status:** accepted
- **Paths:** `src/web/packages/host/src/server.ts`

## Problem

The player's own theme chooser (`packages/player/src/theme-chooser.ts`,
`listLocalThemes`) fetches `/api/themes` with the display credential, and
`/api/themes` answers only a loopback peer. A paired display reaches the host
over the LAN, so the read is 403, the chooser disposes itself on that failure,
and the control the display is meant to have never appears (#238, `vg-758`).

## Rung 1 — internal owner

Searched: `server.ts`'s `/api/themes` branch, `/api/themes/active`, the player's
`theme-chooser.ts` and its mount in `main.ts`, and the admin pages that read the
same route.

Found: the listing route is the owner of "what themes exist" for readers, and
the chooser already maps each entry to `{ id, name }` (`choiceOf`) and refuses
anything else. The route returned the whole index (costs, ground, origin,
facets, templates) to the loopback admin page and 403 to every LAN caller. The
chooser is already mounted for paired displays; only the read was missing.

## Rung 2 — installed dependencies

Searched: nothing to reuse — the answer is a projection of the existing
`themeStore.list()` result.

## Rung 3 — native platform

Searched: HTTP content negotiation and query-flagged projections.

Found: a second route or a `?fields=` query would be a second contract to keep
in step with the first. The caller's peer address already distinguishes the two
readers, and the route is authenticated before it is reached.

## Rung 4 — public solutions

Searched: how admin APIs expose a narrow public listing beside a full one —
separate route versus a projection keyed on the authenticated viewer.

Found: both are common; a projection keyed on the viewer avoids a second route,
a second auth check and a second shape drifting from the first.

## Rung 5 — integration comparison

| Option | Fit | Unsolved work | Verdict |
|---|---|---|---|
| 403 stays; chooser hides | safe | the feature never works on a TV | rejected: issue is the control never appearing |
| New `/api/themes/choosable` route | separate | second route + second guard + drift | rejected: a projection is enough |
| Whole index to LAN | widest disclosure | exposes costs, origin, templates to any paired screen | rejected |
| Narrow `{ id, name }` for non-loopback | exact | none | chosen |

## Rung 6 — smallest probe

`server.test.ts` pairs a display, reads `/api/themes` from a LAN peer with the
cookie and gets 200 with `[{ id, name }]` only, while the whole-theme GET stays
403 beside it; the loopback test asserts the full index is still served here.
The unpaired and removed-credential refusals are unchanged, because they are
decided before the route.

## Decision

The `/api/themes` route answers a paired non-loopback reader with the two
fields a chooser names a row by (`id`, `name`) and nothing else. The loopback
caller keeps the full index. `/api/themes/<id>` (the whole theme, with its
document), `/api/themes/active`'s write and every admin route stay loopback-only.
A theme's name is part of what a paired display is offered, so it is disclosed
by design; nothing else from the library is.
