# 0103 — The catalogue is read when its half is drawn

- **Date:** 2026-11-03
- **Status:** accepted
- **Paths:** `src/web/packages/editor/src/store-mode/online-listing.ts`,
  `src/web/packages/editor/src/store-mode/mine-listing.ts`,
  `src/web/packages/editor/src/store-mode/region.tsx`

## Problem

The Themes region mounts on the local half and lists this PC's library, but its
online hook read the remote catalogue on mount as well. A cold catalogue fetch
therefore sat on the path of the first paint even though nothing on screen used
it. The region unmounts on every mode change and re-mounts on return, so the
same fetch was paid again whenever the browser's `max-age=60` entry had gone
stale — the "seconds on the first switch, fast afterwards" report.

## Rung 1 — internal owner

Searched: `useOnlineListing`, `useMineListing`, `StoreRegion` mount and half
state, `onlineThemeSource`, the shell's mode switch. Found: `useOnlineListing`
owns the catalogue read and is called only by `useMineListing`, which the region
calls once. The region already owns the chosen half (`tab`), so the deferral is
one flag through that existing call chain rather than a cache.

## Rung 2 — installed dependencies

Searched: React's effect semantics (the hook's `useEffect` already gates on
dependencies) and the platform HTTP cache used by `onlineThemeSource`. Found:
the hook's effect is the read's only owner; nothing upstream requires the read
to start before the half is chosen. The `max-age=60` contract is unchanged.

## Rung 3 — native platform

Searched: browser `fetch`/HTTP cache behaviour documented in
`online-source.ts`. Found: the origin's `max-age=60` already owns reuse. No
second cache is needed for the reported cost; adding one would introduce
invalidation the platform already performs.

## Rung 4 — public solutions

Searched: lazy-list patterns (fetch the remote listing when its tab is
selected) and cache-with-invalidation alternatives, against the repo's own
`useMineListing` precedent (the author's rows are read only while Mine is on —
`mine-listing.ts` gates its second effect on `on`). Found: the repo already
uses "read only while this source is selected" for the same surface; the
catalogue path was the inconsistent one.

## Rung 5 — integration comparison

| Option | Fit | Unsolved work | Verdict |
|---|---|---|---|
| Module-level catalogue cache invalidated by save/delete/assign | Could hide the cost after the first read | New invalidation surface for a remote catalogue no local write changes; the first read still blocks | Rejected |
| Cache the local listing across unmounts | Small win on disk reads | Invalidate on every save/delete/publish/bake | Rejected as unnecessary for this report |
| Read the catalogue only while the online half is drawn | One boolean through the existing call chain; matches the Mine precedent | The first online switch shows the arriving state it already shows on a cold mount | Chosen |

## Rung 6 — smallest probe

`mine-listing.test.ts` mounts the hook with a counting transport: with
`enabled: false` only the session probe is called; flipping `enabled` adds
exactly `catalogueIndexUrl()`. The test was run against the previous
pass-through (`enabled: true`) and failed on the first assertion before the
change was kept.

## Decision

Pass `enabled: tab === "online"` from the region through `useMineListing` to
`useOnlineListing`, and skip the read while it is false. Keep the browser cache
as the only reuse mechanism.
