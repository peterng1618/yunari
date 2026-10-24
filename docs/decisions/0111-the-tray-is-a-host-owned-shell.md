# 0111 — The tray is a host-owned shell, not a second process

- **Date:** 2026-10-25
- **Status:** accepted 2026-10-25
- **Paths:** `src/web/packages/host/src/tray/external-apps.ts`,
  `src/web/packages/host/src/tray/menu.ts`,
  `src/web/packages/host/src/tray/controller.ts`,
  `src/web/packages/host/src/tray/windows.ts`,
  `src/web/packages/host/src/tray/linux.ts`,
  `src/web/packages/editor/src/editor-shell/shell-layout.tsx`,
  `src/web/packages/host/scripts/vendor-tray.mjs`

## The problem

The host is a Node service with a browser editor. It has no window of its own
and no way to keep running without a terminal. A tray icon is the smallest
surface that can start at sign-in, reopen the editor's existing modes, pair a
display, manage external programs and exit.

The shape is not "put an icon in the tray". It is a second lifecycle that must
not become a second owner: the host must stay the one process that owns the
server, displays, providers and settings, while the tray is a platform-specific
view over it. The wrong shape either duplicates the server (two tray apps
fighting for the lock), launches a console at every sign-in, or adds a native
binary and an AV surface to a Windows install that already has none of that.

## Rung 1 — Yunari

Searched: `rg -n -i "systray|notifyicon|system tray|tray|autostart"` across
the repo (excluding `dist`, `node_modules`, `vendor`); `packages/host/src/`;
`packages/editor/src/editor-shell/`; `packages/host/public/`.

Found:
- `serve/display-launcher.ts` has `registerHostAutostart`, a Windows
  `schtasks` registration with no state read, no removal and no Linux path.
- `cli/net.ts` has `openBrowser`, using `cmd /c start` on Windows.
- `editor-shell/shell-layout.tsx` owns the three modes and `showPublishing()`;
  neither is addressable from outside the page.
- `HostingStore`, `PublishControl` and `/api/pairing/code` already implement
  Pair display.
- `providers/lhm-launcher.ts` already launches LHM and reports elevation.
- `providers/frame/rtss.ts` already reads RTSS when it runs.
- No tray module, no tray asset, no `--tray` flag, no sign-in entry that starts
  a hidden host.

## Rung 2 — dependencies

Searched: `packages/host/package.json`; the workspace dependency tree; npm for
tray packages.

Found: `ffmpeg-static`, `node-forge`, `systeminformation`, and workspace
packages. No tray package, no Electron/Tauri shell, no native addon. The host
runs on Node 22+ and serves a browser; there is no GUI toolkit in the process.

## Rung 3 — platform

Searched: Windows desktop APIs available through PowerShell 5.1; Linux status
icon protocols; Node's own APIs.

Found:
- **Windows:** `System.Windows.Forms.NotifyIcon` with a
  `ContextMenuStrip` is present in PowerShell 5.1. It gives an icon, a tooltip,
  checked/disabled items, separators and click events. It needs no native
  build and no extra binary. It is a UI-thread object; stdin must be read off
  that thread.
- **Linux:** StatusNotifierItem/AppIndicator is a D-Bus protocol, not a Node
  API. There is no built-in status icon. A Go binary (`systray-portable`, used
  by `systray2`) speaks a small JSON-line protocol over stdin/stdout and is the
  same shape as the Windows script.
- **macOS:** `NSStatusItem` requires a native app; out of scope.
- Node supplies `spawn`, `readline` and `chmod`, not a tray.

## Rung 4 — ecosystem

Searched:
- The 9remote checkout: `host/cli/utils/tray.js`,
  `host/cli/utils/assets/tray.ps1`, `host/cli/utils/autostart.js`,
  `host/cli/scripts/install.js`.
- The 9router checkout: `cli/src/cli/tray/{tray.js,trayWin.js,tray.ps1,autostart.js}`,
  `cli/hooks/trayRuntime.js`.
- `npm search systray`, `npm search node-systray`, `npm search trayicon`,
  `npm search electron-tray` (live).

Found:
- 9remote and 9router use the same split: PowerShell WinForms on Windows,
  `systray2` on macOS/Linux. Their Windows autostart is a Startup-folder VBS
  with `WshShell.Run(..., 0, False)`, specifically because `node.exe` is a
  console program and flashes a window when started directly. 9remote
  lazy-installs `systray2` into a runtime folder with npm; 9router pins the
  version and overlays an arm64 binary.
