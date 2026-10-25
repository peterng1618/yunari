# Performance and security hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix every finding from the 2026-10-25 performance/security audit, plus anything discovered while implementing, with a regression test per fix.

**Architecture:** Harden the host's request boundary once, then each untrusted-input path; make the player and host do work only when state changes; bound editor history and coalesce its notifications; replace the store's presigned upload with an authenticated, size-bounded proxy upload and a cleanup cron; encrypt secrets with an OS-wrapped key; close supply-chain gaps in release and dependencies.

**Tech Stack:** TypeScript/Node 22+, Fabric 7.4, ECharts 6, React 19, Vitest, Playwright, Cloudflare Workers + D1 + R2, undici, aws4fetch, fflate.

**Spec:** [`docs/superpowers/specs/2026-10-25-performance-security-hardening-design.md`](../specs/2026-10-25-performance-security-hardening-design.md)

## Global Constraints

- **Fix all; file none.** Every finding in the spec is implemented. A new finding discovered during a task is fixed in that task or a new task added to this plan before the phase closes.
- No new runtime dependency except `undici` (already in the tree) for DNS pinning. Any other dependency needs a decision note and licence update.
- All five decision notes `0116`–`0120` land before the first write to their claimed paths.
- Every regression test must fail when its fix is disabled. Record the red proof in the task's commit body.
- Run from `src/web/` unless a step says otherwise. Use explicit `git add` paths; never `git add -A`.
- Keep `STATUS.md` current at each phase boundary; `npm run status:check` must exit 0.
- Visible player changes need a built-bundle browser check, not only unit tests.
- Commit bodies cite symbols, not line numbers, and end with:
  `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`

## Review Focus

1. **Every legitimate loopback surface still works:** editor at `localhost`, `127.0.0.1` and `[::1]`, the `/api/host` sweep, a LAN phone, and the store sign-in return. Each phase-1 change has a positive test beside its hostile one.
2. **A valid theme at the limits still works:** a 95 MiB package, many assets, one video, and a package with a real 1×1 PNG thumbnail import, list, play and delete after hardening.
3. **Player cadence stays honest:** at 30 fps line charts slide; at 1 fps only one refresh per second runs; a missing sample still shows a gap and a clock still advances.
4. **The store author flow survives the protocol change:** sign in → version request → authenticated upload → finalize → public download → quota and cleanup all agree.
5. **Secrets survive restart and migration:** legacy plaintext files become encrypted, a wrong OS key refuses rather than silently returning empty, and the host starts with no secret unreadable.

---

## Phase 0 — Baseline and guardrails

### Task 0.1: Record the baseline

**Files:**
- Create: `.superpowers/sdd/2026-10-25-performance-security-hardening/baseline.md`

**Interfaces:**
- Consumes: none.
- Produces: baseline exit codes and failing-case names used by later red proofs.

- [ ] **Step 1: Run the full gate**

Run: `npm run gate` in `src/web/`
Expected: exit 0. Record the command, exit code, test counts and skipped count in `baseline.md`.

- [ ] **Step 2: Run the Worker suite**

Run: `npm run test:worker` in `src/web/`
Expected: exit 0. Record the count.

- [ ] **Step 3: Run the focused security and player specs**

Run: `npx playwright test tests/e2e/game-metadata.spec.ts tests/e2e/editor-deep-links.spec.ts --workers=1`
Expected: exit 0. Record which specs ran; these are the smoke set for later phases.

- [ ] **Step 4: Commit the baseline note**

```bash
git add .superpowers/sdd/2026-10-25-performance-security-hardening/baseline.md
git commit -m "chore: record the hardening baseline"
```

### Task 0.2: Land the decision notes and switch the active plan

**Files:**
- Create: `docs/decisions/0116-loopback-admin-requests-are-same-origin.md`
- Create: `docs/decisions/0117-chart-repaint-is-sample-driven.md`
- Create: `docs/decisions/0118-the-store-upload-is-proxied.md`
- Create: `docs/decisions/0119-provenance-checks-own-the-supply-chain.md`
- Create: `docs/decisions/0120-secrets-are-encrypted-at-rest.md`
- Modify: `STATUS.md`

**Interfaces:**
- Consumes: the audit evidence in the spec.
- Produces: the reuse-gate claims and the active-plan line later tasks depend on.

- [ ] **Step 1: Write the five notes**

Use the template in `docs/decisions/README.md`. Each note names the paths it claims, the problem shape, all seven reuse-gate rungs (including searches that found nothing), a comparison and a decision. `0116` claims `src/web/packages/host/src/server.ts`, `src/web/packages/host/src/serve/static-path.ts`, `src/web/packages/host/src/providers/`, and (if needed) the editor watchlist paths. `0117` claims the chart/data watchlist paths. `0119` claims `scripts/`.

- [ ] **Step 2: Update STATUS**

Set the active plan to `docs/superpowers/plans/2026-10-25-performance-security-hardening.md`; keep the backlog-drain plan listed as queued. Replace "Last completed change" with one bullet per line, at most five.

- [ ] **Step 3: Run the process checks**

Run: `npm run status:check && npm run docs:check && npm run gates:self-test`
Expected: all exit 0.

- [ ] **Step 4: Commit**

```bash
git add docs/decisions/0116-*.md docs/decisions/0117-*.md docs/decisions/0118-*.md docs/decisions/0119-*.md docs/decisions/0120-*.md STATUS.md
git commit -m "docs: open the hardening plan and its decisions"
```

---

## Phase 1 — Host request boundary

### Task 1.1: Refuse foreign-origin loopback API requests

**Files:**
- Modify: `src/web/packages/host/src/server.ts`
- Test: `src/web/packages/host/src/server.test.ts`

**Interfaces:**
- Consumes: `isLoopbackRemote(address)`, `isForeignOrigin(request)`.
- Produces: `export function refusesLoopbackApi(request: http.IncomingMessage, url: URL): boolean` — true for a loopback peer when the whole `isForeignOrigin(request)` rule holds (a missing or non-loopback `Host`, or a stated `Origin` that disagrees with `Host`), for `/api/*`, except `/api/host`.

- [ ] **Step 1: Write the failing test**

```ts
it("refuses a rebound Host on a loopback admin route", async () => {
  const answer = await request("/api/pairing/code", {
    remoteAddress: "127.0.0.1",
    headers: { host: "evil.example:5227" },
  });
  expect(answer.status).toBe(403);
});

it("still serves localhost, 127.0.0.1 and [::1]", async () => {
  for (const host of ["localhost:5227", "127.0.0.1:5227", "[::1]:5227"]) {
    expect((await request("/api/pairing/code", { remoteAddress: "127.0.0.1", headers: { host } })).status).toBe(200);
  }
});

it("leaves the cross-origin /api/host discovery route alone", async () => {
  expect((await request("/api/host", { remoteAddress: "127.0.0.1", headers: { host: "evil.example:5227" } })).status).toBe(200);
});
```

- [ ] **Step 2: Run and verify it fails**

Run: `npx vitest run packages/host/src/server.test.ts -t "rebound Host"`
Expected: FAIL with status 200.

- [ ] **Step 3: Implement the guard**

Call `refusesLoopbackApi` immediately after the URL is parsed, before any route branch; on true, `sendText(response, 403, "That request is from another origin.")` and return. Do not apply it to a non-loopback peer.

- [ ] **Step 4: Run the focused tests, then the file**

Run: `npx vitest run packages/host/src/server.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/web/packages/host/src/server.ts src/web/packages/host/src/server.test.ts
git commit -m "fix(host): refuse foreign Host on loopback API routes"
```

### Task 1.2: Derive theme asset MIME from the declared kind

**Files:**
- Create: `src/web/packages/renderer-core/src/theme/asset-media-type.ts`
- Modify: `src/web/packages/renderer-core/src/index.ts`
- Modify: `src/web/packages/renderer-core/src/theme/envelope-semantics.ts`
- Modify: `src/web/packages/host/src/server.ts`
- Test: `src/web/packages/renderer-core/src/theme/asset-media-type.test.ts`
- Test: `src/web/packages/renderer-core/src/theme/envelope-semantics.test.ts`
- Test: `src/web/packages/host/src/server.test.ts`

**Interfaces:**
- Produces: `themeAssetContentType(asset: { kind: string; path: string }): string | undefined` and `ASSET_EXTENSIONS: Readonly<Record<AssetKind, readonly string[]>>`; both exported from `renderer-core/src/index.ts`, with `AssetKind` re-exported there.
- Consumes: the existing asset kind union in `renderer-core/src/theme/document.ts`.

- [ ] **Step 1: Write the failing tests**

Assert `themeAssetContentType({kind:"image", path:"assets/x.html"})` is `undefined`; `image/x.png` is `image/png`; `svg/x.svg` is `image/svg+xml`; `video/x.mp4` is `video/mp4`; `font/x.woff2` is `font/woff2`. Assert the envelope validator reports an `invalid-asset-path` issue for a kind/extension mismatch.

