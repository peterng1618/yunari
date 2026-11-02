# Tauri desktop shell assessment

## Status

Research and architecture assessment. No implementation direction is committed
and no Tauri scaffolding exists. The recommendation below is the input to a
separate implementation spec once the open decisions in the last section are
answered.

## Goal

Evaluate Tauri 2 as the desktop shell for Yunari on Windows, with two questions
kept separate:

1. **Distribution and lifecycle.** Replace the spawned Chrome/Edge windows, the
   PowerShell/WinForms tray, the Task Scheduler autostart entry and the
   hand-rolled update path with one installer and one app process tree.
2. **Background cost.** The priority is CPU, RAM and GPU while Yunari runs with
   no editor open. Storage cost is not a concern. Folding hardware monitoring
   into the same native runtime is optional scope.

Product invariants stay: phones remain paired LAN browsers; the editor and
settings page stay loopback-only; USB panels keep their vendor protocols; the
theme envelope, storage location and schema do not change.

## Current runtime

One Node host owns every non-UI concern:

| Surface | Owner now | Tauri impact |
|---|---|---|
| HTTP + HTTPS on one port | `host/src/server.ts` (`node:http`, `node:https`, `net` TLS sniff) | Unchanged while Node stays |
| SSE `/ws` sample stream | `host/src/transport/sse.ts` | Unchanged while Node stays |
| TLS root and leaf, DPAPI key | `host/src/tls/authority.ts`, `settings/os-key-protector.ts` | Unchanged while Node stays |
| Sensor providers | `host/src/providers/*` (`systeminformation`, LHM HTTP, RTSS/PresentMon, PowerShell helpers) | Foldable into Rust |
| USB panels | `host/src/panels/*` (`node-hid`, `usb`, `serialport`) | Last subsystem to port |
| Panel raster | One shared Chromium (`panels/panel-raster-browser.ts`), one CDP target per panel | Keep Chromium initially |
| Theme library, settings, cache | `%USERPROFILE%\.yunari` | Unchanged |
| Local monitor windows | `serve/display-launcher.ts` spawns Chrome/Edge `--app` | Tauri replaces |
| Tray | `tray/windows.ts` spawns hidden PowerShell/WinForms | Tauri replaces |
| Autostart | `serve/host-autostart.ts` writes `Yunari.vbs` / desktop entry | Tauri plugin replaces |
| Single host | `settings/host-lock.ts` | Keep; add Tauri single-instance |
| Player/editor/settings UI | Built Vite bundles served by the host | Unchanged |

The repository is pre-release (`0.1.0`), the npm package is unpublished and
there is no packaged executable. The desktop app can therefore become the
primary Windows distribution without preserving two owners of tray and
autostart.

## Measured background cost

Pre-refactor clean baseline, taken 2026-11-01 after a reboot with three panels
(Lian Li 464x1920 video, TURZX 800x480 video, Kraken Z73 320x320 stills), no
local display windows, editor closed, 60 s warm-up and 60 s sample:

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
sample, so CPU is a lower bound. Browser plus GPU is 982.6 MB of the total.

The earlier long-running development host measured 2,065 MB and 1.14 cores;
the clean baseline supersedes it. The per-panel Chromium trees dominated that
measurement, and the shared-raster-browser refactor has since landed (decision
`docs/decisions/0078-shared-raster-browser.md`). Its shipped set on the same
three panels measured 11 processes, 1,150.1 MB private and 32.6 CPU-s per 60 s,
with browser + GPU at 568.2 MB. The baseline above is kept as the before
measurement; the current residual is the per-panel renderers, the shared
browser and the Node host.

`panel-manager.ts` used to call `createRasterizer` once per panel, and each call
started a full Chromium with its own `--user-data-dir`. That refactor is
complete: one Chromium process now hosts one target per panel, while each
panel's page, geometry, cadence, still format, overlay mode and driver quirks
stay independent. A Rust host or Tauri shell would not change that architecture
either way.

## Constraints

### Hard

1. **A server must survive.** Phones are paired browsers on the LAN and need
   HTTP/HTTPS, TLS, SSE and pairing. Tauri has no built-in LAN server; either
   Node keeps serving or a Rust host provides it with axum/rustls.
