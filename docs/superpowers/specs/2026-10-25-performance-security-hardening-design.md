# Performance and security hardening — design

- **Date:** 2026-10-25
- **Status:** active 2026-10-25.
- **Register:** no row yet. This is a requested audit and remediation, not a
  defect against one shipped behaviour. Every finding fixes here; new findings
  discovered during implementation join this plan rather than the register.
- **Related:** [`docs/product/requirements.md`](../../product/requirements.md)
  §47 (small display bundle), §101 (credentials and fetching), §111 (minimal PC
  overhead), §116 (where work happens), §122 (rates and slow clients), §124
  (pause when hidden), §139/§141 (packages and validation), §145 (hosting);
  [`docs/architecture/ownership.md`](../../architecture/ownership.md);
  [ADR-0010](../../adr/0010-one-active-plan.md).

## Purpose

A full performance and security audit of the shipped app found exploitable
defects and avoidable high-cost work in the host, player, editor and store
Worker. This design fixes **every finding**, and any new finding discovered
while implementing it is fixed in the same plan. Nothing is filed as backlog.

The outcomes:

1. A page on another origin cannot reach the host's loopback admin surface by
   DNS rebinding or a simple cross-site POST.
2. A theme package cannot become same-origin script in the host, read a file
   outside the theme folder, or stall the host with a crafted archive.
3. The player stops recomputing identical frames, stops working while hidden,
   and survives a back/forward-cache restore.
4. The host stops re-scanning the theme library on every display poll and stops
   buffering every asset to serve one.
5. The editor's undo and dirty tracking stop serialising the whole document
   several times per event; history is bounded.
6. The store bounds upload bytes before they land, accounts for pending uploads
   in quota, and cleans up abandoned ones.
7. Release and dependency surfaces stop carrying avoidable supply-chain risk.

## Threat model and budgets

In scope:

- A web page on another origin, including a name rebound to `127.0.0.1`.
- A malicious theme package or theme folder the user opens or imports.
- A user-configured remote HTTP source that redirects.
- A paired display token, including one read from a shared URL.
- An authenticated store account, and the public download surface.
- Performance on a low-end phone and on a host serving several displays.

Out of scope: a local administrator or malware running as the same user;
internet exposure of the host (requirements §145 forbids it); physical device
gates.

Budgets: the existing player bundle gate stays; no new runtime dependency is
added for a fix in this plan. A fix must remove work or bound a resource, not
move it behind a cache that can lie.

## Findings

Severity is the audit's, not a CVSS calculation. Each row is either **fix** in
this plan or **file** as a backlog row.

### Security

