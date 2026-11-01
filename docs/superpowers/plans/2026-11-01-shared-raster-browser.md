# Shared Raster Browser Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Drive every connected hardware panel from one Chromium process while keeping each panel's page, geometry, cadence, still encoding, overlay mode and driver quirks independent.

**Architecture:** `panel-raster.ts` keeps the per-page renderer and its CDP client; `panel-raster-browser.ts` owns one Chromium child, one profile, the browser-level CDP connection, and one `newWindow: true` target per panel; `panel-manager.ts` owns one `RasterBrowser` and asks it for a rasterizer per panel.

**Tech Stack:** TypeScript, Node 22 `child_process`/`WebSocket`, Chrome DevTools Protocol, Vitest. No dependency is added.

**Spec:** `docs/superpowers/specs/2026-11-01-shared-raster-browser-design.md`

## Global Constraints

- No new runtime dependency and no change to `THIRD-PARTY-NOTICES.md`.
- No change to `PanelDevice`, `PanelRunner`, `panel-page.ts`, or the player.
- No runtime feature flag and no compatibility path: the per-panel browser is replaced.
- Every panel target is created with `Target.createTarget({ url: "about:blank", newWindow: true })`. A tab is hidden and does not composite.
- One browser process, one `--user-data-dir` profile under `os.tmpdir()`, removed best-effort after exit.
- The browser flags are exactly `--headless=new`, `--remote-debugging-port=0`, `--user-data-dir=<profile>`, `--no-first-run`, `--no-default-browser-check`, `--disable-extensions`, `--disable-background-networking`, `--hide-scrollbars`, `--force-device-scale-factor=1`, `--disable-background-timer-throttling`, `--disable-backgrounding-occluded-windows`, `--disable-renderer-backgrounding`, then `about:blank`.
- Idle stop defaults to `5_000` ms; an explicit `stop()` stops immediately; `stop()` is idempotent and bounds the child-exit wait at `5_000` ms.
- One browser, one target per panel, default browser context. No per-target browser context; panel pages are unpaired loopback pages.
- Per-panel failures stay on the display's existing `report` path. Only an asynchronous browser failure goes to `onBrowserError`.
- Run npm commands from `src/web/`. `npm run gate` must exit 0 without network access.
- Comments state the current invariant and why it holds; no ticket or history narration.

## Review Focus

- `create()` called after `stop()` or while `stop()` is draining: it must reject with a stated reason, never attach to the closing browser.
- Concurrent `create()` calls: one browser start, one process, one target per call.
- Last rasterizer closes: the browser survives until the idle deadline, a new `create()` before the deadline cancels the stop.
- Child exit with requests in flight: the devtools client settles pending sends immediately, and the browser reports the exit once.
- Target creation or page setup fails: the target is closed and the idle stop is armed so no browser is left with no panel.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/web/packages/host/src/panels/panel-raster.ts` | CDP client, browser spawn/arguments, and one page's rasterizer (`createPageRasterizer`). No browser or profile lifetime. |
| `src/web/packages/host/src/panels/panel-raster-browser.ts` | The shared Chromium child and profile, browser-level `Target.*` calls, target lifecycle, active count, idle stop, crash state. |
| `src/web/packages/host/src/panels/panel-manager.ts` | One `RasterBrowser` for all panels; per-display runners and ordering are unchanged. |
| `src/web/packages/host/src/main.ts` | Wires the browser-level error reporter to `console.error`. |
| `docs/decisions/0078-shared-raster-browser.md` | Reuse-gate evidence and exact path claims, written before any watched edit. |
| `docs/architecture.md` | States the shared runtime and one headless window per display. |

---

### Task 1: Record the reuse-gate decision

**Files:**
- Create: `docs/decisions/0078-shared-raster-browser.md`

**Interfaces:**
- Consumes: the spec's `Reuse-gate evidence` section.
- Produces: exact `Paths:` claims that unblock writes under `src/web/packages/host/src/panels/`.

- [ ] **Step 1: Write the decision note**

Use the template in `docs/decisions/README.md`. The header is:

```markdown
# 0078 — one shared Chromium runtime for USB panels