- [ ] **Step 2: Verify they fail**

Run: `npx vitest run packages/host/src/themes/asset-media-type.test.ts packages/renderer-core/src/theme/envelope-semantics.test.ts`
Expected: FAIL (module missing / no issue).

- [ ] **Step 3: Implement**

Add the extension map and content-type map in `asset-media-type.ts`. In `validateAssetPath`, take the asset's `kind` and refuse a path whose extension is not in that kind's list. In the asset route, use `themeAssetContentType(declared)`; if undefined answer 415. Add `X-Content-Type-Options: nosniff` and `Content-Security-Policy: sandbox; default-src 'none'` to the response.

- [ ] **Step 4: Add the route regression test**

Import a package declaring `kind:"image", path:"assets/x.html"` and assert the asset route answers 415 and never `text/html`. Assert the same for `.js`.

- [ ] **Step 5: Run and commit**

Run: `npx vitest run packages/host/src/themes packages/renderer-core/src/theme packages/host/src/server.test.ts`
Expected: PASS.

```bash
git add src/web/packages/renderer-core/src/theme/asset-media-type.ts src/web/packages/renderer-core/src/theme/asset-media-type.test.ts src/web/packages/renderer-core/src/index.ts src/web/packages/renderer-core/src/theme/envelope-semantics.ts src/web/packages/renderer-core/src/theme/envelope-semantics.test.ts src/web/packages/host/src/server.ts src/web/packages/host/src/server.test.ts src/web/packages/host/src/themes/store.test.ts src/web/packages/host/src/themes/submission.test.ts
git commit -m "fix(host): bind theme asset MIME to the declared kind"
```

### Task 1.3: Guard import, Wallpaper Engine and health

**Files:**
- Modify: `src/web/packages/host/src/server.ts`
- Test: `src/web/packages/host/src/server.test.ts`

**Interfaces:**
- Consumes: `isForeignOrigin`, `isLoopbackRemote`.
- Produces: no new exports.

- [ ] **Step 1: Write failing tests**

- `/api/themes/import` with `Origin: https://evil.example` and a loopback peer answers 403.
- `/api/wallpaper-engine`, `/api/wallpaper-engine/exports` and `/api/wallpaper-engine/export` with a valid display token but a non-loopback peer answer 403.
- `/api/health` from a LAN peer answers `{ok:true}` only; a loopback peer still sees `displays`/`polling`.
- `/api/pairing/sessions` with a foreign Origin answers 403.

- [ ] **Step 2: Verify they fail**

Run: `npx vitest run packages/host/src/server.test.ts -t "foreign origin|wallpaper|health"`
Expected: FAIL.

- [ ] **Step 3: Implement**

Add `isForeignOrigin(request)` to the import branch (beside `normalize-video` and `install`). Add `isLoopbackRemote` to every `/api/wallpaper-engine*` branch before anything is read. Split health by peer: LAN gets `{ok:true}`, loopback gets the existing detail. Let the central guard cover pairing sessions.

- [ ] **Step 4: Run and commit**

Run: `npx vitest run packages/host/src/server.test.ts`
Expected: PASS.

```bash
git add src/web/packages/host/src/server.ts src/web/packages/host/src/server.test.ts
git commit -m "fix(host): gate import, wallpaper and health by surface"
```

### Task 1.4: Make pairing claims atomic and bound sockets and streams

**Files:**
- Modify: `src/web/packages/host/src/session/pairing-code.ts`
- Modify: `src/web/packages/host/src/server.ts`
- Test: `src/web/packages/host/src/session/pairing-code.test.ts`
- Test: `src/web/packages/host/src/server.test.ts`

**Interfaces:**
- Consumes: existing `claim(code, source)`.
- Produces: `claim` returns true for exactly one concurrent correct caller; `MAX_STREAM_KEYS = 64`, `MAX_STREAM_KEY_BYTES = 128`, `MAX_STREAM_CONNECTIONS = 64`, `MAX_STREAM_CONNECTIONS_PER_DISPLAY = 8`.

- [ ] **Step 1: Write failing tests**

- Two concurrent `claim(correct, "1.2.3.4")` calls resolve `[true, false]`.
- A correct claim whose code expires during the wait returns false.
- `/ws` with 65 keys answers 400; a 129-byte key answers 400; the 65th connection answers 429.
- A socket that connects and sends nothing is destroyed after the pre-handshake timeout (fake timers).

- [ ] **Step 2: Verify they fail**

Run: `npx vitest run packages/host/src/session/pairing-code.test.ts packages/host/src/server.test.ts -t "concurrent|keys|slow"`
Expected: FAIL.

- [ ] **Step 3: Implement**

In `claim`, re-read `current()` after the wait, compare, then clear `live` before returning true. In `openStream`, validate key count/length before constructing the connection and enforce connection caps. In the port listener, `socket.setTimeout(5_000, () => socket.destroy())` until handover; set `listener.maxConnections = 256`.

- [ ] **Step 4: Run and commit**

Run: `npx vitest run packages/host/src/session packages/host/src/server.test.ts`
Expected: PASS.

```bash
git add src/web/packages/host/src/session/pairing-code.ts src/web/packages/host/src/session/pairing-code.test.ts src/web/packages/host/src/server.ts src/web/packages/host/src/server.test.ts
git commit -m "fix(host): make pairing claims single-use and bound streams"
```

### Task 1.5: Bound large bodies, redact admin errors, and close static symlinks

**Files:**
- Modify: `src/web/packages/host/src/server.ts`
- Modify: `src/web/packages/host/src/serve/static-path.ts`
- Test: `src/web/packages/host/src/server.test.ts`
- Test: `src/web/packages/host/src/serve/static-path.test.ts`

**Interfaces:**
- Produces: `createLargeBodyGate(maxConcurrent = 1)` with `run<T>(work): Promise<T>` and `busy(): boolean`; `resolveStaticPath` unchanged, plus `realStaticPath(root, urlPath): Promise<string | undefined>` in `serve/static-path.ts`.

- [ ] **Step 1: Write failing tests**

- A second simultaneous theme import answers 429 while the first is in flight.
- A display-store failure answers a fixed sentence with no absolute path.
- A symlinked file inside a bundle root is not served; a regular file is.
- A bundle response carries `etag`; `If-None-Match` answers 304.

- [ ] **Step 2: Verify they fail**

Run: `npx vitest run packages/host/src/server.test.ts packages/host/src/serve/static-path.test.ts -t "429|path|symlink|etag"`
Expected: FAIL.

- [ ] **Step 3: Implement**

Wrap `readBytes` for theme-sized bodies in the gate. Replace raw `error.message` forwarding on admin routes with fixed messages and `console.error` detail. Add `realStaticPath` using `fs.realpath` plus the existing prefix check and reject links/dotfiles; in `serveStatic`, add an `ETag` from `stat` and handle `If-None-Match`.

- [ ] **Step 4: Run and commit**

Run: `npx vitest run packages/host/src/server.test.ts packages/host/src/serve`
Expected: PASS.

```bash
git add src/web/packages/host/src/server.ts src/web/packages/host/src/server.test.ts src/web/packages/host/src/serve/static-path.ts src/web/packages/host/src/serve/static-path.test.ts
git commit -m "fix(host): bound uploads, redact errors and contain static files"
```

---

## Phase 2 — Untrusted files and outbound fetches

### Task 2.1: Preflight ZIP entry counts

**Files:**
- Create: `src/web/packages/theme-package/src/archive-preflight.ts`
- Modify: `src/web/packages/theme-package/src/index.ts`
- Test: `src/web/packages/theme-package/src/archive-preflight.test.ts`
- Test: `src/web/packages/theme-package/src/index.test.ts`

**Interfaces:**
- Produces: `zipEntryCount(bytes: Uint8Array): number | undefined` and `ZIP_MAX_ENTRIES = 128`, `ZIP_MAX_CENTRAL_DIRECTORY_BYTES = 8 * 1024 * 1024`.

- [ ] **Step 1: Write the failing test**

Craft an EOCD/ZIP64 pair declaring `0xffffffff` entries; assert `zipEntryCount` returns the huge number and `readThemePackage` refuses with a message before unzip. Add a normal package test that still succeeds.

- [ ] **Step 2: Verify it fails**

