# 0118 — Background default bounds and session view preferences

- **Date:** 2026-11-07
- **Status:** accepted
- **Paths:** `src/web/packages/renderer-core/src/theme/document.ts`, `src/web/packages/editor/src/asset-finder/finder-model.ts`

## Problem

A new background picture must start clipped to the display rather than to the
artboard, and the editor's list surfaces must open newest-first while keeping
the viewer's sort and filter for the rest of the session. Both rules fail
quietly if a surface spells its own default: a second default drifts from the
first, and a view preference written into a theme document becomes authored
state.

## Rung 1 — internal owner

Searched: CodeGraph `BACKGROUND_MEDIA_BOUNDS`, `restoreBackgroundMedia`,
`backgroundMediaFor`, `DEFAULT_SORT`, `SORT_ORDERS`, `useWallpaperTab`,
`categoryTabs`, `FinderState`.

Found: `restoreBackgroundMedia` in `background-media-memory.ts` is the editor's
one "an unseen asset gets the defaults" rule; the MCP `set_background` draft
tool re-spells the same rule in `backgroundMediaFor`. `document.ts` already owns
every other background default (`BACKGROUND_MEDIA_DEFAULTS`,
`DEFAULT_BACKGROUND_EXTENT`, the legibility bounds) but has no default for the
required `bounds` field. Store ordering belongs to `sort-orders.ts`
(`DEFAULT_SORT`, `SORT_ORDERS`); the Wallpaper Engine tab owns its own sort in
`use-wallpaper-tab.ts`. The finder's selected tab is `AssetFinder`'s `active`
state; the store's sort and facets are `StoreRegion`'s own state, and the region
explicitly persisted neither.

## Rung 2 — installed dependencies

Searched: `@base-ui/react/select` (the sort well is a controlled select; it has
no persistence of its own), `react` state lifecycle (a component that renders
`null` for another mode unmounts, so its state is gone on return).

Found: no installed dependency owns view-state persistence. Base UI's select
supplies the popup and keyboard model only.

## Rung 3 — native platform

Searched: Web Storage API — `localStorage` and `sessionStorage`; `WindowObserver`
not applicable.

Found: `sessionStorage` is per browser tab and cleared when the tab closes, which
is exactly "the app session"; a reload keeps it, which the requirement permits
("a browser reload may be a new session"). It can throw on access in a private
or blocked context, so every read and write is guarded and a refusal leaves the
in-memory state as the only record. The product already guards `localStorage`
the same way (`storedDisabled`, `readStorage`, `createGridDensityPreference`).

## Rung 4 — public solutions

Searched: no external adapter is being adopted; the change extends owners that
already exist. The relevant public contract is the Web Storage standard's
`Storage` interface (`getItem`/`setItem`/`removeItem`, `QuotaExceededError`),
which supplies the whole mechanism the session preference needs.

Found: no library earns a dependency for two guarded calls.

## Rung 5 — integration comparison

| Option | Fit | Unsolved work | Verdict |
|---|---|---|---|
| Session preference in `sessionStorage` | Per-tab session, native, no theme bytes | Guard accessor; validate parsed values | Chosen |
| Module-level variable | Same lifetime as the bundle | Lost on a reload the user may consider the same session; not observable by tests | Rejected |
| `localStorage` | Crosses sessions | The requirement stops at the session, and a view choice would outlive the document it belonged to | Rejected |
| Persist in the theme envelope | Survives everything | Authored state gains transient view data; every reader would have to ignore it | Rejected |

## Rung 6 — smallest probe

Behavior was already established by the existing guarded-storage tests
(`storedDisabled`, the density preference's refused-write case) and by the store
region's own unmount-on-mode-change test: the region renders nothing for a mode
that is not Themes, so its state cannot survive a return without external
storage. jsdom implements `sessionStorage`, so a unit case can prove the write
and a remount.

## Decision

Add `DEFAULT_BACKGROUND_MEDIA_BOUNDS = "display"` to `document.ts` — the owner
of the background media's defaults — and read it from both `restoreBackgroundMedia`
and the MCP `backgroundMediaFor`, deleting the second literal. Keep every stored
`bounds` the document or the memory entry already carries.

Keep the store's and finder's sort/filter state in their existing owners, and
persist only those choices through one guarded `sessionStorage` helper. The
default sort moves to the existing `DEFAULT_SORT` / Wallpaper Engine state: the
library's `updatedAt` and the tab's `updated` field, both newest first. Nothing
new is written into a theme document.
