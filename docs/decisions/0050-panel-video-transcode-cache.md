# 0050 — A panel clip is cached by content and written atomically

- **Date:** 2026-10-31
- **Status:** accepted
- **Paths:**
  - `src/web/packages/host/src/panels/turzx-video.ts`
  - `src/web/packages/host/src/panels/turzx-panel.ts`
  - `src/web/packages/host/src/panels/panel-device.ts`
  - `src/web/packages/host/src/panels/panel-manager.ts`
  - `src/web/packages/host/src/main.ts`

## Problem

`transcodeForPanel` re-encodes a theme's background clip whenever the run cannot
find a cached output, and the output is written straight to its final cache
path. A write interrupted mid-file leaves a truncated MP4 at that path, and the
next run treats it as a hit and uploads a clip the panel cannot decode. The cache
also lives under `os.tmpdir()`, so temp cleanup throws away work the host could
keep, and nothing bounds the directory: theme clips are several megabytes each
and a library can hold many.

## Rung 1 — internal owner

Searched: CodeGraph/Read for `transcodeForPanel`, `cached`, `TRANSCODE_VERSION`,
`startVideo`, `fileSize`, `videoFor`, `panelCacheDir`; read `turzx-video.ts`,
`turzx-panel.ts`, `panel-manager.ts`, `main.ts`,
`providers/media/artwork.ts`, `providers/game/store-metadata.ts`.
Found: `turzx-video.ts` already owns the transcode, its content+placement key
and the version tag. `providers/media/artwork.ts` is the repo's atomic
content-addressed cache: it writes `.name.pid.n.tmp` beside the target, renames,
sweeps stale scratch and keeps a count cap. `store-metadata.ts` does the same
for cover bytes. Neither bounds by bytes, and neither is reusable as-is because
the panel output is keyed by the *source* bytes, not by its own digest. The host
already keeps disposable caches under `path.dirname(settingsDir)/cache/<name>`
in `main.ts` (media artwork, game metadata, wallpaper-engine).

## Rung 2 — installed dependencies

Searched: host `package.json`, workspace `node_modules` for `write-file-atomic`,
`proper-lockfile`, `diskcache`; read `artwork.ts` and `store-metadata.ts`.
Found: no atomic-write or cache dependency is installed, and the host keeps its
runtime dependency list deliberately small. Node's `node:fs/promises` supplies
`open`, `handle.sync`, `rename` and `unlink`, which is the whole mechanism.

## Rung 3 — native platform

Searched: Node fs docs (`fs.rename`, `fs.fsync`), POSIX `rename(2)`.
Found: `rename(2)` replaces the destination and is atomic within one filesystem;
`fsync` before the rename makes the bytes durable. The platform leaves eviction
and key naming to the caller. `rename` across devices fails with `EXDEV`, so the
scratch file is written in the same directory as its target.

## Rung 4 — public solutions

Searched: Node fs API pages; `npm/write-file-atomic` README; POSIX `rename(2)`
man page; `python-diskcache` API docs. Network web search was unavailable in
this session, so these were fetched directly.
Found: `write-file-atomic` writes a scratch file and renames it after an fsync;
`diskcache` exposes a byte `size_limit` and an eviction policy (default
least-recently-stored, with least-recently-used available). Both confirm the
shape: content-addressed names, scratch+rename, a byte bound with eviction by
last use. Neither solves the panel's specific need to skip an upload.

## Rung 5 — integration comparison

| Option | Fit | Unsolved work | Verdict |
|---|---|---|---|
| `write-file-atomic` | Correct scratch+rename+fsync | New runtime dependency; still no eviction or panel upload check | reject |
| Reuse `providers/media/artwork.ts` | Atomic writes and stale-scratch sweep exist | Keyed by output digest; count cap only; caching a whole clip under an image cache owner couples two mechanisms | reject |
| Extend `turzx-video.ts` in place | Owns the transcode, key and version tag | Add cache directory, atomic write, byte-bound eviction | accept |
| No cache, re-encode each start | Simple | Minutes of ffmpeg and a multi-megabyte serial upload per theme save | reject |

## Rung 6 — smallest probe

`node -e` probe over a temp directory: write a scratch file, `fsync`, rename over
the target, then confirm a pre-existing `.tmp` with garbage is ignored by a
lookup that only reads the final name. Confirms the platform filesystem supplies
the atomicity the cache relies on; no timing claim is made about a power cut.

## Decision

Extend `turzx-video.ts`: key the cache by the source clip's SHA-256 plus the
authored placement and the `TRANSCODE_VERSION` settings tag; write the encoded
bytes to a same-directory scratch file, `fsync`, then rename; bound the directory
at 256 MiB and evict least-recently-used `.mp4` entries after each write (a hit
bumps its mtime). The host passes
`path.dirname(settingsDir)/cache/panel-video` through the panel manager to the
driver, so the cache survives temp cleanup and never sits in the theme library.
The adapter keeps its existing upload skip: the remote name is the output hash,
and a `GET_FILE_SIZE` equal to the encoded length means the panel already holds
that exact file, so no bytes go down the wire.
