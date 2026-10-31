# 0038 — Game provider paths are native at the filesystem seam

- **Date:** 2026-10-31
- **Status:** accepted
- **Paths:** `src/web/packages/host/src/providers/game/box-art.ts`
  `src/web/packages/host/src/providers/game/steam-library.ts`

## Problem

The game provider reads Steam's cache and library from directories the OS
returns (registry root, temp dir in tests). It joined those native roots with
`path.win32.join`. `path.win32` always emits backslashes, so on a POSIX host the
joined path names nothing and the walks return empty. This is a portability
fix, not a new mechanism.

## Rung 1 — internal owner

Searched: `codegraph explore "locateBoxArt readSteamApps insideCache resolveWithin"`.
Found: `box-art.ts` owns cache-path joins and containment; `steam-library.ts`
owns library traversal. `box-art.ts` already uses native `path` for
`readCachedCover`/`resolveWithin`, so the win32 joins in `insideCache` and
`locateBoxArt` are inconsistent with the owner's own seam.

## Rung 2 — installed dependencies

Searched: Node `path` docs and the game provider tests.
Found: `path.win32.*` is a pure, platform-independent Windows syntax module;
it is right for parsing Windows-formatted strings but wrong for joining a root
the OS produced. No new dependency needed.

## Rung 3 — native platform

Searched: `node:path` (`win32`, `posix`, native default) and `node:fs/promises`.
Found: on Windows the native default is `path.win32`, so switching traversal
joins to native `path` is a no-op in the shipped product. On POSIX it emits
`/`, which is what `fs.realpath`/`readdir`/`stat` require.

## Rung 4 — public solutions

Searched: Node path-separator guidance and cross-platform filesystem practices
(`path.win32.join` on POSIX roots; `path.posix` vs native).
Found: the standard rule is parse foreign syntax with the matching module,
operate on local filesystem paths with the native module. Nothing more is
donated for this shape.

## Rung 5 — integration comparison

| Option | Fit | Unsolved work | Verdict |
|---|---|---|---|
| Native `path` for roots, `path.win32` for Windows strings | Correct on both | None | Chosen |
| All `path.posix` | Breaks the Windows product | Windows joins | Rejected |
| All `path.win32` | Status quo | POSIX tests and any non-Windows host | Rejected |

## Rung 6 — smallest probe

`node -e` compared `path.win32.join` and `path.join` on a POSIX temp root; the
win32 join produced backslashes and addressed no directory, the native join
stayed POSIX. Windows-formatted inputs (`D:\...`) keep `path.win32`.

## Decision

Use native `path` for filesystem traversal and for paths built from an
already-native root in `box-art.ts` and `steam-library.ts`. Keep `path.win32`
for explicitly Windows-formatted inputs: VDF/registry values, process
executable paths, and their normalisation in `uniquePaths`, `folded` and
`matchProcess`.