Run: `npx vitest run packages/theme-package/src/archive-preflight.test.ts packages/theme-package/src/index.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

Scan the last 65,557 bytes for `PK\x05\x06`, read the count and central-directory size, follow the ZIP64 locator/EOCD when present, and refuse count > 128 or directory > 8 MiB before `unzipSync`.

- [ ] **Step 4: Run and commit**

Run: `npx vitest run packages/theme-package`
Expected: PASS.

```bash
git add src/web/packages/theme-package/src/archive-preflight.ts src/web/packages/theme-package/src/archive-preflight.test.ts src/web/packages/theme-package/src/index.ts src/web/packages/theme-package/src/index.test.ts
git commit -m "fix(theme-package): refuse crafted ZIP64 entry counts before extraction"
```

### Task 2.2: Bound writes, contain reads, and cap thumbnail dimensions

**Files:**
- Create: `src/web/packages/host/src/themes/contained-read.ts`
- Modify: `src/web/packages/host/src/themes/store.ts`
- Modify: `src/web/packages/host/src/themes/thumbnails.ts`
- Test: `src/web/packages/host/src/themes/contained-read.test.ts`
- Test: `src/web/packages/host/src/themes/store.test.ts`
- Test: `src/web/packages/host/src/themes/thumbnails.test.ts`

**Interfaces:**
- Produces: `readContainedFile(root: string, relativePath: string): Promise<Buffer | undefined>`; `pngDimensions(bytes: Uint8Array): {width:number;height:number} | undefined`; `MAX_THUMBNAIL_EDGE = 4096`, `MAX_THUMBNAIL_PIXELS = 16_777_216`.

- [ ] **Step 1: Write failing tests**

- A theme save whose serialized `theme.json` exceeds `MAX_THEME_FILE_BYTES` throws `ThemeTooLargeError` and leaves no folder.
- A junction/symlink asset pointing outside the theme folder reads as `undefined`; a normal asset reads.
- A PNG whose IHDR declares 100000×100000 is refused; a real 1×1 PNG is accepted.

- [ ] **Step 2: Verify they fail**

Run: `npx vitest run packages/host/src/themes`
Expected: FAIL.

- [ ] **Step 3: Implement**

Add the size check before `mkdir(staging)`. Use `readContainedFile` in `store.read`, `readAsset` and `thumbnails.read`. Parse IHDR at bytes 16–23 and apply the caps. Replace the signature-only test fixture with a valid 1×1 PNG.

- [ ] **Step 4: Run and commit**

Run: `npx vitest run packages/host/src/themes`
Expected: PASS.

```bash
git add src/web/packages/host/src/themes/contained-read.ts src/web/packages/host/src/themes/contained-read.test.ts src/web/packages/host/src/themes/store.ts src/web/packages/host/src/themes/store.test.ts src/web/packages/host/src/themes/thumbnails.ts src/web/packages/host/src/themes/thumbnails.test.ts
git commit -m "fix(host): bound theme writes, contain reads and cap thumbnails"
```

### Task 2.3: Refuse private redirect targets and decode transition addresses

**Files:**
- Modify: `src/web/packages/host/src/providers/custom/fetch-source.ts`
- Test: `src/web/packages/host/src/providers/custom/fetch-source-redirects.test.ts`

**Interfaces:**
- Produces: `isPrivateAddress(address: string): boolean`; `refusalReason(destination, options: { allowPrivate: boolean })`.

- [ ] **Step 1: Write failing tests**

A public first URL redirecting to `http://127.0.0.1/`, `http://10.0.0.1/`, `http://[::1]/`, `http://[::ffff:0:169.254.169.254]/`, `http://[64:ff9b:1::a9fe:a9fe]/` and `http://0.0.0.0/` is refused. A user-typed `http://192.168.1.10/` first URL still works; its redirect to the same private range is allowed.

- [ ] **Step 2: Verify it fails**

Run: `npx vitest run packages/host/src/providers/custom/fetch-source-redirects.test.ts -t "private|transition"`
Expected: FAIL.

- [ ] **Step 3: Implement**

Add private/loopback/CGNAT/unspecified ranges for IPv4 and IPv6, decode mapped/NAT64/6to4/Teredo forms, and pass `allowPrivate` only for the first hop and for redirects whose original destination was private.

- [ ] **Step 4: Run and commit**

Run: `npx vitest run packages/host/src/providers/custom`
Expected: PASS.

```bash
git add src/web/packages/host/src/providers/custom/fetch-source.ts src/web/packages/host/src/providers/custom/fetch-source-redirects.test.ts
git commit -m "fix(providers): refuse private redirect targets"
```

### Task 2.4: Pin DNS through the connection

**Files:**
- Modify: `src/web/packages/host/src/providers/custom/fetch-source.ts`
- Modify: `src/web/packages/host/package.json`
- Test: `src/web/packages/host/src/providers/custom/pinned-fetch.test.ts`

**Interfaces:**
- Produces: `createPinnedFetch(options): typeof fetch`; the default fetcher uses it. A `lookup` seam stays injectable.

- [ ] **Step 1: Write the failing test**

A fake resolver returns `93.184.216.34` on the policy lookup and `127.0.0.1` on the connection lookup; assert the connection receives the checked address (or is refused), not the second answer. A public address connects normally.

- [ ] **Step 2: Verify it fails**

Run: `npx vitest run packages/host/src/providers/custom/pinned-fetch.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

Add `undici` as a direct host dependency (it is already in the tree; verify the installed version and licence). Create an `Agent` whose `connect.lookup` resolves once, applies `isPrivateAddress`/`isBlockedAddress`, and returns the checked address. Type the fetch seam so tests can inject.

- [ ] **Step 4: Run and commit**

Run: `npx vitest run packages/host/src/providers/custom`
Expected: PASS.

```bash
git add src/web/packages/host/src/providers/custom/fetch-source.ts src/web/packages/host/src/providers/custom/pinned-fetch.test.ts src/web/packages/host/package.json package-lock.json THIRD-PARTY-NOTICES.md docs/engineering/dependencies.md
git commit -m "fix(providers): pin DNS resolution to the checked address"
```

### Task 2.5: Enforce the video envelope on every import

**Files:**
- Modify: `src/web/packages/host/src/themes/import.ts`
- Test: `src/web/packages/host/src/themes/import.test.ts`

**Interfaces:**
- Consumes: `themeVideoRefusals(envelope, assets)`.
- Produces: `importThemePackage` refuses a non-conforming video with the same message as install.

- [ ] **Step 1: Write the failing test**

A package with an audio-bearing or over-30-second MP4 is refused by `importThemePackage`; a conforming one imports.

- [ ] **Step 2: Verify it fails**

Run: `npx vitest run packages/host/src/themes/import.test.ts -t "video"`
Expected: FAIL.

- [ ] **Step 3: Implement**

Run `themeVideoRefusals` after `readThemePackage` and return its first reason before any store write.

- [ ] **Step 4: Run and commit**

Run: `npx vitest run packages/host/src/themes`
Expected: PASS.

```bash
git add src/web/packages/host/src/themes/import.ts src/web/packages/host/src/themes/import.test.ts
git commit -m "fix(host): enforce the video envelope on direct import"
```

---

## Phase 3 — Player

### Task 3.1: Add sample revisions and numeric history

**Files:**
- Modify: `src/web/packages/renderer-core/src/data/source.ts`
- Modify: `src/web/packages/renderer-core/src/data/store.ts`
- Modify: `src/web/packages/renderer-core/src/data/live-source.ts`
- Test: `src/web/packages/renderer-core/src/data/store.test.ts`
- Test: `src/web/packages/renderer-core/src/data/live-source.test.ts`

**Interfaces:**
- Produces: `SampleSource.revision: number`; `SampleStore.revision`; `history(key, windowSeconds)` uses stored numeric times and a binary search.

- [ ] **Step 1: Write failing tests**

`revision` starts at 0, increments once per `ingest`, and resets to 0 on `reset`. `history` returns the same window with values whose `timestamp` strings are malformed but whose stored numeric time is valid. A 600-sample window query calls `Date.parse` zero times (spy).

- [ ] **Step 2: Verify they fail**

Run: `npx vitest run packages/renderer-core/src/data`
Expected: FAIL.

- [ ] **Step 3: Implement**

Keep a parallel numeric `times` array per key, push on ingest, prune both in place, and binary-search the start index. Expose the revision from `SampleStore` and `createLiveSource`'s source object.

- [ ] **Step 4: Run and commit**

Run: `npx vitest run packages/renderer-core/src/data`
Expected: PASS.

```bash
git add src/web/packages/renderer-core/src/data
git commit -m "perf(renderer-core): revision-count samples and index history numerically"
```

### Task 3.2: Repaint non-line work only when a sample changed

**Files:**
- Modify: `src/web/packages/player/src/main.ts`
- Modify: `src/web/packages/scene-fabric/src/chart-object.ts`
- Test: `src/web/packages/player/src/main.dom.test.ts`
- Test: `src/web/packages/scene-fabric/src/chart-refresh.test.ts`

**Interfaces:**
- Consumes: `source.revision`.
- Produces: `refresh(revision)` skips gauge/bar/pie/text/image/notice work when the revision is unchanged; line charts still refresh every frame but reuse cached points when the revision is unchanged; `YunariChart.setOption` uses `{notMerge:false, replaceMerge:["series"]}`; `requestRenderAll` runs only when an object changed.

- [ ] **Step 1: Write failing tests**

With a fake source whose revision stays 1, advance 29 frames: gauge `setOption` calls stay at 1, text `set` calls stay at 1, `buildLinePoints` calls stay at 1, and line `setOption` calls reach 30. With revision 2, every family updates. With no change at all, `requestRenderAll` is not called.

- [ ] **Step 2: Verify they fail**

Run: `npx vitest run packages/player/src/main.dom.test.ts packages/scene-fabric/src/chart-refresh.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