- **Date:** 2026-11-01
- **Status:** accepted
- **Paths:** `src/web/packages/host/src/panels/panel-raster-browser.ts`
  `src/web/packages/host/src/panels/panel-raster.ts`
  `src/web/packages/host/src/panels/panel-manager.ts`
```

Fill rungs 1–6 and the decision from the spec's `Reuse-gate evidence` section. State
the measured process tree (browser + GPU is 982.6 MB of 1,748.3 MB at three
panels), the `newWindow: true` visibility result, and the rejected options with
their reasons. Do not add files beyond the three claims.

- [ ] **Step 2: Verify the hook accepts the claims**

Run from the repository root:

```bash
echo '{"tool_input":{"file_path":"src/web/packages/host/src/panels/panel-raster-browser.ts"}}' | node scripts/reuse-gate.mjs
echo "exit=$?"
```

Expected: `exit=0` (the first command prints nothing).

- [ ] **Step 3: Commit**

```bash
git add docs/decisions/0078-shared-raster-browser.md
git commit -m "docs(decisions): authorise the shared raster browser

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 2: Make the rasterizer own one page

**Files:**
- Modify: `src/web/packages/host/src/panels/panel-raster.ts`
- Test: `src/web/packages/host/src/panels/panel-raster.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces:

```ts
export interface RasterPageOptions {
  readonly url: string;
  readonly geometry: PanelGeometry;
  readonly stillFormat?: "jpeg" | "png";
}

export interface Devtools {
  send(method: string, params?: Record<string, unknown>): Promise<CdpReply>;
  on(method: string, listener: (params: Record<string, unknown>) => void): void;
  close(): void;
}

