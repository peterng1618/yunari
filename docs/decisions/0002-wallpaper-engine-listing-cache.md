# 0002 — Wallpaper Engine listing cache

- **Date:** 2026-10-30
- **Status:** accepted
- **Paths:**
  `src/web/packages/host/src/wallpaper-engine/source.ts`,
  `src/web/packages/host/src/wallpaper-engine/cache.ts`

## Problem

The Wallpaper Engine tab is a library, not a search. Today every `listing()`
clears its in-memory map, relocates the install and rescans every library. The
scan reads every `project.json` and reads and classifies every `scene.pkg`, so a
large library costs seconds on every host process and every editor session. The
listing must survive a host restart while still noticing themes that were
subscribed or removed.

## Rung 1 — internal owner

Searched: `scanLibrary`, `createWallpaperEngineSource.listing`, `source.ts`,
`library.ts`, `locate.ts`, and the finder's `fetchWallpaperEngine` effect.
Found: `library.ts` owns the disk scan and already refuses unreadable items; the
source owns the process-lifetime map. Nothing persists the scan. `main.ts`
already places caches under `<app>/cache/` (artwork, game metadata), which is the
existing owner for disposable host data.

## Rung 2 — installed dependencies

Searched: Node `fs` and `path` types and runtime. Found: `fs.stat` and
`fs.readdir` are enough for a cheap fingerprint; no cache library is installed
and adding one would bring its own lifecycle for a single JSON file.

## Rung 3 — native platform

Searched: Node filesystem, `os.tmpdir` versus the app data directory. Found:
`fs.stat` exposes `mtimeMs` and `size` on Windows, and a library directory's
mtime changes when a workshop item directory is added or removed. The platform
does not provide a file watcher that survives a restart; a fingerprint is the
native equivalent here.

## Rung 4 — public solutions

Searched: "Node persist cache mtime size invalidation", "file cache JSON
invalidation mtime", and comparable local-library caches. Found: the common
pattern is a versioned JSON entry plus a cheap fingerprint of source
directories, not a TTL; a TTL would either serve removals or force the scan the
cache exists to avoid. Steam's own `workshopcache.json` is a cache with the same
shape, and is one of the fingerprint inputs rather than a trusted source.

## Rung 5 — integration comparison

| Option | Fit | Unsolved work | Verdict |
|---|---|---|---|
| Memory-only cache | Fast within one host process | Still rescans after every rebuild, which is the reported cost | reject |
| Disk JSON + TTL | Simple | A removed or added theme is invisible until the TTL expires | reject |
| Disk JSON + stat fingerprint | Survives restart and notices add/remove | Fingerprint pass per listing | accept |
| Watch the library with `fs.watch` | Live updates | Does not survive restart and adds handle ownership | reject |

## Rung 6 — smallest probe

The existing `source.test.ts` fixture writes two scenes, a video and an
unreadable directory. A probe will call `listing()` twice with a cache
directory, assert the second call answers the same items without re-reading a
package, then add an item directory and assert the next call lists it. That is
the same executable shape the test suite will keep.

## Decision

Persist the scan under `<app>/cache/wallpaper-engine/` as a versioned JSON
entry, guarded by a fingerprint of the install root, library directories,
`bin/workshopcache.json` and each item's `project.json`/`scene.pkg` stat. A
matching fingerprint answers from cache; anything else scans and rewrites the
entry. Cached paths are validated against the current libraries before use, so a
stale or edited cache cannot name a path outside a library. The source keeps its
in-memory map for byte and project requests in the same process.
