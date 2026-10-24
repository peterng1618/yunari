# System tray host — design

- **Date:** 2026-10-25
- **Status:** active 2026-10-25.
- **Register:** no row. This is a requested feature, not a defect against
  shipped behaviour.
- **Related:** [`docs/architecture/ownership.md`](../../architecture/ownership.md);
  [ADR-0010](../../adr/0010-one-active-plan.md);
  [decisions/0107](../../decisions/0107-frame-statistics-come-from-rtss-then-presentmon.md)
  (amended by 0110); [decisions/0110](../../decisions/0110-the-tray-may-start-rtss-on-request.md);
  [decisions/0111](../../decisions/0111-the-tray-is-a-host-owned-shell.md);
  [`docs/product/requirements.md`](../../product/requirements.md) §97 (honest
  capability), §111 (minimal overhead), §116 (where work happens), §145 (LAN).

## Purpose

Yunari currently needs a terminal to stay alive. Closing the terminal stops the
host and every display window. The product needs to start at sign-in, run in the
background, and be reachable from a tray icon without a console.

The user-visible outcomes:

1. **Auto start** can be switched on and off from the tray.
2. **Pair display** opens the editor's existing publish surface, where the LAN
   toggle, address, pairing code and QR live.
3. **Theme Editor**, **Theme Store** and **Host Settings** each open the editor
   at that surface.
4. **Exit** stops the host and everything it owns.
5. A **status line** names the local address and whether the LAN is on.
6. **Open Yunari folder** opens the app folder.
7. Installed external programs appear as status/start rows:
   **LibreHardwareMonitor** and **RivaTuner Statistics Server**.
8. The host starts hidden at sign-in on Windows and Linux.

## What this is not

- It is not a second process owner. The tray is a surface over the same host
  process; providers, displays, pairing and settings stay where they are.
- It is not a macOS tray. Windows and Linux are the scope; macOS reports that
  the mode is unsupported rather than starting an invisible host.
- It is not a Now Playing control. `MediaProvider` stays demand-driven and owns
  the media helper.
- It is not an RTSS auto-start. RTSS starts only when the owner asks.
- It is not a new settings store. Autostart is the OS's own entry; the tray
  reads and writes that entry.

## Current state

- `host/src/main.ts` waits on `SIGINT`/`SIGTERM` and comments that process
  lifetime belongs to the terminal until a tray host exists.
- `host/src/serve/display-launcher.ts` owns `registerHostAutostart`, which
  registers a Windows `schtasks` task named `YunariHost`. It has no state read,
  no removal, and no Linux implementation.
- `host/src/cli/net.ts` opens a browser with `cmd /c start` on Windows, which
  flashes a console window.
- The editor shell has three modes (`editor`, `themes`, `this-pc`) and a
  `showPublishing()` method, all in `editor-shell/shell-layout.tsx`. The mode is
  React state, not a route, and nothing reads it from the URL.
- `HostingStore`, `PublishControl` and the pairing code route already implement
  the Pair display surface. `displayUrl` builds the phone's `/pair` URL.
- `MediaProvider` starts its helper when a display binds `media.*`/`audio.*`,
  keeps it while demanded, and stops it after `DEFAULT_GRACE_MS = 30_000`.
- `RtssAdapter` reads RTSS shared memory and reports
  `"RivaTuner Statistics Server is not running."`; ADR 0107 says it never
  launches RTSS.
- `lhm-launcher.ts` already launches LHM, prefers LHM's own elevated startup
  task, and stops only the process it started. `main.ts` calls it only when
  `--lhm-exe` is passed.

## Reuse gate evidence

The seven rungs were worked before this design. The full searches and the
alternatives that lost are in
[decisions/0111](../../decisions/0111-the-tray-is-a-host-owned-shell.md) and
[decisions/0110](../../decisions/0110-the-tray-may-start-rtss-on-request.md).
In summary:

