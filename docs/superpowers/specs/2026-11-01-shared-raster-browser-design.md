# Shared raster browser for concurrent panels

## Goal

Drive every connected hardware panel from one Chromium browser process instead
of one full browser per panel, while keeping each panel's page, geometry,
cadence, still encoding, overlay mode and driver quirks independent.

The change targets background CPU, RAM and GPU cost. Storage cost is not a
concern. Editor resource use is out of scope.

## Non-goals

- No panel driver, protocol, frame cadence or still-format change.
- No change to `PanelDevice`, `PanelRunner`, `panel-page.ts` or the player.
- No WebView2 or Tauri work. The shared browser stays a Node-owned Chromium
  child.
- No Rust host, sensor folding or packaging change.
- No runtime feature flag. The old per-panel browser path is replaced, not kept
  beside the new one.

## Current behaviour and measured cost

`panel-manager.ts` calls `createRasterizer` once per panel. Each call runs
`mkdtemp`, starts a full Chromium with its own `--user-data-dir`, creates one
target, and owns that browser until the panel stops. Three panels therefore run
three browser processes, three GPU processes, and the renderer/utility children
each one spawns.

Clean baseline, 2026-11-01, host started after reboot with three panels (Lian
Li 464x1920 video, TURZX 800x480 video, Kraken Z73 320x320 stills), no local
display windows, editor closed, 60 s warm-up and 60 s sample:

| Kind | Procs | Private MB | CPU s/60 s |
|---|---:|---:|---:|
| Chromium browser | 3 | 227.2 | 6 |
| Chromium GPU | 3 | 755.4 | 23 |
| Chromium renderer | 12 | 427.5 | 17 |
| Chromium utility | 6 | 74.0 | 0 |
| Chromium other | 3 | 19.8 | 0 |
| Node host | 1 | 238.6 | 5 |
| Other | 1 | 5.8 | 0 |
| **Total** | **29** | **1,748.3** | **51** |

Tree CPU was 0.85 cores (8.5 s per 10 s). Two processes exited during the
sample, so CPU is a lower bound. Browser + GPU is 982.6 MB of the total; the
renderers and utilities stay per panel.

The per-panel browser is the dominant cost, not Node and not the panel
renderers themselves.

## Design

### Ownership

- `panel-raster.ts` keeps the per-page renderer: CDP client, `startScreencast`,
  `setOverlayMode`, `shot`, `waitForScene`, and the `Rasterizer` contract.
- A new `panel-raster-browser.ts` owns the shared Chromium process, its profile
  directory, the browser-level CDP client, target creation and the browser's
  lifetime.
- `panel-manager.ts` owns one `RasterBrowser` and asks it for one rasterizer per
  panel. It no longer discovers or starts a browser per panel.
- `main.ts` wires a browser-level error reporter to `console.error`.

### One browser, one target per panel

The browser is one Chromium child with one `--user-data-dir`. Each panel gets a
target created through the browser-level CDP method `Target.createTarget` with
`newWindow: true`, then a target-level devtools connection.

**`newWindow: true` is load-bearing.** A target created as a tab — the default,
and what `/json/new` creates — is `document.visibilityState: "hidden"` in
headless Chrome. A hidden tab does not composite: its screencast emits no
frames and its screenshot calls stall for seconds. A target created as its own
headless window reports `visible`, so both capture paths work at the same time.
Creating the window is the whole difference; no visibility emulation or
lifecycle call substitutes for it (probed below).

Every per-panel capability stays on the target:

| Capability | Scope | Unchanged API |
|---|---|---|
| Page URL and `?display=` | Target | `Page.navigate` |
| Geometry | Target | `Emulation.setDeviceMetricsOverride` |
| Still encoding | Target | `Page.startScreencast` format/quality |
| Frame order and ack | Target | `Screencast.next` |
| Overlay hide/restore | Target | `setOverlayMode` |
| Still capture | Target | `capture()` → `Page.startScreencast` |
| Overlay capture | Target | `captureOverlay()` → `Page.captureScreenshot` |
| Cadence | Runner | `PanelDevice.frameIntervalMs` + `PanelRunner` |

Page DOM and JavaScript context are per target. Storage, the service worker and
the HTTP cache are shared by design, as below; the browser process and its
GPU/network/utility children are shared too.

### Shared default context