2. **The player needs a real `http(s)` origin.** Service workers cannot
   register on Tauri's custom protocol; Tauri points users to
   `tauri-plugin-localhost` for this. Loading `http://127.0.0.1:<port>` from
   the host solves it without the plugin and without granting the player any
   Tauri IPC capability.
3. **WebView2 does not implement Screen Wake Lock.** `navigator.wakeLock` is
   reported absent in WebView2. A Tauri local display window needs a native
   `SetThreadExecutionState` hold; phone browsers keep the web API.
4. **USB panels are the hardest port.** `node-hid`, `usb` and `serialport` are
   N-API/prebuilt addons. They work under a shipped `node.exe`; a Rust host
   needs `hidapi`/`serialport` crates and a re-test of every vendor protocol,
   including the TURZX and Kraken firmware quirks.
5. **Panel rasterization needs Chromium compositing.** `panel-raster.ts` drives
   a real Chromium because glass sampling, ECharts and packaged fonts already
   work there. WebView2 exposes `CapturePreview` and
   `CallDevToolsProtocolMethodAsync`, but hidden-window capture can be blank
   and there is no screencast equivalent; the Kraken's 140 ms cadence makes
   that doubtful.
6. **Tauri windows share a WebView2 profile by default.** Same origin means
   shared cookies and localStorage unless each webview gets
   `data_directory()` or a named profile. The current Chrome launcher uses one
   profile per display.
7. **Sidecars are not killed automatically.** Cleanup must be explicit on
   `RunEvent::ExitRequested`. A Windows Job Object with
   `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE` is the robust answer because it also
   reaps LHM, PresentMon and any Chromium the host spawned.
8. **Windows-first.** Tauri on Linux uses WebKitGTK, not Chromium; rendering
   and codec parity for the player is unproven there. Scope the desktop app to
   Windows and keep the CLI path elsewhere.

### Non-constraints

- Theme, schema and storage format do not change.
- Player, editor and settings bundles do not need a rebuild for Tauri when they
  load from the host origin.
- The store Worker is untouched.

## Options

| Option | What changes | Effort | Risk | Result |
|---|---|---|---|---|
| **A. Tauri shell + Node sidecar** | Rust shell; Node packaged inside; browser windows and PowerShell tray retired | Moderate | Medium | One installer, native tray/windows/updater; all host behaviour preserved |
| **B. A, then phased Rust host** | Replace HTTP first, then providers, then USB; Node removed over phases | A + multi-month | High | Same UX, eventually one runtime; long dual-maintenance |
| **C. Full Rust host now** | Port ~85k LOC source plus ~57k LOC tests, hardware protocols, TLS and providers | Multi-month | Very high | True native single binary; highest regression risk |
| **D. Tauri launcher only** | Tauri starts Node and opens the system browser | Small | Low | Better startup, still browser-based; not a desktop app |

Option A was the initial recommendation because it preserves every invariant
and reuses the existing gates. The measured background cost changed the order,
and the first step has landed:

- **Done:** the shared-raster-browser refactor (decision 0078). It removed
  roughly 600 MB and most of the browser/GPU process count, was Node-only, and
  shipped separately from any Tauri work.
- **Next:** build the Tauri shell. If the shell lands before the host is ported,
  it ships with the Node sidecar (Option A). The end state that meets the
  remaining resource goal is a Rust host (Option B): the Node process, its
  subprocess churn and its provider shell-outs disappear.
- **Never start with C.** Porting 85k lines plus vendor hardware protocols is a
  separate multi-month project, not a packaging change.
- **WebView2 panel capture is a probe, not a plan.** Shared Chromium remains
  the lower-risk destination until a probe proves the panel cadences.

Tauri's role is therefore narrower than the original question implied: native
tray, windows, installer, updater, single-instance, autostart and wake-lock
ownership. Tauri alone is not the source of the remaining resource win; the
Rust host it enables is.

## Target architecture