| # | Sev | Surface | Finding | Disposition |
|---|---|---|---|---|
| S1 | High | `host/src/server.ts` | Loopback admin routes check only the peer address. A rebound page (`Host: evil.example`, peer `127.0.0.1`) can mint a pairing token, enable LAN, register autostart, and write themes. | Fix |
| S2 | High | `server.ts:3214`, `serve/static-path.ts:33` | Theme asset MIME comes from the path extension. A package declaring `kind:"image", path:"assets/x.html"` becomes same-origin HTML with admin access. | Fix |
| S3 | High | `providers/custom/fetch-source.ts:119-168`, `:326` | Redirect hops may enter loopback/RFC1918/CGNAT. Only link-local and metadata are refused. | Fix |
| S4 | High | `store-worker/src/routes/me.ts:324-355`, `storage/presign.ts` | Presigned PUT is size-unbounded; a 5 GiB object per presign can be written and never finalized. Quota counts only finalized versions; no cleanup exists. | Fix |
| S5 | Medium | `theme-package/src/index.ts:138` | ZIP64 entry count is iterated by fflate with no abort; 128-entry cap does not bound the loop. | Fix |
| S6 | Medium | `host/src/themes/store.ts:834`, `:597`, `:972` | A save larger than the read cap becomes unlistable and unremovable. | Fix |
| S7 | Medium | `store.ts:763`, `thumbnails.ts:58` | Asset/thumbnail reads follow symlinks and junctions outside the theme folder. | Fix |
| S8 | Medium | `thumbnails.ts:20` | PNG validation is the signature only; no IHDR dimension bound. | Fix |
| S9 | Medium | `session/pairing-code.ts:87-112` | Concurrent correct claims all succeed; expiry is not re-read after the wait. | Fix |
| S10 | Medium | `server.ts:920`, `:4012` | Pre-handshake sockets have no timeout/cap; SSE keys and connections are unbounded. | Fix |
| S11 | Medium | `host/src/themes/import.ts:53` | Direct import bypasses the video envelope enforced on install/submit. | Fix |
| S12 | Medium | `server.ts:2903`, `:2998` | Wallpaper Engine listing and Videos exports are readable by any paired display. No player code uses them. | Fix |
| S13 | Medium | `store-worker/src/routes/me.ts:400-404`, `:529` | Finalize bodies are parsed before any cap; thumbnail base64 is decoded before its size check; item names are unbounded. | Fix |
| S14 | Medium | `store-worker/src/auth/owner.ts` | Owner check ignores `emailVerified`. | Fix |
| S15 | Medium | `server.ts:1021` | `YUNARI_STORE_ORIGIN` is unvalidated; a mis-set value receives the store bearer token. | Fix |
| S16 | Medium | `scripts/stage-npm-package.mjs:34-40` | Published manifest uses caret ranges, discarding lockfile integrity. | Fix |
| S17 | Medium | `.github/workflows/publish.yml` | Install scripts run with `contents:write` + `id-token:write`, checkout persists credentials, and a non-tag `workflow_dispatch` can publish. | Fix |
| S18 | Medium | `store-worker/node_modules/zod@4.4.3` | Production advisory misclassified as dev-only in the audit allowlist. | Fix |
| S19 | Low | `settings/credentials.ts:96` | Credentials, store token and CA key are plaintext; Windows ignores mode 0600. | Fix |
| S20 | Low | `cli/net.ts` / `main.ts:523` | CA bootstrap over plain HTTP permits root substitution; display token lives in the URL. | Fix |
| S21 | Low | `fetch-source.ts:155` | DNS rebinding TOCTOU between validation and fetch. | Fix |
| S22 | Low | `server.ts:2715` | `/api/health` is unauthenticated and exposes polled keys. | Fix |
| S23 | Low | `serve/static-path.ts:66` | Bundle static serving is lexical only; a symlink in `dist` escapes. | Fix |
| S24 | Low | `server.ts:676` | 96 MiB bodies are fully buffered with no concurrency cap. | Fix |
| S25 | Low | `server.ts:1627` | Admin error bodies echo filesystem paths. | Fix |
| S26 | Low | `store-worker/src/index.ts:53` | `/migrate` token compare is not constant-time. | Fix (cheap) |
| S27 | Low | `store-worker` | `TEST_MODE` would enable test auth in a deployed Worker if set. | Fix (refuse in production) |
| S28 | Low | `scripts/stage-npm-package.mjs` | `ffmpeg-static` downloads an unhashed binary at install. | Fix |
| S29 | Low | `THIRD-PARTY-NOTICES.md` | Names are checked, versions/licences are not. | Fix |
| S30 | Low | `src/web/package.json` overrides | `sharp`/`undici` overrides leave `npm ls` invalid. | Fix |

### Performance