All targets share the browser's default context. This is deliberate:

- Panel pages are loopback, unpaired and carry no credential.
- `rememberPairing` writes only when `/api/host` answers a token. A loopback
  panel page presents none, so it writes nothing.
- A shared service-worker and HTTP cache makes a panel reopen cheaper for the
  life of the browser, not more expensive.

If a future panel page stores display-specific credentials or authored state,
add a per-target `Target.createBrowserContext` then. It is not part of this
change.

### Browser engine

Keep Chromium. The measured cost is one browser and one GPU process per panel,
not the engine; sharing one engine removes that cost. Firefox has no
continuous screencast equivalent and its headless multi-window compositing is
unproven; WebKit has no maintained Windows port; WebView2 has no screencast and
needs a native helper; CEF is Chromium with more integration. A swap would
replace the capture stack and revalidate Fabric, glass and video for no
measured resource gain over the shared runtime proven here. Revisit only if the
installed Chromium cannot create the visible windows the probe requires.

### Interfaces

```ts
// panel-raster.ts
export interface RasterPageOptions {
  readonly url: string;
  readonly geometry: PanelGeometry;
  readonly stillFormat?: "jpeg" | "png";
}

export async function connectDevtools(url: string): Promise<Devtools>;
export async function startBrowser(
  executable: string,
  profile: string,
): Promise<{ child: ChildProcess; endpoint: string }>;
export function chromiumArguments(profile: string): readonly string[];
export function createPageRasterizer(
  devtools: Devtools,
  options: RasterPageOptions,
  closePage: () => Promise<void>,
): Rasterizer;
```

```ts
// panel-raster-browser.ts
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
  /** Asynchronous failures (a child exit, a failed cleanup), never a failed
   *  `create`, which rejects to the panel's own error path. */
  readonly onError?: (message: string) => void;
  readonly idleStopMs?: number;
  // Test seams; production uses the real spawn, WebSocket and CDP.
  readonly spawn?: typeof startBrowser;
  readonly connect?: typeof connectDevtools;
  readonly openTarget?: (browser: Devtools) => Promise<TargetHandle>;
  readonly closeTarget?: (
    browser: Devtools,
    targetId: string,
  ) => Promise<void>;
}

export function createRasterBrowser(
  options: RasterBrowserOptions,
): RasterBrowser;
```

The default `openTarget` sends
`Target.createTarget({ url: "about:blank", newWindow: true })` on the
browser-level connection and derives the target socket from the browser
endpoint. The default `closeTarget` sends `Target.closeTarget`. `RasterOptions`
is replaced by `RasterPageOptions`, which has no `browser`; `createRasterizer`
is removed. `Rasterizer` and `PanelRunner` are unchanged.

### Browser arguments

The shared browser keeps the current flags and adds three:

```text
--disable-background-timer-throttling
--disable-backgrounding-occluded-windows
--disable-renderer-backgrounding
```

Without them, Chromium throttles timers and rendering for a target it treats as
backgrounded. A panel page must keep updating while no one is looking at it.
The separate window is what makes the target visible; these flags keep its
timers unthrottled if a window is ever treated as occluded.
`chromiumArguments()` is exported so a unit test can assert the full flag set.

The browser still starts on `about:blank`. That one startup target is left
alone: it is a fixed cost per browser, not a per-panel one, and a startup
special case would add a failure path for no measured saving.

### Lifecycle

**Start.** `create()` lazily starts the browser on first use, connects one
browser-level devtools client for `Target.*`, and shares one start promise
across concurrent calls. A failed start kills the child, removes the profile
and clears the promise so the next panel can retry.

**Create.** Once started:

1. `Target.createTarget({ url: "about:blank", newWindow: true })` on the
   browser-level connection.
2. Derive `ws://<devtools host>/devtools/page/<targetId>` and connect.
3. `Page.enable`.
4. `Emulation.setDeviceMetricsOverride` with the panel geometry.
5. `Page.navigate` to the panel page.
6. `waitForScene`.
7. Return `createPageRasterizer(...)`.

If a step after target creation fails, close the target with
`Target.closeTarget` and rethrow. The manager's existing start path removes the
entry and reports the panel error. A failed `create()` that leaves no active
rasterizer also arms the idle timer, so a retry loop cannot leave a browser
running with no panel.