```
Tauri core (Rust)
├─ tray, menu, autostart, single-instance, updater
├─ editor/settings WebView2 windows  ──HTTP──▶ Rust host
├─ local display WebView2 windows    ──HTTP──▶ Rust host  (one per monitor)
├─ native wake-lock hold while a local display is visible
└─ Rust host (or Node sidecar during migration)
      HTTP/HTTPS, SSE, TLS, providers, USB panels, theme store
```

### Process lifecycle

1. The single-instance plugin runs first. A second launch focuses the existing
   app and exits before starting a second host.
2. The shell starts the host with no browser window and assigns it to a Job
   Object when the host is a sidecar.
3. The host takes its existing lock, binds the port, then reports readiness.
   Add one machine-readable signal: `runtime.json` with the bound port, or a
   `YUNARI_READY {"port":...}` stdout line. The shell polls `/api/health`
   before opening windows.
4. If the host exits or the lock is held, the shell shows a clear error and,
   when a healthy host exists, offers to open its editor URL instead of
   starting a second host.
5. On exit, the shell closes tray, windows and the host. No orphaned LHM,
   PresentMon or raster browser.

### Windows

- **Editor and settings:** one `WebviewWindow` loading
  `http://127.0.0.1:<port>/editor` and `/settings`. Closing hides or closes the
  window without exiting the app; tray Exit ends it.
- **Local displays:** one `WebviewWindow` per local display,
  `WebviewUrl::External("http://127.0.0.1:<port>/?display=<id>")`, created at
  the monitor position, fullscreen, decorations off, background throttling
  disabled.
  - Tauri window creation uses logical pixels; monitor data is physical.
    Convert with `scaleFactor`, or use `set_fullscreen_on_monitor`. Mixed-DPI
    wall displays are the test case.
  - Use per-display `data_directory()` if isolation is needed; otherwise all
    windows share one WebView2 profile.
- **No Tauri IPC on host pages.** They load an external origin and therefore
  have no IPC unless `remote.urls` is granted. Do not grant it: a theme is
  data, but the player window must not hold native capability. Window policy
  lives in Rust.
- **Wake lock:** Rust holds `ES_DISPLAY_REQUIRED` while any local display
  window is visible. Phone displays continue using `navigator.wakeLock`.

### Tray and host actions

Tauri's native tray replaces the PowerShell/WinForms process. Existing actions
split cleanly:

| Action | New owner |
|---|---|
| editor, settings, pair, themes, folder | Rust (open URL/folder) |
| autostart | Tauri autostart plugin |
| exit | Rust (stop the host) |
| LHM / RTSS start | Host — add loopback-only POST routes or a tiny IPC channel |
| port, LAN state, panel list | Host — read existing loopback admin routes |

The Node tray implementation stays only if a CLI/headless mode remains
supported. Otherwise retire it to avoid two owners.

### Autostart

The Tauri plugin writes the login entry. Existing pre-release users may have
`Yunari.vbs` or the legacy `YunariHost` task; the installer or first run must
remove both, or login starts a second host.

### Updater

Tauri updater with signed artifacts (`TAURI_SIGNING_PRIVATE_KEY`), NSIS/MSI
output and `latest.json` on GitHub Releases. Windows exits the app during
install, so host cleanup must run on `ExitRequested`. The product version
currently lives in `src/web/package.json`; Tauri's version must be generated
from it or checked for equality in the gate. Do not create a second version
owner.

### Editor compatibility items

- **Downloads:** `persistence-manager/index.ts` creates an object URL and
  clicks an anchor. WebView2 needs a download handler or save dialog
  configured; otherwise export silently does nothing.
- **OAuth popup:** `store-mode/use-submit.ts` calls `window.open`. Route the
  new window to the system browser and return focus.
- **Drag and drop:** Tauri replaces WebView2's drop handler on Windows; call
  `disable_drag_drop_handler` if HTML5 drag-and-drop is used.
- **Clipboard:** enable clipboard access on the editor webview on Windows.
- **File inputs:** `<input type="file">` is used for theme import and assets;
  the native dialog works, but verify filters and returned paths.

### Panels

Keep `panel-raster.ts` on the Edge/Chrome CDP path initially, driven by the
shared browser in `panel-raster-browser.ts`. Edge is a Windows system component
and the proven screencast/overlay logic is why panels work. A hidden WebView2
with `CapturePreview` remains a future probe only.