1. **Owner.** The host owns process lifetime, external programs and pairing.
   The editor owns the three surfaces. There is no tray owner.
2. **Dependencies.** The host has `ffmpeg-static`, `node-forge` and
   `systeminformation`; no tray package. `systray2` is MIT and ships x86-64
   binaries, so it is staged rather than shipped for Windows.
3. **Platform.** Windows has `System.Windows.Forms.NotifyIcon` through
   PowerShell 5.1. Linux has no Node-native status-icon API; the portable
   systray Go binary speaks a small JSON-line protocol. A Windows probe showed
   `Console.In.Peek()` blocks the WinForms UI thread, so the script reads stdin
   on a background thread.
4. **Ecosystem.** 9remote and 9router both use PowerShell WinForms on Windows
   and `systray2` on Linux/macOS. Their Windows autostart is a hidden
   Startup-folder VBS, not a console launch. Their lazy `npm install` of
   `systray2` is rejected here because the first sign-in may have no network.
5. **Comparison.** See 0111. The chosen shape is PowerShell on Windows and a
   staged `systray2` Linux binary on Linux, with the menu model owned by the
   host.
6. **Probe.** `NotifyIcon` created and disposed; `Console.In.Peek()` froze the
   UI timer at zero ticks; `systray2@2.1.4` tarball SHA-256 is
   `24a176933952c4db79026dcec25c7acf48e5c1cee5d94bc6b87740060bc8ed00`, its
   Linux binary is ELF x86-64, and its licence is MIT; RTSS is installed at
   `C:\Program Files (x86)\RivaTuner Statistics Server\RTSS.exe` and is not
   running; LHM is not installed on this PC.
7. **Build.** Vite bundles only TypeScript into `dist/main.js`, so the Windows
   script is embedded as a string. The Linux binary is staged into
   `packages/host/vendor/tray` by `vendor-tray.mjs`, like PresentMon and LHM.

## Design

### 1. Run mode and lifecycle

Add `--tray`. It is accepted on Windows and Linux only.

- `--tray` implies `--no-browser`; a tray host opens no editor tab on start.
- A tray host still reconciles local display windows, exactly as a foreground
  host does. Sign-in therefore brings back every paired local monitor.
- The process stays alive until the tray's **Exit**. The tray calls the same
  stop path `SIGINT` uses: stop the LHM this run started, the media/frame/game
  helpers, the custom-source timers, the display windows, then the server and
  the host lock.
- If `startTray()` fails, `--tray` prints the reason and returns `1`. A tray
  host never runs invisibly with no way to exit.
- Tray mode starts LHM after the server is reachable, in the background, so the
  tray is not held up by a UAC prompt. If Exit arrives before that launch
  resolves, the stop handle is invoked when it arrives and the host does not
  wait for it.
- If the tray process dies after starting, the host stops with the reason,
  rather than becoming an orphan. An intentional Exit is not treated as a
  failure.
- On macOS, `--tray` returns an error naming the platform. On Linux without
  `DISPLAY` or `WAYLAND_DISPLAY`, it returns an error rather than starting a
  tray nothing can show.
- Foreground runs keep their current behaviour and console output.

The host owns one `stop` closure. The signal path and the tray's Exit both call
it; a guard makes a second call a no-op.

### 2. Menu contract

The menu is one platform-neutral model, built by a pure function from a
snapshot:

```ts
interface TraySnapshot {
  readonly port: number;
  readonly lan: boolean;
  readonly lanAddress?: string;
  readonly autostart: boolean;
  readonly notice?: string;
  readonly lhm?: ExternalAppState;
  readonly rtss?: ExternalAppState;
}

interface ExternalAppState {
  readonly installed: boolean;
  readonly running: boolean;
  /** Why a running program is not readable, such as "web server off". */
  readonly detail?: string;
}

type TrayAction =
  | "autostart" | "pair" | "editor" | "themes" | "settings"
  | "lhm" | "rtss" | "folder" | "exit";

interface TrayMenuItem {
  readonly title: string;
  readonly enabled: boolean;
  readonly checked?: boolean;
  readonly separator?: boolean;
  readonly action?: TrayAction;
}
```

