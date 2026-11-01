# 0053 — the finder's favourites extend the host port

- **Date:** 2026-10-31
- **Status:** accepted
- **Paths:**
  `src/web/packages/editor/src/editor-session.ts`

## Problem

The retired Fonts picker carried the author's favourite trios. The finder's
Fonts pane replaced it and lost the toggle, while the host still stores the
list. Restoring the feature must not reintroduce a second favourites store or
the deleted `font-specimen-cache.ts`: a wrong integration would either fork the
persisted list or hold a second face cache against the host asset route.

## Rung 1 — internal owner

Searched: `codegraph explore "FavoritesClient fontActions favorite font
trios"` (no index in this worktree; CodeGraph reported no `.codegraph/`),
then grep/Read across `favorites-client.ts`, `favorites-client.test.ts`,
`editor-session.ts`, `editor-shell/session-facade.ts`, `asset-finder/fonts.tsx`,
`asset-finder/modal.tsx`, `selection-inspector/`, `host/src/settings/
font-favorites.ts` and `host/src/server.ts`.

Found: `favorites-client.ts` is the editor's one reader/writer of
`/api/font-favorites`; `editor-main.ts` constructs it once and passes it as
`EditorSessionOptions.favoritesClient`; the host owns the JSON store and route.
The session already threads the client to the selection inspector, whose
`FontFaceEdits.listFavorites`/`saveFavorites` are the surviving ports. The
finder's font writes travel through `FontActions` (`#fontActions()` in the
session, `font` on `FinderProps`). No finder-side store remains.

## Rung 2 — installed dependencies

Searched: the editor's manifest and the favourites call sites. Found: the
client uses the platform `fetch`; no installed package provides a favourites
store, and adding one would duplicate the host file already owned by
`font-favorites.ts`.

## Rung 3 — native platform

Searched: browser APIs available to the editor. Found: `fetch` reaches the
host route, `localStorage` is already the finder's disabled-source preference
store rather than authored/host state, and `document.fonts`/`FontFace` are the
specimen loader's platform surface. None of them is a favourites owner.

## Rung 4 — public solutions

Searched: the installed dependency tree and current library docs for a
favourites/persistence helper (no candidate package beyond the host's existing
JSON-file store). Found: the mechanism is a small list persisted by the host;
the browser and Node APIs already used are the applicable public solutions, and
no external implementation changes the ownership question.

## Rung 5 — integration comparison

| Option | Fit | Unsolved work | Verdict |
|---|---|---|---|
| Restore `FontsBodyHost` with its own state and specimen cache | Repeats the retired picker and the deleted cache | Rebuilds the cache the ruling removed | rejected |
| Create a finder-local favourites store | A second persisted list beside the host's | Migration and two sources of truth | rejected |
| Extend `FontActions` with `listFavorites`/`saveFavorites`, wired to the existing `FavoritesClient` in `#fontActions()` | Reuses the one client and route; the finder holds only the rendered session state | None beyond optional ports for a host with no store | chosen |

## Rung 6 — smallest probe

`favorites-client.test.ts` already exercises GET/PUT and the 404/no-store
answer, and `host/src/server.test.ts` exercises the route's read/write/delete.
The new DOM suite mounts the finder with those same ports and asserts the star
writes the expected trio id through `saveFavorites`; the existing specimen
suites prove the host asset route is the only face loader.

## Decision

Add optional `listFavorites`/`saveFavorites` to `FontActions` and wire them in
`EditorSession.#fontActions()` from the already-constructed
`FavoritesClient`. The finder holds the returned list as transient UI state and
writes through the client. No specimen cache returns; `useSpecimens` in
`font-preview-panel.tsx` remains the only FontFace loader.
