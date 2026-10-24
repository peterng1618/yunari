# 0104 — Media artwork is a small content-addressed file cache the host owns

- **Date:** 2026-10-24
- **Status:** accepted
- **Paths:** `src/web/packages/host/src/providers/media/provider.ts`,
  `src/web/packages/host/src/providers/media/artwork.ts`,
  `src/web/packages/host/src/server.ts`

Decision 0103 owns the helper that reads artwork bytes; this note owns what
happens to those bytes.

## The problem

A display binds `media.artwork`, so the host must hand a browser a URL it can
cache forever and re-fetch only when the track changes. The requirements are
sharp: names must be unforgeable (`<64 hex>.<png|jpg|jpeg|webp>`), a name must
never address a neighbouring file, the same bytes must land on the same name
whatever the track, eviction must bound disk, a replaced or truncated file must
not be served under the old digest, and a lone host process must not accumulate
runtime state in a theme or settings file. That is sampling, ordering,
invalidation, disposal and ownership — the shape the reuse gate asks about.

## Rung 1 — Yunari

Searched: `packages/host/src/` for `sha256`, content-addressed storage and
atomic writes; `themes/store.ts`, `themes/wire.ts`, `assets/routes.ts`,
`themes/thumbnails.ts`.

Found: the theme store hashes a document (`store.ts` `documentDigest`) and
verifies declared asset digests, but it stores a theme, not a mutable runtime
picture. `thumbnails.ts` writes one fixed file inside a theme folder and has no
eviction. `assets/routes.ts` serves theme bytes through the display gate but has
no cache of its own. Nothing to reuse; the gate's second half — integration —
was undone.

## Rung 2 — dependencies

Searched: every `package.json`, `package-lock.json` for cache packages.

Found: no declared cache dependency. `lru-cache` 10.4.3 (ISC) exists only as a
transitive of `@asamuzakjp/css-color`; it is in-memory and cannot serve a URL
after a restart. `cacache` is not installed.

## Rung 3 — platform

Searched: Node `node:fs` (`mkdirSync`, `writeFileSync`, `renameSync`,
`readdirSync`, `statSync`, `unlinkSync`), `node:crypto` `createHash`.

Found: everything the job needs, including atomic publish by writing a scratch
name and renaming. No native content-addressed store exists in Node; the
filesystem is the primitive.

## Rung 4 — ecosystem

Searched: `npm view cacache|lru-cache|keyv|cache-manager|file-entry-cache`
(version and licence); npm search terms `content addressed disk cache node`,
`http immutable asset cache node`.

Found:

- `cacache` 21.0.1 (ISC) is npm's own content-addressed disk cache with
  integrity verification and size-based eviction. It brings its own directory
  layout, index metadata and a dependency tree, and its entry naming is not the
  route's `<sha>.<ext>` — the host would still own a mapping layer and the
  route's regex.
- `lru-cache` 11.5.3 (BlueOak-1.0.0) and `keyv` 6.1.0 (MIT) are in-memory or
  storage-agnostic caches: neither writes a file a browser can fetch.
- `cache-manager` 7.2.9 (MIT) is the same shape one level up.
- `file-entry-cache` 11.1.5 (MIT) tracks file mtimes for lint runs, not blobs.

Nobody in this ecosystem solves the exact shape — an immutable, digest-named,
count-capped file whose name *is* the integrity check — without also imposing a
layout and an index that the host would have to translate back into that name.
The sampling/invalidation decisions stay ours either way.

## Rung 5 — comparison

| Option | Fit | Cost | Risk | Verdict |
|---|---|---|---|---|
| `cacache` | Disk content cache with integrity | New dependency tree; own layout; name mapping layer | Translating its index back to `<sha>.<ext>` is the work, not saved | Rejected |
| `lru-cache` / `keyv` / `cache-manager` | In-memory or pluggable | No files to serve | Cannot back a URL | Rejected |
| `node:fs` + `node:crypto` | Exact names, rename-publish, count eviction | ~90 lines | Windows rename semantics (verified: libuv replaces) | **Chosen** |

## Rung 6 — probe

The helper's real artwork line (probe recorded in 0103) carried a 23,558-byte
PNG with a stable SHA-256. The cache's own tests put the same bytes twice and
observe one file and one URL, put `cap + 1` distinct images and observe the
oldest evicted by mtime, and read a name whose file was replaced with different
bytes and observe `undefined` rather than the wrong picture.

## Decision

The host writes artwork as `<sha256-of-bytes>.<sniffed ext>` files in one
directory it is given (the launcher passes the app folder; tests pass a temp
directory), publishes by rename, and keeps the newest 64. The server serves a
name only when it matches `^[0-9a-f]{64}\.(png|jpg|jpeg|webp)$` and the file's
hash still matches it, behind the same display credential as theme asset bytes,
with `Cache-Control: immutable`. `cacache` is not adopted because its index and
layout do not remove this host's decisions — they add a translation layer in
front of a route whose whole contract is the file name.