The rendered order is:

1. Status line (disabled): `Yunari — localhost:<port> · LAN on` or
   `· local only`. When `notice` is set, it replaces the address line for its
   lifetime.
2. **Auto start** (checked when the OS entry exists).
3. **Pair display**.
4. **Theme Editor**.
5. **Theme Store**.
6. **Host Settings**.
7. Separator, then **LibreHardwareMonitor** and **RivaTuner Statistics
   Server** — each present only when that program exists on this host.
8. Separator, **Open Yunari folder**, **Exit**.

Separators are emitted only between non-empty groups. No external-program row
is ever drawn as a disabled placeholder for a program that is not installed.

The controller polls the snapshot every 5 seconds, builds the menu, and sends it
only when the built item list changed. This keeps an open menu from being
rebuilt by an idle poll. Action failures set `notice` for 10 seconds; the next
successful state change clears it.

### 3. Windows adapter

`tray/windows.ts` spawns `powershell.exe -NoProfile -ExecutionPolicy Bypass
-WindowStyle Hidden -EncodedCommand <base64>`.

The script is embedded in TypeScript. It:

- creates a `NotifyIcon` from a 32×32 PNG held in `tray/tray-icon.ts`, converted
  to an `HICON` with `Icon.FromHandle(bitmap.GetHicon())`;
- opens the menu on left or right click;
- reads stdin on a background C# thread into a `ConcurrentQueue<string>` —
  `Console.In.Peek()` on the UI thread blocks and freezes the icon;
- drains that queue from a 100 ms WinForms timer;
- rebuilds the whole `ContextMenuStrip` on a `menu` command, with
  `ToolStripSeparator` for separators, `Checked` for auto start, and `Enabled`
  per item;
- reports a click as `{"type":"click","index":N}`;
- caps the tooltip at 63 characters, Windows' own limit.

Node → PowerShell commands are one JSON object per line:

```json
{"action":"menu","items":[{"title":"…","enabled":true,"checked":false,"separator":false}]}
{"action":"tooltip","text":"…"}
{"action":"kill"}
```

PowerShell → Node events are `started`, `click` and `error`. No network port,
named pipe or temp command file is involved.

### 4. Linux adapter

`packages/host/scripts/vendor-tray.mjs` downloads the pinned `systray2@2.1.4` tarball,
verifies its SHA-256, and extracts **only** `package/traybin/tray_linux_release`
and `package/LICENSE` into `packages/host/vendor/tray`. The binary is not
committed; `vendor/` stays ignored and `PROVENANCE.txt` records the source and
digest.

`tray/linux.ts` spawns that binary and speaks its JSON-line protocol directly:
it writes the menu (items with `title`, `tooltip`, `checked`, `enabled`, and a
stable `__id`), receives `ready` and `clicked`, and sends `update-menu` and
`exit`. Checked items carry the ` (√)` suffix the binary's own wrapper uses,
because the Linux tray renders checks as text.

No runtime `npm install` is performed. The first sign-in has no network
guarantee, and a tray installed from the network is a supply-chain path the host
does not need. If `vendor/tray/tray_linux_release` is missing, `--tray` fails
with the `npm run vendor:tray` instruction.

The staged binary is x86-64. Linux arm64 is not supported by this design and is
reported as an unsupported architecture rather than run under emulation.

### 5. External programs

Both rows are driven by a single `ExternalAppState`. Presence and running state
are separate:

- **LibreHardwareMonitor**
  - Installed when `--lhm-exe` names an existing file, the vendored
    `vendor/lhm/LibreHardwareMonitor.exe` exists, a standard install path
    exists, or `--lhm-url` answers `/data.json`.
  - Running when the LHM process exists or the web server answers. A process
    with no web server is shown as `LibreHardwareMonitor — running (web server
    off)` and is not started again.
  - In tray mode, if it is installed and not running, the host starts it
    through the background launch described under run mode. It uses the
    existing `launchLhm` path: LHM's registered task when present, otherwise
    the one UAC prompt its manifest requires.
  - `--register-lhm-task` remains the one-time no-prompt setup.
- **RivaTuner Statistics Server**
  - Installed when `--rtss-exe` names an existing file, either standard
    `RTSS.exe` path exists, or the process is running.
  - Running is read through `tasklist /FI "IMAGENAME eq RTSS.exe" /FO CSV /NH`
    and matched on the image name, never on localized prose.
  - Clicking Start spawns the executable detached, with `stdio: "ignore"` and
    `windowsHide: true`, and never waits for it. Yunari does not inject, hook,
    pass options, auto-start, or stop it on Exit.
  - Starting RTSS while a game is already running may not attach to that game;
    the row reports the process, not a guarantee about an existing game.

Both programs are Windows-only. On Linux and macOS their rows are absent. The
start actions are in `tray/external-apps.ts`; the frame and LHM providers are
untouched.

**Now Playing** has no tray row and no new lifecycle. `MediaProvider` already
starts when a display binds a media or audio key, keeps running while demand
continues, and stops after its 30-second grace. The tray host keeps the process
alive, so that behaviour is unchanged.

### 6. Auto start

`serve/host-autostart.ts` becomes the one owner of the sign-in entry:

- **Windows:** `%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\Yunari.vbs`
  runs
  `WshShell.Run """<node>"" ""<bin/yunari.js>"" <flags> --tray -n", 0, False`.
  Window style `0` is what keeps `node.exe`, a console program, from flashing a
  window at sign-in. Enabling or disabling also removes the legacy
  `YunariHost` scheduled task, so an existing entry cannot start a second host.
- **Linux:** `$XDG_CONFIG_HOME/autostart/yunari.desktop`, falling back to
  `~/.config/autostart/yunari.desktop`, with `Terminal=false` and a quoted
  `Exec=` line.
- **macOS:** unsupported; reports so and never writes a LaunchAgent.
- Windows state is true when the VBS **or** the legacy `YunariHost` task
  exists, so an entry registered before this change still reads as on.
  Enabling writes the VBS and removes the legacy task; disabling removes both.
  Linux state is the `.desktop` file's existence. Enabling is idempotent.
  Paths and flags are quoted for the platform, and a path containing a quote is
  refused rather than written into the VBS.
- The tray's Auto start row toggles this entry. Registration failures appear in
  the status line; they are not swallowed.
- `main.ts` registers the same command the current run is using, with `--tray`
  added, so the entry starts the same port, app folder and host flags.

The existing `POST /api/displays/autostart` route keeps its callback and message
contract; only the registrar behind it moves.

### 7. Editor deep links

The tray opens the editor with query parameters:

| Target | URL |
|---|---|
| Theme Editor | `http://localhost:<port>/editor?mode=editor` |
| Theme Store | `http://localhost:<port>/editor?mode=themes` |
| Host Settings | `http://localhost:<port>/editor?mode=this-pc` |
| Pair display | `http://localhost:<port>/editor?publish=1` |

`shell-layout.tsx` reads the entry once, at mount:

- `mode` must be one of the three `ShellMode` values; anything else opens the
  editor. The value is chrome, not authored state, and is never persisted.
- `publish=1` calls the existing `showPublishing()` after the React root mounts.
  It opens the surface and touches no host state; the switch inside the surface
  remains the only control that turns publishing on. `publish=1` has meaning
  only in `mode=editor`; when a non-editor mode is named, it is ignored rather
  than opening a control that mode does not draw.
- A named mode still mounts the editor body hidden, so an unsaved document's
  canvas is not destroyed on the way to the store.
- The mode guard is unchanged: leaving the editor with a dirty document still
  asks the existing replacement prompt.