export async function connectDevtools(url: string): Promise<Devtools>;
export async function startBrowser(
  executable: string,
  profile: string,
): Promise<{ readonly child: ChildProcess; readonly endpoint: string }>;
export function chromiumArguments(profile: string): readonly string[];
export async function createPageRasterizer(
  devtools: Devtools,
  options: RasterPageOptions,
  closePage: () => Promise<void>,
): Promise<Rasterizer>;
```

`createPageRasterizer` is async because it owns `Page.enable`,
`Emulation.setDeviceMetricsOverride`, `Page.navigate` and `waitForScene`: a setup
failure must reject the panel's `create` rather than surface on the first
capture. Remove `RasterOptions` and `createRasterizer`; keep `Rasterizer`,
`startScreencast`, `Screencast`, `LiveFrame`, `setOverlayMode` and `CdpReply`.

- [ ] **Step 1: Extend the test fake and add the failing tests**

In `panel-raster.test.ts`, add `close()` to the fake `Devtools` (record that it
was called) and import `chromiumArguments`, `connectDevtools`,
`createPageRasterizer`. Give the fake a per-method reply map so
`Runtime.evaluate` can answer the scene poll with
`{ result: { result: { type: "boolean", value: true } } }`.

Add these cases:

```ts
it("starts one browser with the panel flags", () => {
  expect(chromiumArguments("C:/tmp/yunari-raster-1")).toEqual([
    "--headless=new",
    "--remote-debugging-port=0",
    "--user-data-dir=C:/tmp/yunari-raster-1",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-extensions",
    "--disable-background-networking",
    "--hide-scrollbars",
    "--force-device-scale-factor=1",
    "--disable-background-timer-throttling",
    "--disable-backgrounding-occluded-windows",
    "--disable-renderer-backgrounding",
    "about:blank",
  ]);
});
```

```ts
it("navigates the page at the panel geometry before returning", async () => {
  // createPageRasterizer(fake, { url: "http://127.0.0.1:1/?display=strip",
  //   geometry: { width: 800, height: 480 } }, async () => {})
  // assert sent methods start with Page.enable, then
  // Emulation.setDeviceMetricsOverride({ width: 800, height: 480,
  //   deviceScaleFactor: 1, mobile: false }), then Page.navigate to the URL.
});
```

```ts
it("closes its page, target and socket, leaving the browser alone", async () => {
  // Push a screencast frame and call capture() once, then close().
  // Expect Page.stopScreencast, closePage called once, fake.close called once,
  // and no Target.* request from this rasterizer.
});
```

```ts
it("rejects a pending send when the devtools socket closes", async () => {
  // Stub global WebSocket with a fake class that dispatches "open" on a
  // microtask and exposes close(). connectDevtools("ws://fake/devtools/page/1"),
  // start send("Page.enable") with no reply, close the socket, and race the
  // rejection against a 100 ms timer; expect "rejected".
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run from `src/web/`:

```bash
npx vitest run packages/host/src/panels/panel-raster.test.ts
```

Expected: FAIL — `chromiumArguments`, `connectDevtools` and
`createPageRasterizer` are not exported.

- [ ] **Step 3: Implement the page-level rasterizer**

In `panel-raster.ts`:

1. Replace `RasterOptions` with `RasterPageOptions`.
2. Add `close(): void` to `Devtools`.
3. Give `BrowserDevtools` a private `shutdown(message)` that sets `closed`,
   settles and rejects every pending request, and clears the map. The socket
   `close` listener and `close()` both call it; `close()` then calls
   `socket.close()`. This is the one CDP-client change: a crashed browser must
   not leave every panel waiting for the 5 s reply timeout.
4. Export `connectDevtools(url)` returning `BrowserDevtools.connect(url)`.
5. Export `chromiumArguments(profile)` with the exact flag order in Global
   Constraints.
6. Export `startBrowser(executable, profile)`; it spawns with
   `chromiumArguments(profile)` and the existing stdio/`windowsHide` options,
   then awaits the existing endpoint reader.
7. Convert `createRasterizer` into `createPageRasterizer(devtools, options,
   closePage)`: keep the existing `Page.enable`, device metrics, `Page.navigate`
   and `waitForScene` sequence at the top, then the existing capture closure.
   Delete the `mkdtemp`, spawn, endpoint and `fetch("/json/new")` code.
8. `close()` keeps stopping the screencast and closing the devtools socket, and
   adds `await closePage().catch(() => {})` (best-effort) between them. It must
   not kill any child or remove any profile.

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npx vitest run packages/host/src/panels/panel-raster.test.ts
```

Expected: PASS, every existing screencast/overlay case plus the four new cases.

- [ ] **Step 5: Commit**

```bash
git add src/web/packages/host/src/panels/panel-raster.ts src/web/packages/host/src/panels/panel-raster.test.ts
git commit -m "refactor(host): scope the rasterizer to one page

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 3: Add the shared raster browser

**Files:**
- Create: `src/web/packages/host/src/panels/panel-raster-browser.ts`
- Test: `src/web/packages/host/src/panels/panel-raster-browser.test.ts`

**Interfaces:**
- Consumes from Task 2: `connectDevtools`, `createPageRasterizer`, `startBrowser`,
  `Devtools`, `RasterPageOptions`, `Rasterizer`.
- Produces:

```ts
export interface TargetHandle {
  readonly targetId: string;
  readonly webSocketDebuggerUrl: string;
}

export interface RasterBrowser {
  create(options: RasterPageOptions): Promise<Rasterizer>;
  stop(): Promise<void>;
  readonly closed: boolean;
}

export interface RasterBrowserOptions {
  readonly executable: string;
  readonly onError?: (message: string) => void;
  readonly idleStopMs?: number;
  readonly spawn?: typeof startBrowser;
  readonly connect?: typeof connectDevtools;
  readonly openTarget?: (browser: Devtools) => Promise<TargetHandle>;
  readonly closeTarget?: (
    browser: Devtools,
    targetId: string,
  ) => Promise<void>;
}

export function createRasterBrowser(options: RasterBrowserOptions): RasterBrowser;
```

- [ ] **Step 1: Write the failing tests**

Create `panel-raster-browser.test.ts` (Node environment). Build a harness:

- `fakeSpawn` returns `{ child, endpoint: "ws://127.0.0.1:9222/devtools/browser/abc" }`
  and records the profile argument. The fake child has `exitCode: null`,
  `once("exit", …)`, `off`, and `kill()` that sets `exitCode = 0` and emits
  `"exit"`.
- `fakeConnect(url)` records the URL and returns a fake `Devtools` keyed by URL.
  Browser clients answer `Target.createTarget` with
  `{ result: { targetId: "T1" } }`, `"T2"`, …; page clients answer
  `Runtime.evaluate` with `{ result: { result: { value: true } } }`. A harness
  flag can make `Page.navigate` reject, and a deferred can hold the page
  connection open.
- `idleStopMs` is small (e.g. `50`) with `vi.useFakeTimers()` per case.

Write these cases:

- `"starts one browser for concurrent creates"` — two `create()` calls; spawn
  called once, browser-endpoint connect called once, two targets opened.
- `"opens every target as its own headless window"` — the browser client sent
  `Target.createTarget` with exactly `{ url: "about:blank", newWindow: true }`,
  and the second connect URL is
  `ws://127.0.0.1:9222/devtools/page/T1`.
- `"gives each page its own geometry and URL"` — two creates with distinct
  geometry/url; each page client sent its own
  `Emulation.setDeviceMetricsOverride` and `Page.navigate`.
- `"closes its target and arms the idle stop when setup fails"` — make
  `Page.navigate` reject; `create()` rejects, the browser client sent
  `Target.closeTarget` for that target, and advancing the idle deadline kills
  the child.
- `"keeps the browser while another rasterizer is active"` — create two, close
  one, advance well past the deadline, child not killed; close the second and
  advance the deadline, child killed.
- `"stops the browser after the idle deadline when the last rasterizer closes"`
  — one create, close, advance `idleStopMs - 1` (open), advance 1 more (stopped).
- `"cancels the idle stop when a create arrives before the deadline"` — close
  the last rasterizer, advance `idleStopMs - 1`, create again, advance past the
  deadline; child not killed and the new target exists.
- `"stops once, removes the profile, and makes later creates fail"` — two
  concurrent `stop()` calls return the same promise; `closed` is true; the
  recorded profile no longer exists; a later `create()` rejects with
  `/closed/`.
- `"reports a child exit once and refuses the next create"` — after a create,
  emit `"exit"` with code 1 twice; `onError` called once with `/exited/`,
  `closed` true, next `create()` rejects with `/closed/`.
- `"fails a create that resumes after stop"` — hold the page connection on a
  deferred, call `create()`, call `stop()`, release the connection; `create()`
  rejects with `/closed/` and the target is closed.

- [ ] **Step 2: Run the tests to see them fail**

Run from `src/web/`:

```bash
npx vitest run packages/host/src/panels/panel-raster-browser.test.ts
```

Expected: FAIL — the module does not exist.

- [ ] **Step 3: Implement `createRasterBrowser`**

Constants: `IDLE_STOP_MS = 5_000`, `EXIT_TIMEOUT_MS = 5_000`.

State: `child`, `profile`, `endpoint`, `browser: Devtools | undefined`,
`starting: Promise<Devtools> | undefined`, `idle` timer, `closed`, `active`,
`stopping: Promise<void> | undefined`, `failureReported`.

Implementation requirements:

1. **Defaults.** `spawn = options.spawn ?? startBrowser`,
   `connect = options.connect ?? connectDevtools`,
   `closeTarget = options.closeTarget ?? ((b, id) => b.send("Target.closeTarget", { targetId: id }))`.
   The default `openTarget` closure sends `Target.createTarget` with
   `{ url: "about:blank", newWindow: true }`, reads `result.targetId` (throw
   `"the browser opened no target for the panel"` when absent), and derives the
   page socket by copying the browser endpoint URL and setting its pathname to
   `/devtools/page/<targetId>`.
2. **Start, single-flight.** `starting ??= (async () => { mkdtemp under
   os.tmpdir() with prefix "yunari-raster-"; spawn; record child and endpoint;
   connect; record browser client; return it })()`. After each await, throw
   `new Error("The raster browser is closed.")` when `closed`. On failure, kill
   the child, remove the profile, clear `starting`, and rethrow.
3. **Crash watcher.** Register `child.once("exit", …)` only after the start
   promise resolves successfully. When `stopping` is undefined and not already
   closed: mark closed, clear the idle timer, close the browser-level client,
   report once `` `the shared browser exited with ${code ?? "no code"}` `` and
   best-effort remove the profile.
4. **Create.** Reject when closed. Cancel the idle timer, await the single
   start, then: `assertOpen`; `openTarget`; `assertOpen`; `connect` to the
   target socket; `assertOpen`; `createPageRasterizer(devtools, options, () =>
   closeTarget(client, target.targetId))`; `assertOpen`. On success increment
   `active`, cancel the idle timer, and return a wrapper.
5. **Wrapper close.** Idempotent. Await the page rasterizer's `close()`; in a
   `finally`, decrement `active` and arm the idle stop when it reaches 0 and the
   browser is not closed.
6. **Create failure.** Close the page rasterizer when one exists (it closes its
   socket and target). Otherwise close the page socket and best-effort
   `closeTarget` when a target was created. When `active === 0`, a browser
   client exists, and the browser is not closed, arm the idle stop. Rethrow.
7. **Idle stop.** Only arms with `active === 0`, no armed timer, and not closed.
   The callback clears the timer and calls `stop()`. Call `unref()` on the
   timer.
8. **Stop.** Return one shared promise. Synchronously mark closed and clear the
   idle timer; close the browser-level client (pending browser requests reject);
   if the child is alive, attach an exit listener, `kill()`, and resolve on
   exit or after `EXIT_TIMEOUT_MS`; best-effort remove the profile. Idempotent
   and safe when the child crashed or never started.
9. `closed` is a getter over the state.

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npx vitest run packages/host/src/panels/panel-raster-browser.test.ts
```

Expected: PASS, all ten cases.

- [ ] **Step 5: Commit**

```bash
git add src/web/packages/host/src/panels/panel-raster-browser.ts src/web/packages/host/src/panels/panel-raster-browser.test.ts
git commit -m "feat(host): share one Chromium across panels

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 4: Route the manager through one browser

**Files:**
- Modify: `src/web/packages/host/src/panels/panel-manager.ts`
- Modify: `src/web/packages/host/src/main.ts:536-581`
- Test: `src/web/packages/host/src/panels/panel-manager.test.ts`

**Interfaces:**
- Consumes from Task 3: `createRasterBrowser`, `RasterBrowser`,
  `RasterBrowserOptions`.
- Produces: `PanelManagerOptions` gains
  `rasterBrowserFactory?: (options: RasterBrowserOptions) => RasterBrowser` and
  `onBrowserError?: (message: string) => void`. `PanelManager` is unchanged.

- [ ] **Step 1: Switch the test harness to an injected browser factory**

In `panel-manager.test.ts`:

1. Delete `vi.mock("./panel-raster.js", …)`; keep the `panel-families` and
   `display-launcher` mocks.
2. Extend the hoisted helper with `browsers` and `events` arrays and reset them
   (plus the default `rasterizer`) in `beforeEach`.
3. Add a `storeOver(records)` helper and a second record `TOWER`.
4. Add `fakeBrowser(events)`: `closed: false`, `create` recording the call and
   returning `h.rasterizer()`, `stop` setting `closed = true` and pushing
   `"browser:stop"`.
5. `managerOver` passes `rasterBrowserFactory: () => { … h.browsers.push(b);
   return b; }` before the overrides.

Add these cases:

```ts
it("shares one browser across two panels", async () => {
  // Start "strip" and "tower"; h.browsers.length === 1; its create called twice.
});

it("stops the browser after the runners on shutdown", async () => {
  // Device close pushes "close:<name>"; stopAll; expect h.events to end with
  // "browser:stop" and every close to appear before it.
});

it("replaces a closed browser on the next panel start", async () => {
  // start, stop, set h.browsers[0].closed = true, start again;
  // h.browsers.length === 2 and the second browser's create ran.
});
```

- [ ] **Step 2: Run the tests to see them fail**

```bash
npx vitest run packages/host/src/panels/panel-manager.test.ts
```

Expected: FAIL — the manager still imports `createRasterizer`, and the new cases
cannot find two browsers.

- [ ] **Step 3: Change the manager**

1. Replace the `createRasterizer` import with
   `import type { Rasterizer } from "./panel-raster.js";` and
   `import { createRasterBrowser, type RasterBrowser, type RasterBrowserOptions } from "./panel-raster-browser.js";`.
2. Add the two options with the comments from the spec (browser failure is
   reported once; per-panel failures keep `onError`).
3. Keep one field, `let rasterBrowser: RasterBrowser | undefined`. Add
   `rasterBrowserFor(executable)`: return the current browser when it exists and
   is not closed; otherwise build one with
   `options.rasterBrowserFactory ?? createRasterBrowser`, passing `executable`
   and `onError: options.onBrowserError` only when defined.
4. In `run()`, keep the existing `findBrowser` refusal, then replace the
   `createRasterizer({ browser, … })` call with
   `rasterBrowserFor(executable).create({ url, geometry, stillFormat? })`.
   `Rasterizer` is the await type.
5. In `stopAll()`, after `entries.clear()`, capture and clear
   `rasterBrowser`, then `await browser?.stop()`. Every runner has already
   stopped through the existing loop.
6. Do not touch the one-chain-per-display ordering, the retry loop, or
   `reconcile`.
7. In `main.ts`, add
   `onBrowserError: (message) => { console.error(\`Raster browser: ${message}\`); },`
   to the `createPanelManager` options, beside `onError`.

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npx vitest run packages/host/src/panels/panel-manager.test.ts
npx vitest run packages/host/src/panels/
```

Expected: PASS, all manager cases and the raster/runner suites.

- [ ] **Step 5: Commit**

```bash
git add src/web/packages/host/src/panels/panel-manager.ts src/web/packages/host/src/panels/panel-manager.test.ts src/web/packages/host/src/main.ts
git commit -m "refactor(host): drive every panel through one raster browser

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 5: Document the runtime and pass the gate

**Files:**
- Modify: `docs/architecture.md:55-75`

- [ ] **Step 1: Update the panel section**

Keep the existing bullets for `panel-device.ts` and `panel-families.ts`. Replace
the `panel-manager.ts` bullet with:

```markdown
- `panel-manager.ts` owns one serialized runner per display. It opens attached
  hardware, coordinates start/stop/refresh, and owns cadence.
- One `panel-raster-browser.ts` Chromium runtime serves every panel: one profile,
  one target per display, each target its own headless window. `panel-raster.ts`
  captures one display's page through that target. The browser stops after the
  last panel closes.
```

- [ ] **Step 2: Run the full gate**

Run from `src/web/` and confirm the exit code, not a piped tail:

```bash
npm run gate
echo "exit=$?"
```

Expected: `exit=0`, with Biome, script self-tests, docs checks, design checks,
typecheck, unit tests and the Worker suite green.

- [ ] **Step 3: Commit**

```bash
git add docs/architecture.md
git commit -m "docs(host): one Chromium runtime for USB panels

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 6: Hardware probe and measurement

This task needs the real panels, a host restarted after boot, and no other host
running. It produces recorded evidence, not code. Do not mark it complete from a
synthetic page.

**Files:**
- Modify: `docs/superpowers/specs/2026-11-01-shared-raster-browser-design.md`
  (`Measurement` section)

- [ ] **Step 1: Run the behavioural probe**

Follow the spec's `Behavioural probe` list: one Kraken still panel at 140 ms and
one video panel at 1 Hz; confirm updates, overlays, rotation and cadence; kill
the shared Chromium and confirm every panel detaches then reopens on the retry
pass; remove one panel's record (browser stays), then the last (browser exits
after the idle deadline).

- [ ] **Step 2: Measure before/after**

Same build, 60 s warm-up and 60 s sample, host restarted, editor closed. Walk
the process tree from the host PID by `ParentProcessId`; private bytes are
`Win32_Process.PrivatePageCount`; CPU is the `UserModeTime` + `KernelModeTime`
delta. Record the 3-panel row and check every pass criterion in the spec:
exactly one Chromium browser, at least four fewer Chromium processes, browser +
GPU private bytes ≤ 459.5 MB, total tree private bytes down ≥ 300 MB, CPU
≤ 51 s/60 s + 5%, and frames accepted per panel ≤ 1% below baseline.

- [ ] **Step 3: Record the result**

Append the after table and the pass/fail line to the spec's `Measurement`
section. If any criterion fails, record it and do not ship; the spec's Risks
table names the split option.

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/specs/2026-11-01-shared-raster-browser-design.md
git commit -m "docs(specs): record shared raster browser measurements

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```