| # | Sev | Surface | Finding | Disposition |
|---|---|---|---|---|
| P1 | High | `player/src/main.ts:418`, `:259-300` | Every chart, bound text, image and notice is rebuilt at 30 Hz; gauge/bar/pie options are identical 29 of 30 frames. | Fix |
| P2 | High | `scene-fabric/src/chart-refresh.ts:50` | RAF is re-armed before the cadence check; a 1 fps display still wakes at 60 Hz. `vg-579`. | Fix |
| P3 | High | `player/src/main.ts:433` | No `visibilitychange`; a hidden phone keeps the stream, ingest and video running (§124). `pagehide` disposes permanently, so bfcache restore is dead. `vg-540`. | Fix |
| P4 | High | `host/src/server.ts:2055` | `/api/published` lists, reads, validates and hashes every theme every 2 s per display. | Fix |
| P5 | High | `server.ts:3199` → `store.ts:740` | Serving one asset reads and copies every asset in the theme; the document route does the same. | Fix |
| P6 | High | `host/src/providers/library.ts:940` | Six `systeminformation` families run regardless of the bound keys; GPU discovery repeats per assignment group. | Fix |
| P7 | High | `editor/src/history-manager/index.ts:80`, `:188` | Undo history is unbounded; every save stringifies both whole scenes; every Fabric event triggers several whole-document snapshots. | Fix |
| P8 | Medium | `server.ts:4152` | Sampling ticks overlap when a provider exceeds the interval. | Fix |
| P9 | Medium | `server.ts:1058` | 4–5 settings-file reads per display per tick. | Fix (devices once per tick) |
| P10 | Medium | `player/src/publish-follower.ts:199` | Overlapping polls and a timer left running after a permanent refusal. | Fix |
| P11 | Medium | `player/src/main.ts:431` | Resize refits with no size dedupe; Fabric resets the bitmap. | Fix |
| P12 | Medium | `editor` | Notifications from a revive are O(N); layer rows rebuild per event. | Fix (coalescing) |
| P13 | Medium | `renderer-core/src/data/store.ts:63`, `charts/line.ts:165` | History filtering parses every timestamp per frame; line points rebuild each frame. | Fix |
| P14 | Medium | `store-worker/src/routes/me.ts:125`, `admin.ts:103` | N+1 queries in author/admin listings. | Fix |
| P15 | Medium | `store-worker/src/routes/public.ts:66` | Public index rebuilds the whole catalogue per cache miss; no pagination/cache. | Fix |
| P16 | Medium | `host/src/tray/external-apps.ts:223` | LHM full sensor tree fetched every 5 s; sync `existsSync` probes each poll. | Fix |
| P17 | Medium | `editor/src/image-manager/index.ts:73` | Full-resolution decode and downscale on the main thread. | Fix |
| P18 | Medium | `store-worker/src/storage/objects.ts:12` | Finalize materializes up to 95 MiB to hash. | Fix |
| P19 | Low | `host/src/server.ts:847` | Static bundles served without validators. | Fix |
| P20 | Low | `host/src/providers/weather/provider.ts:180` | Weather settings re-read per sample. | Fix |
| P21 | Low | `host/src/transport/sse.ts:34` | SSE frame formatting repeated per connection and while backpressured. | Fix |
| P22 | Low | `player/src/main.ts:299` | Availability notice allocated every frame. | Fix (revision gate) |
| P23 | Low | `scene-fabric/src/background-media.ts:160` | Video frame callback loops with no glass surface to feed. | Fix |

## Design

### A — Host request boundary

**One pre-dispatch guard.** After the URL is parsed and before any route, a
request from a loopback peer whose `Host` is not a loopback name is refused for
`/api/*`, except `/api/host` (the documented cross-origin discovery route).
`isForeignOrigin` already encodes the rule; it is applied once instead of being
remembered per route.

- Applies to `GET` as well as writes: `/api/pairing/code` and
  `/api/published` are reads with side effects.
- LAN peers are unaffected: the guard only runs for a loopback peer, and a LAN
  client cannot present `Host: evil.example` while reaching loopback.
- `localhost`, `127.x`, `[::1]` and an agreeing `Origin` stay accepted.
- `/settings` and `/editor` HTML are not `/api/*`; they keep serving. Script in
  them cannot be injected by a theme after S2.

**Theme assets.** The declared asset kind owns the response type:

| kind | extensions | response type |
|---|---|---|
| `image` | `.png`, `.jpg`, `.jpeg`, `.webp`, `.avif` | matching image type |
| `svg` | `.svg` | `image/svg+xml` |
| `gif` | `.gif` | `image/gif` |
| `video` | `.mp4`, `.webm` | matching video type |
| `font` | `.woff2` | `font/woff2` |

A kind/extension mismatch is refused by validation and again by the route. No
theme asset is ever `text/html`, `text/javascript`, `text/css` or
`application/json`. Asset responses add `X-Content-Type-Options: nosniff` and
`Content-Security-Policy: sandbox; default-src 'none'` so a directly navigated
SVG cannot script the host origin. `/api/themes/import` gains the same
`isForeignOrigin` check as `install` and `normalize-video`.

**Wallpaper Engine.** Its listing, item bytes, export listing and export bytes
move behind `isLoopbackRemote`. They are editor-only; no player or
`scene-fabric` code references them.

**Pairing.** A claim re-reads `current()` after its penalty wait, and consumes
the code compare-and-clear; concurrent correct claims yield exactly one
success. Expiry is checked on the far side of the wait.

**Sockets and streams.** The port listener sets a 5 s timeout on an accepted
socket until the first byte and destroys it on timeout; `maxConnections` is
bounded. SSE refuses more than 64 keys per connection (128 bytes each) and more
than 64 connections total, with a per-display cap of 8. A refusal is a 400/429
before the stream opens.

**Video envelope.** `importThemePackage` runs `themeVideoRefusals` itself, so
every import path enforces the same MP4/WebM envelope as install and submit.

### B — Untrusted files and outbound fetches

