# 0059 — the display's shell cache is keyed by the build it holds

- **Date:** 2026-11-01
- **Status:** accepted
- **Paths:** `src/web/packages/player/public/sw.js`
- **Paths:** `src/web/packages/player/src/service-worker-script.test.ts`

## Problem

`packages/player/public/sw.js` named its cache `yunari-shell-v2` and cached
every `/assets/**` response under it. `activate` deleted only *differently
named* `yunari-*` caches, so nothing ever removed a build's content-hashed
bundles: a display redeployed over months accumulated every bundle it had
served (issue #130, `vg-589`). The only eviction was renaming the constant by
hand, and no trigger was tied to it.

## Rung 1 — internal owner

`sw.js` is the only writer of a cache on this origin: `service-worker.ts`
registers it, the host's bundle-asset allowlist (`host/src/server.ts`) serves it
ungated, and `service-worker-script.test.ts` runs the real file against a fake
`self`/`caches`. No second cache owner exists to extend, and the host does not
touch the Cache API.

## Rung 2 — installed dependencies

None apply. The player carries `renderer-core`/`scene-fabric` only, and the
worker is plain JavaScript copied verbatim from `public/` — no Vite transform,
`define`, or build hash reaches it. Any build-time version would need a new
generation step or a host rewrite of `/sw.js`.

## Rung 3 — native platform

The Cache API is the platform's own answer: `caches.keys()`, `caches.open(name)`
and `caches.delete(name)` are enough to name a cache per build and drop the
others. There is no native cache-size limit or eviction the browser exposes to a
site, so the worker has to do the eviction.

## Rung 4 — public solutions

Read Workbox's current source (`/googlechrome/workbox`, v7:
`PrecacheController.install/activate`, `cleanupOutdatedCaches` in
`workbox-build`'s `sw-template.ts`). Workbox precaches against a build-generated
revision manifest and, on activate, deletes cached entries not in that manifest;
`cleanupOutdatedCaches()` additionally deletes *old caches* whose names match
its own prefix and that its manifest says are superseded. It never evicts by age
or count unless `ExpirationPlugin` is configured. The shape — identify the
current build, delete everything else — is the same; what Yunari lacks is the
build-time manifest, since the worker is copied verbatim.

## Rung 5 — integration comparison

| Option | Fit | Unsolved work | Verdict |
|---|---|---|---|
| Name the cache from the document's own bytes; adopt it at install and on every navigation; delete the other `yunari-shell-` caches | No build step, no host change, works with the verbatim worker | A hash function and a rotation path in `sw.js` | Chosen |
| Version constant bumped by hand or by a release script | Simple | Nothing ties the bump to a build; the defect returns the first time it is forgotten | Rejected |
| Generate `sw.js` at build time with a manifest | Workbox's shape | A new generation step and a host/`public/` change for one file | Rejected (not earned) |
| Bound entries by count or age | No build identity needed | Bounds a cache whose entries are all live assets of the running build | Rejected by the ruling on #130 |

The package version cannot key this: two builds of one version are exactly the
redeploy a display goes through, and their asset names differ.

## Rung 6 — smallest probe

The document is served `no-store` and names the build's content-hashed assets,
so a built change is a changed document. `service-worker-script.test.ts` runs
the real file and was red-proofed by making `dropOtherShells` delete nothing:
the activation case and the rotation case both fail, and pass again once the
deletion is restored (`cmp`-identical).

## Decision

`sw.js` derives the cache name from the document (FNV-1a over its bytes),
adopts it at `install` and again on every navigation, and deletes every other
`yunari-shell-` cache when the name changes. `activate` deletes every shell
cache but the current one, which also clears the fixed-name caches older builds
wrote. Rotation on navigation is required because the worker script usually
does not change between builds, so `install` may never run again.