Thread the revision through `refresh` and `hydrateCharts`; gate the non-line families and `refreshBoundText`/`refreshBoundImages`/`showAvailabilityNotice`; call `requestRenderAll` only when a family changed. Cache built line points per revision and chart settings, then filter the cached points by the time window. Change the ECharts update options.

- [ ] **Step 4: Browser proof**

Build the player, run the affected chart spec, and compare a rendered capture of a line chart and a gauge before/after. Record the spec and the inspected evidence in the commit body.

- [ ] **Step 5: Run and commit**

Run: `npm run build:player && npx playwright test tests/e2e/<affected-chart-spec>.spec.ts --workers=1`
Expected: PASS.

```bash
git add src/web/packages/player/src/main.ts src/web/packages/player/src/main.dom.test.ts src/web/packages/scene-fabric/src/chart-object.ts src/web/packages/scene-fabric/src/chart-refresh.test.ts
git commit -m "perf(player): repaint charts from sample revisions"
```

### Task 3.3: Schedule chart refresh at its due time

**Files:**
- Modify: `src/web/packages/scene-fabric/src/chart-refresh.ts`
- Test: `src/web/packages/scene-fabric/src/chart-refresh.test.ts`

**Interfaces:**
- Produces: `FrameDriver` gains `setTimer(callback: () => void, delayMs: number): number` and `clearTimer(id: number): void`; default uses `setTimeout`/`clearTimeout`.

- [ ] **Step 1: Write the failing test**

At rate 1, advance 60 frames over one second with a fake clock: exactly one refresh and at most two frame requests. At rate 30, 30–31 refreshes in one second.

- [ ] **Step 2: Verify it fails**

Run: `npx vitest run packages/scene-fabric/src/chart-refresh.test.ts`
Expected: FAIL (60 callbacks observed).

- [ ] **Step 3: Implement**

Compute the due time; when `now < due`, schedule a timer to `due - now` and request no frame; when due, refresh and schedule the next wake. `setRate` recomputes the next wake.

- [ ] **Step 4: Run and commit**

Run: `npx vitest run packages/scene-fabric/src/chart-refresh.test.ts`
Expected: PASS.

```bash
git add src/web/packages/scene-fabric/src/chart-refresh.ts src/web/packages/scene-fabric/src/chart-refresh.test.ts
git commit -m "perf(scene-fabric): wake the chart loop at its cadence"
```

### Task 3.4: Pause when hidden, restore after bfcache, and dedupe resize

**Files:**
- Modify: `src/web/packages/player/src/main.ts`
- Modify: `src/web/packages/scene-fabric/src/scene.ts`
- Modify: `src/web/packages/scene-fabric/src/background-media.ts`
- Test: `src/web/packages/player/src/main.dom.test.ts`
- Test: `src/web/packages/scene-fabric/src/scene.dom.test.ts`

**Interfaces:**
- Produces: `SceneHandle.pauseMedia(): void` and `resumeMedia(): void`; `SceneHandle.resize()` returns early for unchanged pixels; the background media layer keeps a glass-surface count and starts no video frame callback while it is zero; player listens to `visibilitychange` and `pageshow.persisted`.

- [ ] **Step 1: Write failing tests**

Dispatch `visibilitychange` with `hidden=true`: refresh loop stopped, video paused. `hidden=false`: loop restarted. `pageshow` with `persisted=true` calls reload. Calling `resize()` twice with the same viewport sets dimensions once. With the glass-surface count at zero, the video frame callback is not scheduled; at one, it is.

- [ ] **Step 2: Verify they fail**

Run: `npx vitest run packages/player/src/main.dom.test.ts packages/scene-fabric/src/scene.dom.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

Add the listeners in the player; expose media pause/resume on the scene handle; track the last fitted width/height in `scene.ts`.

- [ ] **Step 4: Browser check**

Run the built player with a hidden-tab emulation and confirm no chart refreshes while hidden and a refresh after visible. Record the check.

- [ ] **Step 5: Run and commit**

Run: `npx vitest run packages/player/src/main.dom.test.ts packages/scene-fabric/src/scene.dom.test.ts`
Expected: PASS.

```bash
git add src/web/packages/player/src/main.ts src/web/packages/player/src/main.dom.test.ts src/web/packages/scene-fabric/src/scene.ts src/web/packages/scene-fabric/src/scene.dom.test.ts src/web/packages/scene-fabric/src/background-media.ts
git commit -m "perf(player): pause hidden displays and survive bfcache"
```

### Task 3.5: Chain the publish poll

**Files:**
- Modify: `src/web/packages/player/src/publish-follower.ts`
- Test: `src/web/packages/player/src/publish-follower.test.ts`

**Interfaces:**
- Produces: one request in flight; the next timeout is armed only after the request settles; a 403/404 clears it.

- [ ] **Step 1: Write the failing test**

A fetch that resolves after two intervals produces exactly one request in that span. A 403 then advancing time produces no further requests.

- [ ] **Step 2: Verify it fails**

Run: `npx vitest run packages/player/src/publish-follower.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

Replace `setInterval` with a recursive `setTimeout` in `finally`; clear on refusal/dispose.

- [ ] **Step 4: Run and commit**

Run: `npx vitest run packages/player/src/publish-follower.test.ts`
Expected: PASS.

```bash
git add src/web/packages/player/src/publish-follower.ts src/web/packages/player/src/publish-follower.test.ts
git commit -m "perf(player): chain the publish poll and stop after refusal"
```

---

## Phase 4 — Host IO

### Task 4.1: Add scoped theme reads

**Files:**
- Modify: `src/web/packages/host/src/themes/store.ts`
- Test: `src/web/packages/host/src/themes/store.test.ts`

**Interfaces:**
- Produces: `readEnvelope(id): Promise<FabricThemeEnvelope | undefined>`, `readAsset(id, assetPath): Promise<Uint8Array | undefined>`, `exists(id): Promise<boolean>`; `list()` no longer hashes.

- [ ] **Step 1: Write failing tests**

`readAsset` reads exactly one declared file (spy `readFile` count). `readEnvelope` does not call `createHash`. `list()` does not call `createHash` per theme. `readAsset` returns undefined for an undeclared path and for a file over the asset cap.

- [ ] **Step 2: Verify they fail**

Run: `npx vitest run packages/host/src/themes/store.test.ts -t "readAsset|readEnvelope|list"`
Expected: FAIL.

- [ ] **Step 3: Implement**

Split the internal reader; keep `readStored` for save-conflict content ids. Use `readContainedFile` for the one asset.

- [ ] **Step 4: Run and commit**

Run: `npx vitest run packages/host/src/themes`
Expected: PASS.

```bash
git add src/web/packages/host/src/themes/store.ts src/web/packages/host/src/themes/store.test.ts
git commit -m "perf(host): read a theme envelope or one asset, not the whole theme"
```

### Task 4.2: Use scoped reads on the routes

**Files:**
- Modify: `src/web/packages/host/src/server.ts`
- Test: `src/web/packages/host/src/server.test.ts`

**Interfaces:**
- Consumes: `readEnvelope`, `readAsset`, `exists`.
- Produces: `/api/published` calls `exists`, the asset route calls `readAsset`, the document and publish checks call `readEnvelope`.

- [ ] **Step 1: Write failing tests**

With a store stub, `/api/published` does not call `list`; the asset route reads one asset; the document route does not read assets.

- [ ] **Step 2: Verify they fail**

Run: `npx vitest run packages/host/src/server.test.ts -t "published|asset|document"`
Expected: FAIL.

- [ ] **Step 3: Implement**

Replace the calls; preserve 404 semantics.

- [ ] **Step 4: Run and commit**

Run: `npx vitest run packages/host/src/server.test.ts`
Expected: PASS.

```bash
git add src/web/packages/host/src/server.ts src/web/packages/host/src/server.test.ts
git commit -m "perf(host): serve published state and assets without a library scan"
```

### Task 4.3: Gate provider reads on the requested keys

**Files:**
- Modify: `src/web/packages/host/src/providers/library.ts`
- Modify: `src/web/packages/host/src/providers/registry.ts`
- Test: `src/web/packages/host/src/providers/library.test.ts`
- Test: `src/web/packages/host/src/providers/registry.test.ts`