**ZIP preflight.** `readThemePackage` parses the EOCD (and ZIP64 locator/EOCD
when present) before calling `unzipSync`. It refuses a declared entry count
above 128 or a central-directory span above 8 MiB. fflate then iterates at most
the accepted count. Tests craft a ZIP64 whose count is huge and assert refusal
without a long loop.

**Write-side size.** `ThemeStore.write` refuses a serialized `theme.json` above
`MAX_THEME_FILE_BYTES` before creating the staging folder, so a theme the store
would refuse to read is never written.

**Containment.** Asset and thumbnail reads resolve `realpath` for the theme
folder and the target and refuse a target outside the folder or a theme folder
that is itself a link. `lstat` refusal is the first check; realpath is the
second.

**PNG.** Thumbnails parse IHDR and refuse width/height outside 1..4096 or an
area above 16 Mi pixels. The test fixture becomes a real 1×1 PNG.

**Redirects.** The first URL keeps the current policy: a user may type a
loopback or LAN address. Any redirect hop must not resolve to a private,
loopback, CGNAT, link-local or unspecified address when the first URL did not.
IPv4-mapped, NAT64, 6to4 and Teredo forms are decoded before the range test.

**Pinned resolution.** The default fetcher becomes a small undici `Agent`
whose `connect.lookup` resolves once, applies the address policy, and returns
the checked address for the connection itself. This closes the DNS-rebinding
gap between the validation lookup and the connection; redirects repeat the
policy on each hop with a fresh pin. The injected `fetch` seam stays for tests.

### C — Player

**One revision, one gate.** `SampleStore` and `SampleSource` gain a monotonic
`revision` incremented on ingest and reset. The player remembers the revision it
last rendered:

- Gauge, bar, pie, images, bound text and the availability notice run only when
  the revision moved. Their options and strings do not depend on the frame
  clock.
- Line charts keep their per-frame rebuild: the visible window moves with
  `nowMs` and that is the authored `chartFps` presentation. Their ECharts
  update switches from a full model teardown to a merge with
  `replaceMerge: ["series"]`, which replaces series without discarding the
  chart instance; the rendered result is verified in a browser.
- `requestRenderAll` runs only when at least one object changed or a line chart
  was refreshed.

**Cadence.** `startChartRefresh` schedules the next wake at the due time. At 30
fps it keeps the RAF loop; at 1 fps it uses a timer to the next due second and
requests one frame then. Re-arm happens after the due check, so a skipped frame
costs no callback.

**Hidden and restored.** `visibilitychange` stops the refresh loop and pauses
the video background while hidden, and restarts on visible. The stream stays
open: the host's sampling is shared, and one 1 Hz connection is not the cost
§124 is about. `pageshow` with `persisted` reloads the page, replacing the
permanent `pagehide` disposal that left a restored display dead.

**Resize.** `SceneHandle.resize` returns early when the viewport pixel size is
unchanged.

**Follower.** The publish poll chains the next `setTimeout` after the current
request settles, and clears it on refusal, so a slow host cannot accumulate
requests and a refused display stops waking.

### D — Host IO

**Store reads by need.**

- `readEnvelope(id)` reads and validates `theme.json` only; it does not hash.
- `readAsset(id, path)` reads `theme.json`, checks the path is declared, then
  reads exactly that one file under the declared-asset size cap.
- `exists(id)` is `readEnvelope(id) !== undefined`.
- `list()` uses `readEnvelope`, so it stops hashing every theme.
- `snapshot`/save-conflict paths keep the content id they need.

`/api/published` uses `exists` for the assigned id instead of listing the
library. The asset route uses `readAsset`; the document route and the publish
check use `readEnvelope`.

**Provider acquisition.** `LibraryProvider.sample` gates each of
`currentLoad`, `cpuCurrentSpeed`, `mem`, `fsSize`, `networkStats` and `graphics`
on the key families in `owned`, the way the later reads already are. A sample
that binds only `cpu.load` does not enumerate disks or discover GPUs.

**Ticks.** A tick that is still running causes the next interval to be skipped
(single-flight), and each tick reads the device settings once and shares that
value across displays. It never reorders batches: only one tick is in flight.

### E — Editor

**One change, one notification.** `EditorDocument.announceChange` coalesces
listeners into one microtask. The bridge, save-state, document identity and
publish control all see one notification per batch of Fabric events, including
the `object:removed`/`object:added` storm a revive emits. A restore still
suspends history saves, so the coalesced notification cannot record an entry.

**Dirty by revision.** The document keeps a revision incremented by
`announceChange`; `isDirty()` memoises its snapshot/key per revision. Two
subscribers asking the same revision share one computation.

