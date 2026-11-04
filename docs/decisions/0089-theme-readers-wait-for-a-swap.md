# 0089 — A theme reader waits out the save that is swapping its folder

- **Date:** 2026-11-03
- **Status:** accepted
- **Paths:** `src/web/packages/host/src/themes/store.ts`

## Problem

Saving a theme the TURZX panel is showing briefly moved the panel to the
default theme. `write()` replaces a theme's folder with two renames: the stored
folder goes to `.retired-…`, then the staged folder takes the theme's own name.
Between those renames the id names nothing, and every reader — `list`,
`exists`, `readEnvelope`, `readAsset`, `read` — answered from exactly that
state. The assignment path reads those answers directly: `activeThemeMap` drops
a choice `list()` no longer returns, and `assignedThemeFor` falls back to
`DEFAULT_DISPLAY` when `exists()` says no. A poll or a re-resolution landing in
the gap therefore told the panel the theme was gone, and the panel navigated to
the default scene. The next resolution found the theme again, so the fault
looked like a random theme switch rather than a save.

## Rung 1 — internal owner

`store.ts` already owns the swap (`write`), the scratch-folder repair that
makes it crash-safe (`repairScratch`) and the `saving` set that tells a listing
a save is in flight. Its consumers are `assignedThemeFor`
(`host/src/main.ts`) and `activeThemeMap` (`host/src/server/themes-routes.ts`),
both of which treat "not stored" as "fall back to the default". No other module
owns the folder's visibility. The gap is inside the existing owner; nothing is
missing but a reader-side wait.

## Rung 2 — installed dependencies

`node:fs/promises.rename` is the only primitive the store uses. It is atomic
per call, and a directory replacement cannot be one call here: POSIX refuses a
rename onto a non-empty directory and Windows refuses one onto any existing
directory. Nothing else installed provides a snapshot read or a transaction
over two renames.

## Rung 3 — native platform

Node has no directory lock, no transactional filesystem and no reader/writer
coordination. The store is single-process and already serialises its own
writers through `saving`; the missing half is the read side. An in-process
registry of the saves whose swap is running is the smallest platform-level
coordination that can hold the invariant, and it needs no path outside the
store.

## Rung 4 — public solutions

Searches for `node atomic directory swap readers see missing between renames`,
`rename directory replace atomically windows` and `node fs directory
transaction` returned no reachable source in this offline environment. The
constraint is the same one the store's crash recovery already records (0004,
`repairScratch`): the swap is two renames, a crash between them is recoverable
but not impossible, and the stored folder is the only truth. A reader that
wants a consistent answer has to be kept out of the gap.

## Rung 5 — integration comparison

| Option | Fit | Unsolved work | Verdict |
|---|---|---|---|
| Retry a reader that answered "missing" | Keeps every reader unchanged | The gap has no known duration; a retry either guesses a count or sleeps, and an assignment poll can still be answered from the wrong state | Reject |
| One rename onto the target | Removes the gap | Impossible for a non-empty directory on both supported platforms | Reject |
| Copy the new folder over the old in place | One step | Leaves a half-written theme, the exact failure the staged swap exists to prevent | Reject |
| A lock file every reader opens | Works across processes | A second filesystem mechanism with stale-lock recovery, for one process's own write | Reject |
| Wait on the store's own in-flight swap | The gap is the store's; the store can say when it ends | Readers must not wait inside `write`'s own reads; the wait must release on failure too | **Reuse** |

## Rung 6 — probe

`store.test.ts` pauses a real save in its second rename with a gated rename,
proves the gap exists (`stat(target)` is `ENOENT`), then starts
`exists`/`readEnvelope`/`read`/`readAsset`/`list` and releases the save. With
the waits, every reader answers the saved document (name "Second") and the new
asset. With the waits removed the same test answers `exists === false` and the
old/missing document, which is the fault on hardware. The failure path is
covered by the wait resolving in the save's `finally`, so a refused save cannot
wedge a reader.

## Decision

`write()` registers a promise in a per-id `swapping` registry immediately
before it renames, and settles it in the `finally` that already runs after the
swap (success or failure). The public readers — `list` (all ids), `read`,
`readEnvelope`, `readAsset`, `exists` (that id) — await the registry before
they look, looping until no swap is pending. `write`'s internal reads stay
outside the wait, so it cannot wait on itself. The stored folder remains the
only truth; readers only stop observing the store's own two-step write as if it
were a deletion.