## Rust host migration

The end state removes the Node process. Phases, in order:

1. **Tauri shell over the existing host.** Windows, tray, autostart,
   single-instance and installer land; the host is a Node sidecar and keeps
   every existing route and test.
2. **Host transport and stores in Rust.** HTTP/HTTPS on one port, TLS
   root/leaf, SSE, the theme library, settings and the static bundles. The
   editor, player and phone flows do not change origin.
3. **Providers and sensors in Rust.** Native Win32/WinRT reads replace
   `systeminformation` and the PowerShell helpers. Missing readings stay
   absent with a reason, exactly as today.
4. **USB panels in Rust.** `hidapi`/`serialport` plus a per-vendor protocol
   re-test. This is last because it carries the most hardware risk.
5. **Delete the Node host and sidecar packaging.** Retire `tray/*`,
   `display-launcher.ts`, `host-autostart.ts` and the Node-specific build
   scripts once no supported surface needs them.

## Folding in hardware monitoring

Baseline sensors are feasible in Rust without a kernel driver:

| Reading | Native source | Driver needed? |
|---|---|---|
| CPU load/clock | Win32 / `sysinfo` | No |
| RAM, disks, network, battery, processes | Win32 / `sysinfo` | No |
| GPU load | PDH GPU Engine counters / vendor APIs | No |
| NVIDIA temp/power/fan/VRAM | NVML | No |
| AMD GPU detail | ADL | No |
| NVMe/ATA SMART, disk temp | `DeviceIoControl` | No |
| Wi-Fi SSID/signal | WLAN API | No |
| Now playing | WinRT SMTC | No |
| Foreground game | Win32 | No |

Not available in user mode on most boards: CPU package temperature, fan RPM,
board voltages, CPU package power and DIMM temperature. Those live behind
Super-I/O/EC/MSR access. LHM reaches them with a signed kernel driver.

Three options:

1. **Keep LHM optional.** Current behaviour; not part of the measured
   background cost because it was not running. A native baseline replaces
   `systeminformation`; extended keys stay absent with a reason.
2. **Embed a small LHM helper.** Bundle `LibreHardwareMonitorLib` and its
   driver, launched only when an extended key is bound. Still a separate
   process, but controlled and smaller than the LHM GUI.
3. **Own the driver in Rust.** WinRing0/PawnIO/MSR. Highest risk, signing
   burden and security history. Not recommended at this stage.

Recommendation: native baseline in Rust, with LHM optional or embedded for
extended sensors. That removes the `systeminformation` subprocess churn without
owning a kernel driver and preserves the "missing readings stay missing" rule.

## Packaging and size

| Item | Raw size |
|---|---|
| Node runtime (`node.exe`, v24) | ~90 MB |
| `ffmpeg-static` | ~80 MB |
| LHM vendor | ~12 MB |
| Host dist (includes sourcemaps) | ~9.6 MB |
| Player dist | ~6.1 MB |
| Editor dist | ~17 MB |
| Native modules, win32 only | a few MB after pruning |
| WebView2 runtime | OS-provided (Windows 10 1803+/11), or +1.8 MB bootstrapper / +127 MB offline installer |

Installed payload is roughly 200 MB or more. Installer compression reduces the
download; the disk footprint stays large. Tauri does not shrink the product.
A Rust host removes the Node runtime eventually but not ffmpeg, the panel
vendor data or the UI bundles.

Node packaging notes: ship `node.exe` plus files. Node SEA is possible, but
native addons need extraction and worker/asset caveats; `library-worker.ts` and
the addons make SEA less attractive. `pkg` is archived. Bun/Deno N-API
compatibility for `node-hid`/`usb`/`serialport` is unproven.

## Risks and required probes