**Close.** A rasterizer's `close()` stops its screencast, closes its target
with `Target.closeTarget` (best-effort), and closes its devtools socket. It
does not touch the browser or other targets. The browser decrements its active
count.

**Idle stop.** When the last rasterizer closes, the browser stops after
`idleStopMs` (default 5 s). A new `create()` before the deadline cancels the
stop. `stop()` called explicitly stops immediately.

**Stop.** `stop()` clears the idle timer, marks the browser closed, stops the
child, waits for exit (bounded), removes the profile, and rejects any pending
browser work. It is idempotent.

**Crash.** If the child exits without `stop()`, the browser marks itself
closed, rejects pending requests and lets target sockets close. Each panel's
next capture fails through the existing failure path; after three failures the
runner reports lost, the manager detaches it, and the reconcile pass starts the
panel again. The manager replaces a closed `RasterBrowser` on the next start.

### Concurrency and ordering

- Browser start is single-flight.
- Target creation is concurrent; each call asks for a separate headless
  window, and Chromium assigns an independent target id.
- `PanelManager`'s one-chain-per-display ordering is unchanged.
- `stopAll()` stops every runner first, then the browser.
- A `create()` that resumes after `stop()` must fail rather than attach to a
  closing browser. The browser checks `closed` after each await.

### Error handling

- Asynchronous browser failure is reported once through `onError`. `main.ts`
  logs it as `Raster browser: <message>`. A failed `create` rejects to the
  panel, so it is reported once through that display's `report` path.
- Per-panel failures remain per display through the existing `report` path.
- Devtools socket close rejects pending requests immediately instead of
  waiting for the 5 s reply timeout. This is the one CDP-client change; a
  browser crash otherwise leaves every panel waiting on a promise.
- Profile removal is best-effort. A Windows file lock after shutdown is not a
  host failure; the temp directory is disposable.

## Files

| File | Change |
|---|---|
| `src/web/packages/host/src/panels/panel-raster-browser.ts` | New. Shared process and profile, browser-level CDP, per-target headless windows, idle stop, crash state. |
| `src/web/packages/host/src/panels/panel-raster-browser.test.ts` | New. Injected spawn/connect/target seams. |
| `src/web/packages/host/src/panels/panel-raster.ts` | Export the CDP client/spawn/arguments; add `createPageRasterizer`; remove per-panel profile and child ownership. |
| `src/web/packages/host/src/panels/panel-raster.test.ts` | Arguments, page close, and devtools-close rejection. |
| `src/web/packages/host/src/panels/panel-manager.ts` | Own one `RasterBrowser`; create rasterizers through it; stop it in `stopAll`; add `rasterBrowserFactory` and `onBrowserError` options. |
| `src/web/packages/host/src/panels/panel-manager.test.ts` | Inject a fake browser factory instead of mocking `createRasterizer`. |
| `src/web/packages/host/src/main.ts` | Wire `onBrowserError` to `console.error`. |
| `docs/architecture.md` | State that panels share one Chromium runtime, one target per display, each target a separate headless window. |
| `docs/decisions/0078-shared-raster-browser.md` | Reuse-gate note, written before implementation; claims the `src/web` paths above. |

No new runtime dependency. No change to the player bundle, host routes or
storage layout.

## Testing

### Unit

`panel-raster.test.ts` keeps its existing `startScreencast` and
`setOverlayMode` cases. Add or extend:

- `chromiumArguments` includes the three background-throttling flags.
- `createPageRasterizer` closes its page and socket, and does not touch the
  browser.
- a devtools socket close rejects a pending `send` immediately.

New `panel-raster-browser.test.ts`, with injected spawn/connect/open/close
seams:

- concurrent `create()` calls start the browser once;
- `openTarget` sends `Target.createTarget` with `newWindow: true`;
- each `create()` produces one target with its own geometry and URL;
- a failed `create()` closes its target and arms the idle timer;
- closing one rasterizer leaves the browser open while another is active;
- closing the last rasterizer stops the browser after the idle deadline;
- `stop()` is idempotent and removes the profile;
- child exit marks the browser closed, reports once, and makes the next
  `create()` fail with a stated reason.

`panel-manager.test.ts` switches from mocking `createRasterizer` to injecting a
fake `RasterBrowser` factory:

- two panels share one browser;
- `stopAll` stops the browser after the runners;
- a closed browser is replaced on the next panel start.

### Behavioural probe

Run against real hardware, with the host restarted and no other host running:

1. The connected mix: at least one Kraken still panel at 140 ms (screencast)
   and one Lian Li or TURZX video panel at 1 Hz (overlay screenshot).
2. Confirm every panel updates, overlays and rotation behave as before, the
   Kraken holds its cadence, and every overlay panel holds its 1 Hz cadence.
3. Kill the shared Chromium process. Confirm all panels detach, then reopen on
   the manager's retry pass.
4. Remove one panel's record. Confirm the browser stays for the others; remove
   the last and confirm it exits after the idle deadline.

## Measurement

### Discovery probe (run 2026-11-01)

A disposable Node probe in the temp directory started one Chromium with the
planned flags and three targets at a synthetic canvas page: 480x1920 at
140 ms, 800x480 at 1 s, 480x1920 at 1 s. The page is synthetic; it measures
platform visibility and capture, not the player's own rendering.

| Setup | Result |
|---|---|
| Tabs (`/json/new`) | Only the last tab `visible`; screencast 0 / 0 / 1.1 fps |
| Separate windows (`newWindow: true`) | All three `visible`; screencast 7.2 fps at 140 ms (median 137 ms), 1.2 fps at 1 s (median 1001 / 999 ms) |
| One 140 ms screencast + two 1 s screenshot loops | 7.3 fps at 140 ms (median 139 ms); screenshots 1.00 fps, 42 / 47 ms per frame |
| 140 ms screenshot loop on a visible target | 7.00 fps, 44 ms per frame |

The screenshot path is the overlay path the Lian Li and TURZX panels use; the
screencast path is the still path the Kraken uses. Both hold when the targets
are separate windows. This is the go/no-go, and it passes.

### Clean baseline

Same build, 60 s warm-up and 60 s sample, no editor. The 1-panel run used the
Kraken Z73; the 0-panel run used the same app folder with no panel records.
Process tree walked from the host PID by `ParentProcessId`; private commit is
`Win32_Process.PrivatePageCount`, not RSS; CPU is the `UserModeTime` +
`KernelModeTime` delta.

| Panels | Procs | Private MB | CPU s/60 s | Cores | Browser + GPU MB |
|---:|---:|---:|---:|---:|---:|
| 0 | 2 | 95.5 | 0.0 | 0.000 | 0 |
| 1 | 11 | 689.4 | 23 | 0.383 | 367.6 |
| 3 | 29 | 1,748.3 | 51 | 0.850 | 982.6 |

The 3-panel sample had two processes exit during the window, so its CPU is a
lower bound. The 1-panel sample had no exits.

Pass criteria:

- exactly one Chromium browser process for N ≥ 2 panels;
- at least four fewer Chromium processes at 3 panels (two browser/GPU pairs);
- browser + GPU private bytes for N panels ≤ 459.5 MB (one-panel 367.6 + 25%);
- total tree private bytes reduced by at least 300 MB at 3 panels;
- CPU no more than 5% above 51 s/60 s;
- frames accepted per panel no more than 1% below baseline, counted through
  the runner's existing `onFrame` hook in a throwaway harness with a no-op
  device;
- one-panel behaviour is not worse than baseline.

The expected saving is roughly 615 MB at three panels: the 982.6 MB browser +
GPU total becomes about one panel's 367.6 MB. Renderer children remain per
panel; some utility processes may be shared, which only adds to the saving.

## Reuse-gate evidence

### Rung 1 — internal owner

Searched: `createRasterizer`, `createPanelManager`, `startScreencast`,
`setOverlayMode`, `PanelRunner`, panel tests.

Found: `panel-raster.ts` already owns every per-target CDP operation and
`panel-manager.ts` already owns panel lifecycle. The missing piece is a
browser-level owner between them. The existing `Rasterizer` contract and
`PanelRunner` cadence can be reused unchanged.

### Rung 2 — installed dependencies

Searched: `node:child_process`, `node:fs/promises`, `node:os`, global
`WebSocket`; the host's dependency list.

Found: the current rasterizer already uses all of them, including the devtools
protocol over Node's own WebSocket. The new target path needs no HTTP endpoint:
`Target.createTarget` and `Target.closeTarget` are CDP methods on the browser
socket. No package donates shared-browser lifecycle, and none is needed.