- `systray2@2.1.4` is MIT, ships x86-64 binaries for all three desktop
  platforms, and its Linux binary is a stripped ELF. The original `systray`
  and `forked-systray` bundle or download the same family; `trayicon` and
  `n-windows-tray` are Windows-only hosts; the Electron packages require
  Electron.
- No package owns the host lifecycle, the menu model or the autostart
  migration. They provide the icon, not the integration.

## Rung 5 — comparison

| Option | Fit | Cost | Risk | Verdict |
|---|---|---|---|---|
| PowerShell NotifyIcon on Windows; staged `systray2` Linux binary on Linux | No new native surface on Windows; one protocol per platform; the host owns the menu and lifecycle | Two adapters and a staged binary for Linux | Linux binary is x86-64 and needs staging; Windows depends on PowerShell | Chosen |
| Add `systray2` as a normal dependency on every platform | One adapter, no embedded PowerShell | Ships the unused Windows Go binary (3.5 MB) and its AV surface to every install | Unknown unsigned binary in a Windows app that otherwise has none | Rejected |
| Lazy `npm install systray2` on first tray start | No dependency and no binary in the repo | Needs npm and the network at sign-in; a failed first login has no tray | Invisible host when the install fails; supply-chain path at runtime | Rejected |
| Electron/Tauri tray | Native tray and menus | A second shell/runtime and a second build | The product is a Node server plus a browser; a desktop runtime is a new platform | Rejected |
| `yad`/`zenity`/`notify-send` | No binary to stage | Not guaranteed installed; no checked menu; shell quoting | A tray that silently does not appear | Rejected |
| Implement StatusNotifierItem directly over D-Bus | Pure Node | Large protocol surface and a new dependency for menus | Desktop-specific behaviour that nobody here can test | Rejected |

## Rung 6 — probe

Probe on this Windows 11 machine, 2026-10-25:

- `NotifyIcon` was created with `SystemIcons.Application`, made visible and
  disposed: `notifyicon-ok`.
- **`Console.In.Peek()` blocks the WinForms UI thread.** A probe with a 50 ms
  poll timer calling `Peek()` and a 100 ms tick timer printed `started` and
  then **zero ticks** in 12 seconds; the process had to be killed. The script
  therefore reads stdin on a background thread, not from the UI timer.
- `systray2@2.1.4` tarball:
  `https://registry.npmjs.org/systray2/-/systray2-2.1.4.tgz`, SHA-256
  `24a176933952c4db79026dcec25c7acf48e5c1cee5d94bc6b87740060bc8ed00`.
  Its `LICENSE` is MIT (Copyright 2017 Zack Young).
- `traybin/tray_linux_release` is ELF 64-bit LSB, x86-64, dynamically linked,
  stripped, 3.5 MB. The package's `index.js` shows the protocol: spawn, read
  `ready`, write the menu JSON, read `clicked`/`exit`, send `update-menu`.
- RTSS is installed and not running; LHM is not installed. No Linux desktop is
  available on this machine, so the Linux adapter is **unverified**.

## Rung 7 — build

- Vite bundles only TypeScript into `dist/main.js`; it emits no assets. The
  Windows PowerShell script and the tray icon PNG are therefore embedded
  strings in TypeScript, not files that a build step could forget to copy.
- The Linux binary is staged by
  `src/web/packages/host/scripts/vendor-tray.mjs` into
  `packages/host/vendor/tray/`, following `vendor-presentmon.mjs`: pinned URL,
  pinned SHA-256, a `LICENSE`, and a `PROVENANCE.txt`. The binary stays out of
  git. `npm run vendor:tray` is the build step.
- The tray is a view over the same process. `main.ts` passes it snapshot and
  action callbacks; no HTTP route is added, and no second server or lock is
  created.
- Auto start is an OS entry, not a settings file: a Windows Startup-folder VBS
  (hidden) or a Linux `.desktop` entry with `Terminal=false`. The legacy
  `YunariHost` scheduled task is removed on the first enable or disable so it
  cannot start a duplicate host.

## Decision

The tray is a host-owned shell with two platform adapters:

1. **Windows:** PowerShell 5.1 WinForms `NotifyIcon`, embedded in TypeScript,
   with stdin read on a background thread. No native binary, no console.
2. **Linux:** a staged `systray2@2.1.4` Linux binary driven by the host's own
   JSON-line adapter. No runtime npm install.

The menu model, polling, notices and action dispatch live in the host and are
platform-neutral. The editor surfaces are reached by `?mode=`/`?publish=1`
parameters on the existing page, not by a new route or a second shell. Auto
start writes the platform's own sign-in entry and starts the same host with
`--tray`, so there is one process owner.

RTSS's Start action is separately recorded in
[0110](0110-the-tray-may-start-rtss-on-request.md).