| # | Risk | Severity | Probe |
|---|---|---|---|
| 1 | WebView2 lacks Screen Wake Lock | Medium | Load the player in a Tauri window; confirm `navigator.wakeLock` absent; verify `SetThreadExecutionState` keeps the display on |
| 2 | Service worker on `http://127.0.0.1` in WebView2 | Medium | Register `sw.js`, reload offline, confirm the shell cache |
| 3 | Multi-window storage/cookie isolation | Medium | Two display windows, check localStorage/cookies; test `data_directory` per window |
| 4 | Sidecar orphans children on crash/update | High | Kill the shell; verify the Job Object reaps Node, LHM, PresentMon and raster Chromium |
| 5 | Native addons in a packaged tree | High | `node-hid`/`usb`/`serialport` enumerate hardware from the staged sidecar |
| 6 | Panel raster finds Edge in the packaged app | Medium | Drive a panel from an installed build |
| 7 | Editor download/popup/drag-drop/clipboard | Medium | Export a package, store sign-in, asset drag, copy/paste |
| 8 | Mixed-DPI monitor placement/fullscreen | Medium | Two monitors at different scale factors |
| 9 | Port discovery and host-lock collision | High | Occupy 5227, start the app; verify readiness and the existing-host message |
| 10 | Autostart migration | High | Install over a tree with `Yunari.vbs` / `YunariHost` |
| 11 | Version skew Tauri vs host | Medium | Gate comparing `package.json` and the Tauri version |
| 12 | Code signing / SmartScreen / updater keys | Medium | Signed installer on a clean VM; signed update round trip |
| 13 | WebView2 availability on target Windows 10 | Low | Install on clean Windows 10 |
| 14 | Chromium parity on Linux/macOS WebKitGTK/WKWebView | High if cross-platform | Defer; scope Windows first |

## Open decisions

1. **Is the end state a shell over Node, or a Rust host?** The measured goal
   says Rust host; the shell can still land first with the sidecar. If Node
   removal is not required, Option A is complete on its own.
2. **Is ~200 MB installed acceptable?** If not, Tauri does not solve it; only
   dropping Node and ffmpeg changes the order of magnitude.
3. **Does the CLI/npm path remain supported?** That decides whether `tray/*`,
   `display-launcher.ts` and `host-autostart.ts` are retired or kept as a
   second owner.
4. **Editor and settings in Tauri windows, or the system browser?** The former
   needs the download/popup/drag-drop work above.
5. **Windows-only desktop app, or Linux/macOS too?** Linux parity needs a
   WebKitGTK rendering probe.
6. **Is real monitor brightness/DDC-CI still wanted?** The Rust side is the
   first surface that can do it; that is a new feature, not this refactor.

## Sources

- Tauri sidecars: https://v2.tauri.app/develop/sidecar/
- Node sidecar guide: https://v2.tauri.app/learn/sidecar-nodejs/
- Localhost plugin and service-worker rationale: https://v2.tauri.app/plugin/localhost/
- Service workers fail on custom protocol: https://github.com/tauri-apps/tauri/issues/13031
- System tray: https://v2.tauri.app/learn/system-tray/
- Single instance: https://v2.tauri.app/plugin/single-instance/
- Updater signing: https://v2.tauri.app/plugin/updater/
- Windows installer and WebView2 modes: https://v2.tauri.app/distribute/windows-installer/
- Tauri 2.12 release: https://v2.tauri.app/blog/tauri-2.12/
- Process model: https://v2.tauri.app/concept/process-model/
- Window APIs and monitor placement: https://v2.tauri.app/reference/javascript/api/namespacewindow/
- Per-webview `data_directory`: https://docs.rs/tauri/latest/x86_64-pc-windows-msvc/src/tauri/webview/webview_window.rs.html
- Sidecar cleanup issue: https://github.com/tauri-apps/tauri/issues/1896
- Process-tree cleanup PR: https://github.com/tauri-apps/tauri/pull/14443
- Screen Wake Lock in WebViews: https://caniwebview.com/features/web-feature-screen-wake-lock/
- WebView2 capture APIs: https://learn.microsoft.com/en-us/microsoft-edge/webview2/reference/winrt/microsoft_web_webview2_core/corewebview2
- Node SEA: https://nodejs.org/api/single-executable-applications.html
- Rust HID: https://crates.io/crates/hidapi
- Rust serial: https://crates.io/crates/serialport