**Interfaces:**
- Produces: `LibraryProvider.sample` calls only the families its `owned` keys need; a machine-wide read is shared across ask groups in one tick.

- [ ] **Step 1: Write failing tests**

Binding only `cpu.load` calls `currentLoad` and no `fsSize`, `networkStats` or `graphics`. Binding `gpu.*` calls `graphics`. Two ask groups with the same machine-wide keys call `graphics` once.

- [ ] **Step 2: Verify they fail**

Run: `npx vitest run packages/host/src/providers/library.test.ts packages/host/src/providers/registry.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

Derive `wantsLoad`, `wantsSpeed`, `wantsMem`, `wantsFilesystems`, `wantsNetwork`, `wantsGraphics` from `owned`; pass `undefined` for the rest and handle it at each consumer. Cache machine-wide reads per tick in the registry.

- [ ] **Step 4: Run and commit**

Run: `npx vitest run packages/host/src/providers`
Expected: PASS.

```bash
git add src/web/packages/host/src/providers/library.ts src/web/packages/host/src/providers/library.test.ts src/web/packages/host/src/providers/registry.ts src/web/packages/host/src/providers/registry.test.ts
git commit -m "perf(host): sample only the sensor families a display binds"
```

### Task 4.4: Single-flight ticks and read devices once

**Files:**
- Modify: `src/web/packages/host/src/server.ts`
- Test: `src/web/packages/host/src/server.test.ts`

**Interfaces:**
- Produces: a tick in flight causes the interval to skip; `currentAssignment(display, cachedDevices)` takes the tick's device read.

- [ ] **Step 1: Write failing tests**

A provider that resolves after two intervals produces one sample batch in that span. Four displays cause one `devices.read` per tick.

- [ ] **Step 2: Verify they fail**

Run: `npx vitest run packages/host/src/server.test.ts -t "tick|devices"`
Expected: FAIL.

- [ ] **Step 3: Implement**

Add a `ticking` flag with `finally`; read `devices.read()` once before the display loop and pass it down.

- [ ] **Step 4: Run and commit**

Run: `npx vitest run packages/host/src/server.test.ts`
Expected: PASS.

```bash
git add src/web/packages/host/src/server.ts src/web/packages/host/src/server.test.ts
git commit -m "perf(host): single-flight sampling and share device settings"
```

### Task 4.5: Cache weather settings, share SSE frames, and poll LHM cheaply

**Files:**
- Modify: `src/web/packages/host/src/providers/weather/provider.ts`
- Modify: `src/web/packages/host/src/settings/weather.ts`
- Modify: `src/web/packages/host/src/transport/sse.ts`
- Modify: `src/web/packages/host/src/tray/external-apps.ts`
- Test: `src/web/packages/host/src/providers/weather/provider.test.ts`
- Test: `src/web/packages/host/src/transport/sse.test.ts`
- Test: `src/web/packages/host/src/tray/external-apps.test.ts`

**Interfaces:**
- Produces: `WeatherSettingsStore.read()` caches by `mtimeMs`/size; `formatSseEvent` is called once per payload; `probeLhm` uses `Range: 0-0`, cancels the body and caches for `PROCESS_CACHE_MS`.

- [ ] **Step 1: Write failing tests**

Two consecutive weather samples cause one file read. Two connections in one group cause one frame format. Two LHM polls inside the cache window cause one fetch.

- [ ] **Step 2: Verify they fail**

Run: `npx vitest run packages/host/src/providers/weather packages/host/src/transport packages/host/src/tray`
Expected: FAIL.

- [ ] **Step 3: Implement**

Add the mtime cache, preformat the frame and pass it to each connection, and cache the LHM probe.

- [ ] **Step 4: Run and commit**

Run: `npx vitest run packages/host/src/providers/weather packages/host/src/transport packages/host/src/tray`
Expected: PASS.

```bash
git add src/web/packages/host/src/providers/weather src/web/packages/host/src/settings/weather.ts src/web/packages/host/src/transport/sse.ts src/web/packages/host/src/tray/external-apps.ts
git commit -m "perf(host): cache settings, share SSE frames and probe LHM cheaply"
```

---

## Phase 5 — Editor

### Task 5.1: Coalesce document notifications

**Files:**
- Modify: `src/web/packages/editor/src/editor-document.ts`
- Modify: `src/web/packages/editor/src/editor-shell/bridge.ts`
- Test: `src/web/packages/editor/src/editor-document.test.ts`
- Test: `src/web/packages/editor/src/editor-shell/bridge.test.ts`

**Interfaces:**
- Produces: `announceChange` schedules one microtask notification per revision; `subscribeDocumentChange` listeners run once per batch.

- [ ] **Step 1: Write failing tests**

Fire 50 `object:added` events synchronously: one listener call. A restore's `object:removed`/`added` storm produces one call and no history entry.

- [ ] **Step 2: Verify they fail**

Run: `npx vitest run packages/editor/src/editor-document.test.ts packages/editor/src/editor-shell/bridge.test.ts`
Expected: FAIL (50 calls).

- [ ] **Step 3: Implement**

Add a scheduled flag and a microtask; increment the revision once.

- [ ] **Step 4: Run and commit**

Run: `npx vitest run packages/editor/src/editor-document.test.ts packages/editor/src/editor-shell/bridge.test.ts`
Expected: PASS.

```bash
git add src/web/packages/editor/src/editor-document.ts src/web/packages/editor/src/editor-document.test.ts src/web/packages/editor/src/editor-shell/bridge.ts src/web/packages/editor/src/editor-shell/bridge.test.ts
git commit -m "perf(editor): coalesce document change notifications"
```

### Task 5.2: Memoise dirty state and bound history

**Files:**
- Modify: `src/web/packages/editor/src/editor-document.ts`
- Modify: `src/web/packages/editor/src/history-manager/index.ts`
- Test: `src/web/packages/editor/src/editor-document.test.ts`
- Test: `src/web/packages/editor/src/history-manager/index.test.ts`

**Interfaces:**
- Produces: `MAX_HISTORY_ENTRIES = 100`; `HistoryEntry.fingerprint: string`; `isDirty()` caches per document revision.

- [ ] **Step 1: Write failing tests**

101 saves leave 100 entries and undo walks the newest 100. `save()` calls `JSON.stringify` once per new entry and zero times for unchanged content. Two `isDirty()` calls at one revision cause one snapshot.

- [ ] **Step 2: Verify they fail**

Run: `npx vitest run packages/editor/src/history-manager/index.test.ts packages/editor/src/editor-document.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

Compute the fingerprint at capture; trim from the front while adjusting `#index`; cache the dirty result with the revision.

- [ ] **Step 4: Run and commit**

Run: `npx vitest run packages/editor/src/history-manager packages/editor/src/editor-document.test.ts`
Expected: PASS.

```bash
git add src/web/packages/editor/src/history-manager/index.ts src/web/packages/editor/src/history-manager/index.test.ts src/web/packages/editor/src/editor-document.ts src/web/packages/editor/src/editor-document.test.ts
git commit -m "perf(editor): bound history and memoise dirty state"
```

### Task 5.3: Stop idle publish work and speed the layer projection

**Files:**
- Modify: `src/web/packages/editor/src/editor-shell/publish-control.tsx`
- Modify: `src/web/packages/editor/src/editor-shell/layer-tree.ts`
- Test: `src/web/packages/editor/src/editor-shell/publish-control.dom.test.tsx`
- Test: `src/web/packages/editor/src/editor-shell/layer-tree.test.ts`

**Interfaces:**
- Produces: `publishableDocument()` runs only while `publishing`; `layerRows` accepts a selected-id `Set`.

- [ ] **Step 1: Write failing tests**

A document change while idle calls no `publishableDocument`. A 500-object tree builds rows without `selected.includes` (spy) and with one `getObjects` per group.

- [ ] **Step 2: Verify they fail**