**Bounded history.** History keeps at most 100 entries; the oldest drops when
the cap is exceeded. Each entry stores the fingerprint string computed once at
capture (scene + globals), and `save()` compares fingerprints instead of
stringifying both entries. Undo/redo still restores the same scene/globals.

**No publish work while idle.** `publish-control` computes its document only
while a publish is in progress.

### F — Store uploads

**Proxied upload.** The version request returns
`uploadUrl = <store-origin>/api/me/uploads/<uploadId>`. The host `PUT`s the
package bytes to that authenticated route with an explicit `Content-Length`.
The Worker:

1. refuses a missing or non-numeric length, or a length above 95 MiB, before
   reading the body;
2. streams `request.body` to `BUCKET.put(pendingKey, body)`;
3. records the object's actual size and refuses a mismatch;
4. leaves the object under `pending/<uploadId>.zip` until finalize.

The upload row is created before the write and carries `reserved_bytes =
MAX_ARCHIVE_BYTES`. Finalize replaces the reservation with the actual size and
stores the pending key in `item_version.package_key`; downloads read that
column. This removes the R2 S3 credentials and `presignPut`.

**Quota.** `authorQuotaExceeded` counts finalized bytes plus unexpired pending
reservations, so concurrent uploads cannot exceed the 1 GiB author cap. Pending
reservations expire after the upload TTL (15 minutes).

**Cleanup.** A scheduled Worker runs every 15 minutes: it deletes pending
objects whose upload row is unfinalized and older than one hour, and prunes
upload rows older than seven days. A package that was never finalized can
therefore hold at most its reserved bytes for one hour, and the reservation
already counts against quota.

**Worker input.** JSON bodies are capped before parse; the thumbnail's base64
length is checked before `atob`; an item name is capped at 200 bytes; the
envelope is capped at the existing theme-file bound. `/migrate` compares the
token in constant time. Owner checks require `emailVerified`. `TEST_MODE` is
refused when `BETTER_AUTH_URL` is not a test origin. `YUNARI_STORE_ORIGIN` is
parsed, must be `https:`, and must match the compiled catalogue origin except
for an explicit loopback test origin.

### G — Supply chain and release

- The staged npm manifest writes exact versions, not carets.
- The publish workflow sets `persist-credentials: false`, splits install/gate
  from publish so `id-token: write` belongs only to the publish job, and refuses
  a non-dry `workflow_dispatch` unless `github.ref` starts with `refs/tags/v`.
- The audit allowlist stops claiming `zod@4.4.3` is dev-only; an override to
  `>=4.6.6` is added and the Worker suite proves it.
- Every GitHub action is pinned to its resolved commit SHA.
- `ffmpeg-static`'s downloaded binary is verified against a committed SHA-256
  manifest for each supported platform before the host can execute it.
- `THIRD-PARTY-NOTICES.md` is generated/checked from installed package metadata
  for names, versions and licences, and the check runs in the gate.
- The `npm ls` tree must be valid; the overrides are re-resolved or replaced so
  `npm ls --all` exits 0.

### H — Secrets, sessions and the remaining host surfaces

**Encrypted at rest.** A new `settings/secret-store.ts` owns one random 32-byte
data key per app folder. The key is wrapped by the OS — DPAPI `CurrentUser` on
Windows, `secret-tool` on Linux — and the wrapped key lives in `secret.key`.
Credentials, the store session, literal secret fields in `sources.json`, and
the CA private key are encrypted with AES-256-GCM using that key. There is no
plaintext fallback: when the OS protector is unavailable, the store refuses to
save a secret and says why. A legacy plaintext file is encrypted and removed on
first read. Writes remain atomic and mode 0600 where the OS honours it.

**Session cookie.** After pairing, the pair page posts the token to
`POST /api/session`, which sets
`HttpOnly; SameSite=Strict; Path=/` (and `Secure` on TLS) and redirects to the
display URL without the token. Subsequent API and SSE requests authenticate
from the cookie; the session header stays for the host's own tooling. A
`?session=` value on the root path is accepted once, turned into a cookie and
removed with a 302; every other route refuses a query token. `withToken` stops
appending the token to asset and stream URLs.

**TLS bootstrap.** The host prints the CA certificate's SHA-256 fingerprint in
the terminal and serves it on the certificate route as a header. The pairing
instructions require the user to compare the two before installing the root.
Plain HTTP remains for the install step; the fingerprint is the out-of-band
anchor.