The phone's `/pair?code=…` URL is untouched. **Pair display** is for the owner
at this PC, not for the phone.

### 8. Opening addresses and folders

`cli/net.ts` gains one `openTarget(target)` helper:

- Windows, URL: `rundll32.exe url.dll,FileProtocolHandler <url>` — a GUI
  subsystem process, so no console flash. `cmd /c start` is removed from the
  browser path.
- Windows, directory: `explorer.exe <path>`; ShellExecute's URL handler is not
  relied on for a folder.
- Linux: `xdg-open <target>`.
- macOS: `open <target>`.

`openBrowser` becomes `openTarget(url)`. `Open Yunari folder` calls
`openTarget(path.dirname(settingsDir))`, so `--app-dir` is honoured. Children
are detached, `stdio: "ignore"`, and unref'd; a launch failure leaves the
printed URL or path usable.

### 9. Errors and shutdown

- Missing tray asset, no graphical session, unsupported platform, or a failed
  PowerShell spawn: `--tray` returns `1` with one sentence naming the cause.
- An external program that disappears between detection and Start: the action
  sets a notice, and the next poll hides or updates the row.
- LHM start failure (no exe, UAC denied, web server off): the row remains
  visible because the program is installed; the notice carries the reason.
- Exit stops only what the host owns. LHM started by this run is stopped;
  RTSS never is; a browser window the owner opened is not touched.

## Ownership and files

| Concept | Owner |
|---|---|
| Menu model and labels | `host/src/tray/menu.ts` |
| Polling, action dispatch, notices | `host/src/tray/controller.ts` |
| Windows NotifyIcon adapter and embedded script | `host/src/tray/windows.ts` |
| Linux systray protocol adapter | `host/src/tray/linux.ts` |
| LHM/RTSS presence, status and Start | `host/src/tray/external-apps.ts` |
| Tray icon bytes | `host/src/tray/tray-icon.ts` |
| Sign-in entry, state and migration | `host/src/serve/host-autostart.ts` |
| `--tray`, `--rtss-exe` and help text | `host/src/cli/args.ts` |
| Open a URL or folder without a console | `host/src/cli/net.ts` |
| Tray wiring and process stop | `host/src/main.ts` |
| Editor entry parameters | `editor/src/editor-shell/shell-entry.ts`, read by `shell-layout.tsx` at mount |
| Staged Linux tray binary | `src/web/packages/host/scripts/vendor-tray.mjs` |

`serve/display-launcher.ts` loses the autostart function and keeps the display
window launcher. `registerHostAutostart` is imported from the new owner where
the server needs it.

## Testing

- **Unit:** menu construction hides external rows when absent, honours checked
  and disabled states, omits empty separators; `--tray` and `--rtss-exe`
  parsing; autostart state/enable/disable against injected temp directories;
  LHM/RTSS path detection with injected `existsSync` results; `tasklist` output
  parsing by image name; `openTarget` command selection per platform.
- **Regression:** hide an external row and the menu test must fail; remove the
  URL mode read and the shell test must fail. Verify each new regression test
  fails with the fix disabled before trusting it.
- **Editor e2e:** `/editor?mode=themes` renders the store region;
  `/editor?mode=this-pc` renders Host Settings; `/editor?publish=1` opens the
  publish popover; an unknown mode opens the editor.
- **Focused proof:** on Windows, start a host with `--tray` against a temporary
  app folder, confirm the icon and every row, toggle Auto start off and on,
  open each editor surface, start RTSS, and Exit; confirm the host process and
  its helper children are gone. Inspect the tray visibly, not only through
  process counts.
- **Unverified:** the Linux tray on a real Linux desktop session, and the live
  RTSS Start action on a machine where RTSS is installed. Both are reported as
  unverified until run; the Linux binary cannot execute on this Windows box.
- **Gate:** run the broad gate at the plan boundary, from `src/web/`.

## Acceptance — 2026-10-25