Run: `npx vitest run packages/editor/src/editor-shell/publish-control.dom.test.tsx packages/editor/src/editor-shell/layer-tree.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

Gate the subscription work and pass a `Set<string>` through the projection.

- [ ] **Step 4: Run and commit**

Run: `npx vitest run packages/editor/src/editor-shell`
Expected: PASS.

```bash
git add src/web/packages/editor/src/editor-shell/publish-control.tsx src/web/packages/editor/src/editor-shell/publish-control.dom.test.tsx src/web/packages/editor/src/editor-shell/layer-tree.ts src/web/packages/editor/src/editor-shell/layer-tree.test.ts
git commit -m "perf(editor): skip idle publish work and set-based layer lookup"
```

### Task 5.4: Decode imported images off the paint path

**Files:**
- Modify: `src/web/packages/editor/src/image-manager/index.ts`
- Test: `src/web/packages/editor/src/image-manager/index.dom.test.ts`

**Interfaces:**
- Produces: `decodeAndScale(file: Blob, maxEdge: number): Promise<ImageBitmap>` using `createImageBitmap(blob, {resizeWidth, resizeHeight, resizeQuality:"high"})`, with the element path as fallback.

- [ ] **Step 1: Write the failing test**

A spy `createImageBitmap` is called with resize options for an oversized image; the fallback is not used when it exists.

- [ ] **Step 2: Verify it fails**

Run: `npx vitest run packages/editor/src/image-manager`
Expected: FAIL.

- [ ] **Step 3: Implement**

Use `createImageBitmap` + `OffscreenCanvas` when available; close the bitmap after draw.

- [ ] **Step 4: Run and commit**

Run: `npx vitest run packages/editor/src/image-manager`
Expected: PASS.

```bash
git add src/web/packages/editor/src/image-manager/index.ts src/web/packages/editor/src/image-manager/index.dom.test.ts
git commit -m "perf(editor): decode and scale imported images off the paint path"
```

---

## Phase 6 — Store uploads and Worker

### Task 6.1: Add the upload table and quota reservation

**Files:**
- Create: `src/web/packages/store-worker/migrations/0002_proxied_uploads.sql`
- Modify: `src/web/packages/store-worker/src/db/quota.ts`
- Test: `src/web/packages/store-worker/tests/quota.spec.ts`

**Interfaces:**
- Produces: table `upload(id TEXT PRIMARY KEY, user_id, item_id, version, envelope_json, key, reserved_bytes INTEGER, created_at TEXT, finalized_at TEXT, bytes INTEGER)`; `pendingBytes(db, userId, now)`; `authorQuotaExceeded` counts finalized bytes + unexpired reservations.

- [ ] **Step 1: Write failing tests**

Two pending uploads of the archive cap each push a 1 GiB account over quota. A finalized upload counts its actual bytes. An upload older than the TTL stops counting.

- [ ] **Step 2: Verify they fail**

Run: `npm run test:worker -- --run tests/quota.spec.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

Add the migration indexes (`upload_user_id_created_at`, `upload_item_version`), the reservation query and the reply.

- [ ] **Step 4: Run and commit**

Run: `npm run test:worker -- --run tests/quota.spec.ts`
Expected: PASS.

```bash
git add src/web/packages/store-worker/migrations/0002_proxied_uploads.sql src/web/packages/store-worker/src/db/quota.ts src/web/packages/store-worker/tests/quota.spec.ts
git commit -m "feat(store): reserve quota for pending uploads"
```

### Task 6.2: Replace presign with an authenticated proxy upload

**Files:**
- Modify: `src/web/packages/store-worker/src/routes/me.ts`
- Modify: `src/web/packages/store-worker/src/storage/keys.ts`
- Modify: `src/web/packages/store-worker/src/env.ts`
- Modify: `src/web/packages/host/src/themes/store-client.ts`
- Modify: `src/web/packages/host/src/catalogue/submit.ts`
- Modify: `src/web/packages/host/src/server.ts`
- Delete: `src/web/packages/store-worker/src/storage/presign.ts`
- Test: `src/web/packages/store-worker/tests/versions.spec.ts`
- Test: `src/web/packages/host/src/themes/store-client.test.ts`
- Test: `src/web/packages/host/src/server.test.ts`

**Interfaces:**
- Produces: `VersionPlan.uploadUrl` is an absolute Worker URL; `uploadPackage(env, session, uploadId, request)` streams; `upload.key = pending/<uploadId>.zip`; `StoreClient.upload(url, bytes)` sends `authorization` and `content-length`; `resolveStoreOrigin(raw: string | undefined): string | undefined` refuses a non-`https:` origin unless it is a loopback test origin.

- [ ] **Step 1: Write failing tests**

The version request returns a URL under `/api/me/uploads/`. A PUT with `content-length` over 95 MiB answers 413 before the body is read. A PUT with no length answers 411. A valid PUT stores the object under `pending/`. An unauthenticated PUT answers 401. A `YUNARI_STORE_ORIGIN` of `http://evil.example` or `https://evil.example` is refused before a token is attached; the compiled catalogue origin and a loopback test origin are accepted.

- [ ] **Step 2: Verify they fail**

Run: `npm run test:worker -- --run tests/versions.spec.ts` and `npx vitest run packages/host/src/themes/store-client.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

Add the route before the generic `/api/me` handler. Insert the upload row, stream `request.body` to `BUCKET.put`, verify the stored size, and return 201. Update the host client and `submit.ts`. Validate `YUNARI_STORE_ORIGIN` once where `server.ts` resolves it: parse with `new URL`, require `https:`, and require the compiled catalogue origin unless the host is loopback. Remove `presignPut` and the R2 S3 env keys from `env.ts` and docs.

- [ ] **Step 4: Run and commit**

Run: `npm run test:worker -- --run tests/versions.spec.ts && npx vitest run packages/host/src/themes/store-client.test.ts`
Expected: PASS.

```bash
git add src/web/packages/store-worker/src/routes/me.ts src/web/packages/store-worker/src/storage/keys.ts src/web/packages/store-worker/src/env.ts src/web/packages/store-worker/src/storage/presign.ts src/web/packages/host/src/themes/store-client.ts src/web/packages/host/src/catalogue/submit.ts src/web/packages/store-worker/tests/versions.spec.ts src/web/packages/host/src/themes/store-client.test.ts
git commit -m "feat(store): proxy uploads through a size-bounded Worker route"
```

### Task 6.3: Finalize pending objects and stream the digest

**Files:**
- Modify: `src/web/packages/store-worker/src/routes/me.ts`
- Modify: `src/web/packages/store-worker/src/storage/objects.ts`
- Modify: `src/web/packages/store-worker/src/routes/public.ts`
- Test: `src/web/packages/store-worker/tests/finalize.spec.ts`
- Test: `src/web/packages/store-worker/tests/public.spec.ts`

**Interfaces:**
- Produces: finalize reads `upload.key`, records `item_version.package_key`, marks the upload finalized with actual bytes; `inspectObject` streams through `crypto.DigestStream`; downloads read `VersionRow.package_key`.

- [ ] **Step 1: Write failing tests**

Finalize stores the pending key and releases the reservation. Download serves the bytes from that key. `inspectObject` does not call `arrayBuffer` (spy). A retried finalize is idempotent.

- [ ] **Step 2: Verify they fail**

Run: `npm run test:worker -- --run tests/finalize.spec.ts tests/public.spec.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

Use the upload row's key and bytes; stream the digest; read `package_key` on download.

- [ ] **Step 4: Run and commit**

Run: `npm run test:worker -- --run tests/finalize.spec.ts tests/public.spec.ts`
Expected: PASS.

```bash
git add src/web/packages/store-worker/src/routes/me.ts src/web/packages/store-worker/src/storage/objects.ts src/web/packages/store-worker/src/routes/public.ts src/web/packages/store-worker/tests/finalize.spec.ts src/web/packages/store-worker/tests/public.spec.ts
git commit -m "feat(store): finalize pending uploads and stream package hashes"
```

### Task 6.4: Clean abandoned uploads on a schedule

**Files:**
- Modify: `src/web/packages/store-worker/src/index.ts`
- Modify: `src/web/packages/store-worker/wrangler.toml`
- Create: `src/web/packages/store-worker/src/storage/cleanup.ts`
- Test: `src/web/packages/store-worker/tests/cleanup.spec.ts`

**Interfaces:**
- Produces: `cleanupPending(env, now): Promise<{deletedObjects:number; deletedRows:number}>`; scheduled handler on `*/15 * * * *`; unfinalized rows older than one hour delete their objects; rows older than seven days are pruned.

- [ ] **Step 1: Write failing tests**

An unfinalized upload older than one hour has its object deleted and stays as a row until the seven-day prune. A finalized upload is never deleted. A pending upload younger than one hour is untouched.

- [ ] **Step 2: Verify they fail**

