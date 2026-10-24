# 0109 — Remote game metadata is a keyless Steam store lookup over a host-side cache

- **Date:** 2026-10-24
- **Status:** accepted
- **Paths:** `src/web/packages/host/src/providers/game/store-metadata.ts`,
  `src/web/packages/host/src/providers/game/store-metadata.test.ts`,
  `src/web/packages/host/src/providers/game/name-match.ts`,
  `src/web/packages/host/src/providers/game/name-match.test.ts`,
  `src/web/packages/host/src/providers/game/provider.ts`,
  `src/web/packages/host/src/providers/game/box-art.ts`,
  `src/web/packages/host/src/providers/helpers/foreground.ts`,
  `src/web/packages/host/src/server.ts`

## The problem

A game started outside Steam has no library manifest to read: its only local
identity is an executable name and, sometimes, a version-info product name. The
spec's original answer — show the executable name and no art — was ruled
insufficient by the user, who asked for name and box art regardless of the store
the game came from. There is no shared id across stores, so identity has to be
recovered by searching a store that does publish one, then matching the local
name to a candidate. The two hard parts are not the HTTP call: they are deciding
*which* candidate is the same game (a wrong match is a wrong cover and title),
and doing it once so a display works offline and Valve is not polled per frame.

## Rung 1 — Yunari

Searched: `packages/host/src/providers/game/` (provider, `steam-library`,
`box-art`), `docs/decisions/0108`, the spec's game section, the ledger's Phase 6
entries.
Found: Steam-only identity from local VDF/ACF, a local box-art route with
`realpath` containment and display-session auth, and no name matching or remote
client of any kind. `steam-library.ts` parses ACF manifests — nothing resolves a
bare name. The backlog rows vg-724 and vg-725 record the non-Steam and remote
questions this note answers.

## Rung 2 — dependencies

Searched: `src/web/package.json` and workspace manifests for HTTP, VDF, Steam or
metadata packages.
Found: no Steam/store dependency of any kind. Node's global `fetch` is the HTTP
client; no new dependency is permitted by the plan's Global Constraints.

## Rung 3 — platform

Searched: `store.steampowered.com/api/storesearch`, `/api/appdetails`, the CDN
asset path, and Windows executable version info.
Found: both endpoints answer keyless; `storesearch` returns candidates with
`id` and `name`, `appdetails?filters=basic` returns the canonical name and
`header_image`; `cdn.akamai.steamstatic.com/steam/apps/<id>/library_600x900.jpg`
answers for a game that is not installed. What the platform does **not** give is
the matching rule, the ambiguity refusal, the cache or the request budget — the
work this note is for. Probes: `storesearch` returns `total: 0` without `cc`, so
`cc=us&l=en` are fixed request constants; `appdetails` is throttled at roughly
200 calls per 5 minutes per IP, so a per-poll lookup is not viable.

## Rung 4 — ecosystem

Searched: npm/GitHub for Steam store clients and name→appid resolvers
(`steam-client`, `steamstoreapi`, `steam-searcher`, `steamgrab`, `appid`,
`@naouts/mcp-steam`, an Apify actor).
Found: every one is a thin wrapper over the same two endpoints, and each makes
the choice this project cannot take:

- `steam-searcher` and `steamgrab` return the first search result, which is
  exactly the `Doom` → `Doom Eternal` failure the user's ruling calls out.
- `steam-client` and `appid` do fuzzy or regex matching but return a score or a
  list and leave the accept/refuse decision, the cache and the offline path to
  the caller.
- `@jeppevinkel/steam-search` and the Apify actor scrape the store search page
  or switch endpoints, adding a shape that changes without notice.
- `appid` resolves against a bundled name list, not the store, so it cannot
  produce a cover at all.

None solves *this shape*: one accepted candidate, edition-suffix tolerance,
ambiguity refused, one lookup per game, cached cover bytes served from the host.
Using one would still leave that logic to write, behind an unmaintained wrapper
and a new dependency.

## Rung 5 — comparison

| Option | What it gives | Why not |
|---|---|---|
| Add one of the wrappers | The two requests | Leaves the whole decision, plus a dependency and its licence, for no saved work |
| Steam Web API `ISteamApps` | Official-ish list | Needs a user key, 100k/day, and does not carry covers |
| IGDB | Rich metadata, store-agnostic ids | Needs a Twitch client secret per install (vg-725) — a credential wall for a box art |
| SteamDB | — | No API, scraping forbidden by its own FAQ |
| Build the client here | Two `fetch` calls, a matcher, a cache | Chosen: no dependency, the refusal rule lives with the provider that owns presence |

## Rung 6 — probe

Run on this PC, 2026-10-24: keyless `storesearch` and `appdetails` answers; the
portrait cover for non-installed app 1201270 returns 200 `image/jpeg` at 68 599
bytes; the local library cache serves 16 of 19 installed apps. Recorded in the
ledger's Phase 7 probe entry.

## Rung 7 — build

Smallest thing that holds the invariant: `name-match.ts` (normaliser plus two
acceptance tiers, returning a winner only when exactly one candidate survives),
`store-metadata.ts` (the two requests, a name→appid cache including "no match",
cover bytes cached by appid, a 10-minute backoff after 429 or a failed request),
and the existing route extended to serve cached remote covers under the same
containment and display-session rules. No scheduler, no queue, no generic
provider: a lookup happens when presence needs a name, a cover when demanded.

**What would reopen this:** if a second store must be supported, the matcher and
cache are the reusable half and only the candidate source changes; if Valve
requires a key or removes the endpoints, the fallback is the local name, which
is what the spec had before this note.