**Health, bodies, errors.** `/api/health` answers a static liveness object to a
LAN caller and the detailed object only on loopback. Large bodies (theme
upload, normalize) run through a one-at-a-time semaphore and answer 429 rather
than buffering a second 96 MiB request. Admin write failures answer fixed
messages; diagnostic detail goes to stderr, never into the HTTP body.

**Static bundles and symlinks.** Static serving resolves the real path of the
candidate and refuses it when it leaves the bundle root or is a link; bundle
responses carry an `ETag` derived from the file's size and mtime and answer
`304` on `If-None-Match`.

### I — Remaining performance work

**History.** `SampleStore` keeps a numeric timestamp beside each sample and
serves a window with a binary search instead of `Date.parse` over the whole
list. Line point building is cached per sample revision and settings, so a
frame that only slides the window reuses the points and filters by time.

**Store listings.** The author list and admin queue use one joined query for
the latest version and one join for author email. `/index.json` is served from
the Cache API for its existing window, so a cache hit does no D1 work.

**Tray.** The LHM probe uses `Range: 0-0` (or `HEAD`), cancels the body, caches
the answer for the process-probe window, and uses async path checks.

**Editor import.** Image import uses `createImageBitmap` with resize options
and `OffscreenCanvas` when available, falling back to the existing element path.

**Weather.** The weather settings read is cached by file mtime.

**SSE.** One SSE frame is formatted per payload and shared by every connection
in the group; a connection waiting for drain skips formatting.

**Video.** The background media layer keeps a glass-surface count and starts no
video frame callback when the count is zero.

## Decision notes required

The reuse gate refuses the first write to these watchlisted paths until a note
claims them:

- `docs/decisions/0116-loopback-admin-requests-are-same-origin.md` —
  `host/src/server.ts`, `host/src/serve/static-path.ts`, `providers/`.
- `docs/decisions/0117-chart-repaint-is-sample-driven.md` —
  `scene-fabric/src/chart-refresh.ts`, `scene-fabric/src/chart-object.ts`,
  `renderer-core/src/charts/`, `renderer-core/src/data/`.
- `docs/decisions/0118-the-store-upload-is-proxied.md` — the store upload
  protocol (no watchlist path, but the choice is architectural).
- `docs/decisions/0119-provenance-checks-own-the-supply-chain.md` —
  `scripts/`.
- `docs/decisions/0120-secrets-are-encrypted-at-rest.md` — the secret store
  (no watchlist path, but the choice is architectural).

If an editor-watchlisted file (`editor-session.ts`, `editor-shell/bridge.ts`)
needs a signature change for coalescing, 0116's note is extended to claim it
before that write.

## Verification

Per phase:

- A regression test that fails when the fix is removed. Security guards are
  tested with the hostile shape (foreign `Host`/`Origin`, HTML asset, ZIP64
  count, symlink/junction, redirect to `127.0.0.1`, oversized upload).
- Player refresh tests count work skipped, not only output produced; a fake
  `requestAnimationFrame` asserts one refresh per second at rate 1.
- Visible player changes (chart cadence, hidden pause, bfcache restore) get a
  browser check against the built bundle; no golden screenshots.
- Editor tests drive a real revive and assert one notification and a bounded
  history; a 200-object undo must not produce O(N²) notifications.
- Store tests cover hard size refusal before write, quota reservation, cleanup,
  and a finalize/download round trip through `package_key`.

At the milestone: `npm run gate` from `src/web/`, plus the Worker suite and the
focused Playwright specs. The final commit records the exact commands and exit
codes.

## Risks and mitigations

- **Central origin guard breaks a legitimate local surface.** Tests cover
  `localhost`, `127.0.0.1`, `[::1]`, an agreeing Origin, a foreign Origin, a
  foreign Host, and a LAN peer. `/api/host` is the one explicit exemption.
- **Proxy upload changes the store protocol.** The host client and Worker land
  together; the finalize/download test covers the new key. Author uploads are
  the only caller.
- **Revision gate freezes something that depends on wall time.** Line charts,
  the clock provider and the availability strip are explicitly covered by tests;
  only families proven independent of `nowMs` are gated.
- **Editor coalescing changes React timing.** The existing DOM tests assert the
  rendered state; the notification count is asserted separately.

## No backlog filing

The user's ruling on 2026-10-25 is **fix all, file none**. A finding that
appears while implementing this plan is fixed in the same phase and recorded
in the commit, not deferred to `docs/product/backlog.jsonl`. If a fix turns out
to need a decision outside this plan, the plan stops and asks rather than
silently filing a row.