Run: `npm run test:worker -- --run tests/cleanup.spec.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

Add the cleanup function and `scheduled` export; add the cron trigger.

- [ ] **Step 4: Run and commit**

Run: `npm run test:worker -- --run tests/cleanup.spec.ts`
Expected: PASS.

```bash
git add src/web/packages/store-worker/src/index.ts src/web/packages/store-worker/src/storage/cleanup.ts src/web/packages/store-worker/tests/cleanup.spec.ts src/web/packages/store-worker/wrangler.toml
git commit -m "feat(store): delete abandoned pending uploads"
```

### Task 6.5: Bound Worker input and tighten auth

**Files:**
- Modify: `src/web/packages/store-worker/src/routes/me.ts`
- Modify: `src/web/packages/store-worker/src/auth/owner.ts`
- Modify: `src/web/packages/store-worker/src/auth/session.ts`
- Modify: `src/web/packages/store-worker/src/index.ts`
- Modify: `src/web/packages/store-worker/src/auth.ts`
- Test: `src/web/packages/store-worker/tests/finalize.spec.ts`
- Test: `src/web/packages/store-worker/tests/admin.spec.ts`
- Test: `src/web/packages/store-worker/tests/auth.spec.ts`

**Interfaces:**
- Produces: `MAX_JSON_BODY = 256 * 1024`, `MAX_THUMBNAIL_BASE64 = 2 * 1024 * 1024 * 4/3 + 4`, `MAX_ITEM_NAME_BYTES = 200`; the envelope is capped at the existing theme-file bound; `Session.emailVerified: boolean`; constant-time `MIGRATE_TOKEN` compare; `TEST_MODE` refused when `BETTER_AUTH_URL` is not a test origin.

- [ ] **Step 1: Write failing tests**

An oversized finalize body answers 413 before parse. A thumbnail whose base64 is over the cap answers 413 before `atob` (spy). An envelope over the theme-file bound answers 413. A 201-byte name answers 400. An unverified email is not owner. A wrong migrate token is refused in constant time (spy on `timingSafeEqual`). `TEST_MODE=1` with a production URL refuses.

- [ ] **Step 2: Verify they fail**

Run: `npm run test:worker -- --run tests/finalize.spec.ts tests/admin.spec.ts tests/auth.spec.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

Add the caps before decoding, carry `emailVerified`, compare with `crypto.subtle.timingSafeEqual` after length check, and refuse TEST_MODE outside tests.

- [ ] **Step 4: Run and commit**

Run: `npm run test:worker -- --run tests/finalize.spec.ts tests/admin.spec.ts tests/auth.spec.ts`
Expected: PASS.

```bash
git add src/web/packages/store-worker/src/routes/me.ts src/web/packages/store-worker/src/auth/owner.ts src/web/packages/store-worker/src/auth/session.ts src/web/packages/store-worker/src/index.ts src/web/packages/store-worker/src/auth.ts src/web/packages/store-worker/tests
git commit -m "fix(store): bound input and tighten owner and migrate auth"
```

### Task 6.6: Batch listings and cache the public index

**Files:**
- Modify: `src/web/packages/store-worker/src/routes/me.ts`
- Modify: `src/web/packages/store-worker/src/routes/admin.ts`
- Modify: `src/web/packages/store-worker/src/routes/public.ts`
- Modify: `src/web/packages/store-worker/src/db/items.ts`
- Test: `src/web/packages/store-worker/tests/mine.spec.ts`
- Test: `src/web/packages/store-worker/tests/admin.spec.ts`
- Test: `src/web/packages/store-worker/tests/public.spec.ts`

**Interfaces:**
- Produces: one query for latest versions per listing; author email joined into the queue query; `/index.json` served from `caches.default` with the existing window and a 60 s TTL.

- [ ] **Step 1: Write failing tests**

A 20-item author list performs at most two D1 queries (spy). A 50-item admin queue performs at most two. A second `/index.json` request is a cache hit and performs no D1 query.

- [ ] **Step 2: Verify they fail**

Run: `npm run test:worker -- --run tests/mine.spec.ts tests/admin.spec.ts tests/public.spec.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

Reuse the batched latest-version join; join `user.email`; wrap the index build in `caches.default.match/put`.

- [ ] **Step 4: Run and commit**

Run: `npm run test:worker -- --run tests/mine.spec.ts tests/admin.spec.ts tests/public.spec.ts`
Expected: PASS.

```bash
git add src/web/packages/store-worker/src/routes/me.ts src/web/packages/store-worker/src/routes/admin.ts src/web/packages/store-worker/src/routes/public.ts src/web/packages/store-worker/src/db/items.ts src/web/packages/store-worker/tests
git commit -m "perf(store): batch listing queries and cache the public index"
```

---

## Phase 7 — Secrets, sessions and TLS

### Task 7.1: Add the encrypted secret store

**Files:**
- Create: `src/web/packages/host/src/settings/secret-store.ts`
- Create: `src/web/packages/host/src/settings/os-key-protector.ts`
- Test: `src/web/packages/host/src/settings/secret-store.test.ts`

**Interfaces:**
- Produces: `createSecretStore(directory, protector?): { read(name): Promise<Buffer|undefined>; write(name, bytes): Promise<void>; remove(name): Promise<void>; available(): Promise<boolean> }`; `createOsKeyProtector(): KeyProtector` with `wrap`/`unwrap`; AES-256-GCM with a random 12-byte IV and a 16-byte tag per file.

- [ ] **Step 1: Write failing tests**

Round-trip every byte length 0..255. A tampered ciphertext throws. Two stores in one directory share the same wrapped key and can read each other's files. With an unavailable protector, `write` refuses and no file is created.

- [ ] **Step 2: Verify they fail**

Run: `npx vitest run packages/host/src/settings/secret-store.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

Generate `secret.key`, wrap it with DPAPI on Windows (`[System.Security.Cryptography.ProtectedData]::Protect` via a `powershell` child with stdin/stdout base64) or `secret-tool` on Linux; cache the unwrapped key in memory. Encrypt/decrypt with `node:crypto`.

- [ ] **Step 4: Run and commit**

Run: `npx vitest run packages/host/src/settings/secret-store.test.ts`
Expected: PASS.

```bash
git add src/web/packages/host/src/settings/secret-store.ts src/web/packages/host/src/settings/os-key-protector.ts src/web/packages/host/src/settings/secret-store.test.ts
git commit -m "feat(host): encrypt secrets with an OS-wrapped key"
```

### Task 7.2: Move credentials, store session, sources and the CA key into it

**Files:**
- Modify: `src/web/packages/host/src/settings/credentials.ts`
- Modify: `src/web/packages/host/src/settings/store-session.ts`
- Modify: `src/web/packages/host/src/settings/sources.ts`
- Modify: `src/web/packages/host/src/tls/authority.ts`
- Test: `src/web/packages/host/src/settings/credentials.test.ts`
- Test: `src/web/packages/host/src/settings/store-session.test.ts`
- Test: `src/web/packages/host/src/tls/authority.test.ts`

**Interfaces:**
- Consumes: `createSecretStore`.
- Produces: each file's existing public API unchanged; legacy plaintext is read, encrypted and removed once.

- [ ] **Step 1: Write failing tests**

A legacy plaintext credentials file is migrated and the plaintext file is gone. A read after restart returns the same credentials. A CA private key round-trips and is never written in PEM plaintext. `sources.json` literal secrets are unreadable without the protector.

- [ ] **Step 2: Verify they fail**