### Rung 3 — native platform

Searched: Chrome DevTools Protocol `Page`, `Emulation` and target endpoints;
Chromium headless multi-tab behaviour; Chromium background throttling flags.

Found: one Chromium process hosts many independent targets. A target created
with `Target.createTarget({ newWindow: true })` gets its own headless window
and reports `document.visibilityState: "visible"`; a target created as a tab
(`newWindow: false`, or `/json/new`) is `hidden` and does not composite.
Per-target `Page.navigate`, `Emulation.setDeviceMetricsOverride`,
`Page.startScreencast`, `Runtime.evaluate` and `Page.captureScreenshot` remain
independent. The three background flags keep timers unthrottled but do not
make a hidden tab visible; the probe measured both. Chromium does not provide
a cheaper per-panel compositor: the renderer remains per target.

### Rung 4 — public solutions

Searched: Puppeteer `Browser`/`BrowserContext`/`Page`, Playwright
`browser.newContext()`/`browser.newPage()`, Chrome headless multi-tab docs,
Tauri/WebView2 capture alternatives.

Found: both automation libraries model one browser process with many pages,
but their page APIs create tabs — which the discovery probe shows stay hidden.
The window distinction is a CDP `Target.createTarget` option, below those APIs.
WebView2 can host multiple webviews in one environment, but Tauri exposes no
`Page.startScreencast`; `CapturePreview` is a one-shot PNG and is not proven at
the Kraken's 140 ms cadence. It remains a separate future probe.

### Rung 5 — integration comparison

| Option | Fit | Unsolved work | Verdict |
|---|---|---|---|
| Keep one Chromium per panel | Preserves quirks exactly | None; cost grows linearly, measured | Rejected: current cost |
| One Chromium, one target per panel, each a headless window | Preserves every per-target capability; shares browser/GPU; both capture paths hold | Browser crash blast radius; `newWindow` requirement; idle stop | **Chosen** |
| One page, switch viewport per panel | One renderer | Panels render concurrently at different cadences; serialising captures loses frames | Rejected |
| WebView2 hidden views | Removes external browser | No screencast; capture cadence unproven; Tauri not in scope | Rejected for this change |
| One browser per panel family | Limits blast radius | Still one browser per panel; little saving | Rejected |

### Rung 6 — smallest probe

The measured process tree above establishes where the cost sits. The discovery
probe settles the one platform unknown: separate headless windows keep every
target visible, and both capture paths hold under load. What remains is the
baseline/after measurement and the hardware behavioural probe. The per-target
CDP surface already exists; no new capture mechanism is needed.

### Decision

Reuse the existing per-target rasterizer and replace its per-panel browser with
one shared Chromium runtime. Keep one target per panel, each target a separate
headless window, one profile per browser, and the default browser context. Add
no dependency and no compatibility path.

## Risks

| Risk | Mitigation |
|---|---|
| A target created as a tab is hidden, so its capture stalls | Create every target with `newWindow: true`; unit test asserts it; the discovery probe's tab control shows the failure |
| The installed Chromium refuses `newWindow` in headless | Probe the installed Chrome/Edge before implementation; stop if it does not reproduce the visible-window result |
| One browser crash stops every panel | Existing per-panel failure path detaches all; reconcile reopens; browser replaced on next start |
| Shared GPU process contends across panels | Discovery probe holds 140 ms + two 1 s paths; baseline/after measures frames; split a regressing family into its own browser only if measured |
| Shared default context leaks storage between panels | Panel pages are unpaired and hold no credential; add browser contexts only if a panel page starts writing display-specific state |
| A shared service worker reloads every panel together | Panels are disposable and reconnect; acceptable for a local dashboard |
| Target leak on close | `Target.closeTarget` per rasterizer and on setup failure; idle stop is the last resort; assert target count in tests |
| Windows profile removal fails | Best-effort remove after bounded wait; temp directory is disposable |
| Single-panel case pays for sharing | No sharing overhead until a second panel exists; acceptance requires no one-panel regression |

## Rollout

Single change, no runtime flag. The pre-release tree has no compatibility
obligation; revert is the rollback. Ship only after the gate is green
(`npm run gate` from `src/web/`) and the before/after measurement is recorded.