Split by what was run, not by what the design intends.

**Observed on Windows.** A host started with `--tray` against an app folder whose
`APPDATA` was a `%TEMP%` directory, so no real sign-in entry could be written.
While it ran, the host process stayed up and the PowerShell tray helper child
was present; after termination both were gone. That is process evidence for
start, helper spawn and Exit-time teardown.

**Not observed.** The menu's rendered rows were never seen, and no row or
toggle was clicked: Auto start, Pair display, the three editor surfaces, RTSS
Start and Exit are unverified as user-visible behaviour. The sign-in entry
itself was never executed, so "starts hidden at sign-in" is unverified.

**Editor deep links.** `shell-entry.test.ts` 6/6 and
`editor-deep-links.spec.ts` 5/5 on `desktop-chromium`, both red-proven: making
`parseShellEntry` return defaults failed 4 of 6 unit cases and 3 of 5 browser
cases. Together they cover the four URL entry cases and the unknown-mode
fallback.

**Linux tray — unverified.** The staged ELF was never executed on this box. The
adapter was written from the pinned `systray2@2.1.4` tarball's own source and
strings, so the JSON protocol is inferred from the package, not observed in a
Linux desktop session.

**Gate.** `npm run gate` exits `1`, stopping at `npm run test`; its only failures
are in `packages/host/src/providers/media/smtc-helper.windows.test.ts`, where two
tests time out waiting for the helper (`1/2` "no line within 20000 ms", `2/2`
"expected 0 to be greater than 0"). That path is untouched by this branch
(`git diff bdf113fe..29b4eea8 -- src/web/packages/host/src/providers/media/` is
empty), so it is recorded as pre-existing and environment-suspected — a machine
with no active Windows media session — not as caused by this branch, and not as
proven pre-existing because it was not run at the base commit.

**The status stays `active`.** What closes it: a live run by the owner that
visibly inspects the menu's rows and clicks each action, plus a Linux desktop
run of the staged binary.

## Documentation

- `docs/decisions/0110-the-tray-may-start-rtss-on-request.md` amends 0107's
  "never launch" clause. 0107 keeps every other finding.
- `docs/decisions/0111-the-tray-is-a-host-owned-shell.md` records the tray
  mechanism, the Windows/Linux split and the staged binary.
- `docs/architecture/ownership.md` gains rows for the tray, sign-in entry,
  external-program status/start and editor entry parameters.
- `THIRD-PARTY-NOTICES.md` and `docs/engineering/dependencies.md` gain the
  `systray2`/`systray-portable` MIT notice and its provenance. It is staged,
  not an npm dependency; the release must ship its LICENSE beside the binary.

## Risks and accepted limits

- **Linux tray is unverified here.** The adapter is written against the
  `systray2` 2.1.4 JSON protocol, but no Linux desktop was available to run it.
- **Linux x86-64 only.** An arm64 build needs its own binary and provenance.
- **Windows tray depends on PowerShell 5.1 and WinForms.** A machine that
  blocks PowerShell or lacks the desktop assemblies gets a clear `--tray`
  failure, not a silent background host.
- **LHM auto-start may prompt at sign-in** until its own elevated task is
  registered. Its web server also has to be enabled once in LHM.
- **RTSS is an overlay that hooks games.** The owner asked for a Start action
  and accepted that effect; Yunari itself still never injects or hooks.
- **A menu rebuild can close an open menu.** The controller sends only on a
  changed item list, so the idle 5-second poll does not cause it.
- **Startup-folder VBS depends on Explorer's Startup folder being enabled.**
  A user who disabled it will not get sign-in start; the menu still works.

## Out of scope

- A macOS tray and macOS LaunchAgent.
- Linux arm64.
- Media playback controls, volume or track rows.
- Starting or stopping RTSS automatically, or changing its settings.
- A dashboard row or a second browser route for the tray.
- A general-purpose service manager or a hosted daemon mode.
