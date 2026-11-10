# 0131 — Always on top is a native window flag

- **Date:** 2026-11-10
- **Status:** accepted
- **Paths:** `src/web/packages/host/src/serve/window-topmost.ts`,
  `src/web/packages/host/src/providers/helpers/supervisor.ts`,
  `src/web/packages/host/src/providers/helpers/foreground.ts`

## Problem

A local display's window is opened by the host as a Chromium `--app` window
(`serve/display-launcher.ts`, `browserCommand`). The owner wants one of those
windows kept above other windows, chosen per display and surviving a restart.
A wrong choice fails quietly: a flag that only applies at creation is lost when
the launcher restarts the window, and a window found by title follows whatever
the page happens to call itself.

## Rung 1 — internal owner

Searched: `codegraph_explore` for `createDisplayLauncher`, `browserCommand`,
`DisplayRecord`, `DisplayPatch`, `findBrowser`; grep for `SetWindowPos`,
`HWND_TOPMOST`, `topmost`, `always-on-top` across the host and editor.

Found: `display-launcher.ts` owns the argv and the child process per display;
`settings/displays.ts` owns the record and the patch rules;
`server/displays-routes.ts` answers a PATCH and already restarts a panel for a
stream change. No topmost code exists, and no browser option can express it.
The launcher keys its windows by display id, which is the identity a patch
arrives with — but a spawned browser's window belongs to whichever of its
processes creates it, so the launcher's child pid is not enough.

## Rung 2 — installed dependencies

Searched: the host's `package.json` runtime dependencies, `node_modules` for
window-management packages, and the Chromium switches `browserCommand` already
passes.

Found: the host has no Electron, no native addon and no window-management
dependency; adding one would be a native module whose build is a second thing
to ship. Chromium accepts no "always on top" switch.

## Rung 3 — native platform

Searched: Win32 window APIs and the repo's existing PowerShell P/Invoke
precedent.

Found: `SetWindowPos(hwnd, HWND_TOPMOST | HWND_NOTOPMOST, …, SWP_NOMOVE |
SWP_NOSIZE | SWP_NOACTIVATE)` changes the extended style without moving or
focusing the window. `providers/helpers/foreground.ts` already runs an
`Add-Type` C# block through PowerShell with `-EncodedCommand` and a hidden
window, so the invocation pattern is established. Windows leaves unsolved only
the discovery problem: which HWND is this display's.

## Rung 4 — public solutions

Searched: "always on top browser app no flag", "SetWindowPos HWND_TOPMOST
PowerShell", comparable tools (Microsoft PowerToys Always On Top, AutoHotkey
WinSet AlwaysOnTop).

Found: every implementation reduces to `SetWindowPos` on an HWND; browser-based
ones locate the window by process or by title. Title matching is the fragile
variant — the player page's title is product copy, not an identity.

## Rung 5 — integration comparison

| Option | Fit | Unsolved work | Verdict |
|---|---|---|---|
| Chromium command-line flag | none exists | — | rejected: no such switch |
| New native dependency | a full native build for one call | packaging, ABI, release | rejected |
| `SetWindowPos` found by window title | works | title is page copy, not identity | rejected |
| `SetWindowPos` on processes holding the display's own `--user-data-dir` | exact per-display identity, reuses the launcher's profile path | tolerant retry while Chromium creates the window | **chosen** |

## Rung 6 — smallest probe

Ran a standalone PowerShell script against a real window: found its HWND
through `EnumWindows` and `GetWindowThreadProcessId`, called `SetWindowPos` with
`HWND_TOPMOST`, read `WS_EX_TOPMOST` back as set, then with `HWND_NOTOPMOST` and
read it back as clear. Both calls returned true. The probe also showed the
window belonged to a different process than `Start-Process` returned, which is
why discovery filters a process **set** whose command line contains the profile
path rather than the spawned pid alone.

## Decision

Build a small Windows-only `serve/window-topmost.ts`: PowerShell `Add-Type` plus
`SetWindowPos`, over every visible top-level window whose owning process was
started with the display's `--user-data-dir` path. The launcher applies it after
a (re)launch and when the record's `alwaysOnTop` changes; the store keeps the
boolean on a local display and stores absence as off. Non-Windows is a reported
no-op, never a claimed success. The PowerShell string-literal escape moves to
`providers/helpers/supervisor.ts` so the two hosts of embedded scripts share one
rule instead of two copies.