Run: `npx vitest run packages/host/src/settings/credentials.test.ts packages/host/src/settings/store-session.test.ts packages/host/src/tls/authority.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

Route all reads/writes through the secret store; keep atomic rename and the existing shapes inside the encrypted payload.

- [ ] **Step 4: Run and commit**

Run: `npx vitest run packages/host/src/settings packages/host/src/tls`
Expected: PASS.

```bash
git add src/web/packages/host/src/settings/credentials.ts src/web/packages/host/src/settings/store-session.ts src/web/packages/host/src/settings/sources.ts src/web/packages/host/src/tls/authority.ts src/web/packages/host/src/settings/*.test.ts src/web/packages/host/src/tls/authority.test.ts
git commit -m "feat(host): encrypt credentials, store session, sources and CA key"
```

### Task 7.3: Move the display token into an HttpOnly cookie

**Files:**
- Modify: `src/web/packages/host/src/server.ts`
- Modify: `src/web/packages/player/src/session.ts`
- Modify: `src/web/packages/host/public/pair.html`
- Test: `src/web/packages/host/src/server.test.ts`
- Test: `src/web/packages/player/src/session.test.ts`

**Interfaces:**
- Produces: `POST /api/session` sets `yunari_session` and redirects without the token; `tokenFor` reads header then cookie; a root `?session=` is exchanged once; `/api/*` and `/ws` refuse a query token; `withToken(url)` returns the URL unchanged.

- [ ] **Step 1: Write failing tests**

The pair POST answers 302 to a URL with no token and a `Set-Cookie` with `HttpOnly; SameSite=Strict`. A request with only `?session=` to `/api/published` answers 403. A cookie-authenticated request succeeds. The root route with `?session=` answers 302 and sets the cookie.

- [ ] **Step 2: Verify they fail**

Run: `npx vitest run packages/host/src/server.test.ts packages/player/src/session.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

Parse the cookie header in `tokenFor`; add the route and the one-time root exchange; remove token appending from the player.

- [ ] **Step 4: Run and commit**

Run: `npx vitest run packages/host/src/server.test.ts packages/player/src/session.test.ts`
Expected: PASS.

```bash
git add src/web/packages/host/src/server.ts src/web/packages/host/public/pair.html src/web/packages/player/src/session.ts src/web/packages/host/src/server.test.ts src/web/packages/player/src/session.test.ts
git commit -m "feat(host): exchange the display token for an HttpOnly cookie"
```

### Task 7.4: Print the CA fingerprint

**Files:**
- Modify: `src/web/packages/host/src/tls/authority.ts`
- Modify: `src/web/packages/host/src/main.ts`
- Modify: `src/web/packages/host/src/server.ts`
- Test: `src/web/packages/host/src/tls/authority.test.ts`
- Test: `src/web/packages/host/src/server.test.ts`

**Interfaces:**
- Produces: `certificateFingerprintSha256(pem: string): string`; the certificate route sends `x-yunari-ca-sha256`; startup output prints the same value.

- [ ] **Step 1: Write failing tests**

The fingerprint is 64 lowercase hex characters, stable for one certificate, and matches the route header. Startup output contains it.

- [ ] **Step 2: Verify they fail**

Run: `npx vitest run packages/host/src/tls packages/host/src/server.test.ts -t "fingerprint"`
Expected: FAIL.

- [ ] **Step 3: Implement**

Hash the DER with `X509Certificate.raw`; print and serve it; update the pairing instructions to require the comparison.

- [ ] **Step 4: Run and commit**

Run: `npx vitest run packages/host/src/tls packages/host/src/server.test.ts`
Expected: PASS.

```bash
git add src/web/packages/host/src/tls/authority.ts src/web/packages/host/src/main.ts src/web/packages/host/src/server.ts src/web/packages/host/src/tls/authority.test.ts src/web/packages/host/src/server.test.ts src/web/packages/host/public/pair.html
git commit -m "feat(host): publish the CA fingerprint for out-of-band trust"
```

---

## Phase 8 — Supply chain, release and close

### Task 8.1: Pin published versions and check notices

**Files:**
- Modify: `scripts/stage-npm-package.mjs`
- Create: `scripts/check-third-party.mjs`
- Modify: `THIRD-PARTY-NOTICES.md`
- Modify: `src/web/package.json`
- Test: `src/web/tests/scripts/stage-npm-package.test.ts`
- Test: `scripts/check-third-party.mjs` self-test

**Interfaces:**
- Produces: `runtimeDependencies()` writes exact versions; `check-third-party.mjs` compares installed names/versions/licences to `THIRD-PARTY-NOTICES.md` and exits non-zero on drift.

- [ ] **Step 1: Write failing tests**

A staged manifest contains `"culori": "x.y.z"`, not `"^x.y.z"`. A notice missing a direct dependency's version fails; a correct file passes.

- [ ] **Step 2: Verify they fail**

Run: `npx vitest run tests/scripts/stage-npm-package.test.ts` and `node scripts/check-third-party.mjs`
Expected: FAIL.

- [ ] **Step 3: Implement**

Emit exact versions, generate/check notices, and add `third-party:check` to `package.json` and the gate plus `gates:self-test`.

- [ ] **Step 4: Run and commit**

Run: `npm run third-party:check && npx vitest run tests/scripts/stage-npm-package.test.ts`
Expected: PASS.

```bash
git add scripts/stage-npm-package.mjs scripts/check-third-party.mjs THIRD-PARTY-NOTICES.md src/web/package.json src/web/tests/scripts/stage-npm-package.test.ts
git commit -m "chore(release): pin staged versions and check notices"
```

### Task 8.2: Harden the publish workflow and pin actions

**Files:**
- Modify: `.github/workflows/publish.yml`
- Modify: `.github/workflows/release.yml`
- Test: `scripts/check-workflows.mjs` (new self-test)

**Interfaces:**
- Produces: `permissions: contents: read` on install/gate; a publish job with `id-token: write`; `persist-credentials: false`; non-dry dispatch refused unless `github.ref` starts with `refs/tags/v`; every `uses:` pinned to a 40-character SHA.

- [ ] **Step 1: Write the failing check**

A parser test asserts each workflow's job permissions, the checkout options, the tag guard and that no `uses:` names a mutable tag.

- [ ] **Step 2: Verify it fails**

Run: `node scripts/check-workflows.mjs`
Expected: FAIL.

- [ ] **Step 3: Resolve and pin action SHAs**

Run: `gh api repos/actions/checkout/git/ref/tags/v4`, `gh api repos/actions/setup-node/git/ref/tags/v4`, `gh api repos/googleapis/release-please-action/git/ref/tags/v5` and resolve each to its commit SHA. Pin all actions.

- [ ] **Step 4: Implement the workflow split and tag guard**

Run: `node scripts/check-workflows.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/publish.yml .github/workflows/release.yml scripts/check-workflows.mjs
git commit -m "ci(release): least-privilege publish and SHA-pinned actions"
```

### Task 8.3: Resolve advisories and the npm tree

**Files:**
- Modify: `src/web/package.json`
- Modify: `src/web/package-lock.json` (via npm)
- Modify: `docs/engineering/audit-allowlist.json`
- Modify: `docs/engineering/dependencies.md`
- Test: `npm run audit:check`, `npm ls --all`

**Interfaces:**
- Produces: no production advisory outside the allowlist with an honest reason; `npm ls --all` exit 0.

- [ ] **Step 1: Reproduce**

Run: `npm audit --omit=dev` and `npm ls --all` from `src/web/`
Expected: zod advisory and `ELSPROBLEMS`.

- [ ] **Step 2: Fix the overrides**

Add `"zod": "^4.6.6"` to overrides; re-resolve `sharp`/`undici` to versions the Worker toolchain accepts, or remove the override when the advisory is gone. Run `npm install`.

- [ ] **Step 3: Prove**

Run: `npm audit --omit=dev && npm run audit:check && npm ls --all`
Expected: exit 0 and no unallowlisted production advisory. Update the allowlist with the real reasons; remove the false dev-only zod claim.

- [ ] **Step 4: Run the suites**

Run: `npm run test:worker && npx vitest run`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/web/package.json src/web/package-lock.json docs/engineering/audit-allowlist.json docs/engineering/dependencies.md
git commit -m "chore(deps): resolve advisories and restore a valid npm tree"
```

### Task 8.4: Verify the ffmpeg binary

**Files:**
- Create: `ffmpeg-static-hashes.json`
- Create: `scripts/verify-ffmpeg.mjs`
- Modify: `src/web/packages/host/package.json`
- Test: `scripts/verify-ffmpeg.mjs` self-test

**Interfaces:**
- Produces: a committed map `{ "win32-x64": "<sha256>", ... }` for every platform the host supports; `verifyFfmpeg(binaryPath, platform)` returns `{ok:true}` or a refusal naming the expected/actual hash.

- [ ] **Step 1: Collect hashes**

For each supported platform, download the `ffmpeg-static@5.3.0` release asset and record its SHA-256. At minimum `win32-x64`; refuse a platform absent from the map rather than executing an unverified binary.

- [ ] **Step 2: Write the failing test**

A fixture whose bytes do not match the map is refused; the real installed binary on this platform passes.

- [ ] **Step 3: Implement**

Add `scripts/verify-ffmpeg.mjs` and a host `postinstall`/startup check that refuses playback when the hash does not match. Update `docs/engineering/dependencies.md`.

- [ ] **Step 4: Run and commit**

Run: `node scripts/verify-ffmpeg.mjs && npx vitest run packages/host/src`
Expected: PASS.

```bash
git add ffmpeg-static-hashes.json scripts/verify-ffmpeg.mjs src/web/packages/host/package.json docs/engineering/dependencies.md
git commit -m "chore(host): verify the ffmpeg binary before use"
```

### Task 8.5: Close the plan

**Files:**
- Modify: `STATUS.md`
- Modify: `docs/superpowers/specs/2026-10-25-performance-security-hardening-design.md`
- Move: `docs/superpowers/plans/2026-10-25-performance-security-hardening.md` to `docs/superpowers/plans/archive/`

**Interfaces:**
- Consumes: every phase's exit codes.
- Produces: a closed plan, a current STATUS, and the final gate evidence.

- [ ] **Step 1: Run the full gate**

Run: `npm run gate` in `src/web/` and `npm run test:worker`
Expected: exit 0. Record file/test counts, skipped count and the Worker count.

- [ ] **Step 2: Run the browser set**

Run: `npx playwright test --workers=1`
Expected: exit 0, or record each failure as a task-reopen reason. Rebuild bundles first.

- [ ] **Step 3: Verify the red proofs**

Confirm each phase's commit body names the test that fails when the fix is removed, and that at least one security and one performance fix were re-broken and restored with `cmp` (not git).

- [ ] **Step 4: Update STATUS and close**

Replace "Last completed change" with five bullets from this plan. Mark the spec closed and the plan archived. Run `npm run status:check && npm run docs:check && npm run backlog:check`.

- [ ] **Step 5: Commit**

```bash
git add STATUS.md docs/superpowers/specs/2026-10-25-performance-security-hardening-design.md docs/superpowers/plans/2026-10-25-performance-security-hardening.md docs/superpowers/plans/archive/
git commit -m "docs: close the performance and security hardening plan"
```
