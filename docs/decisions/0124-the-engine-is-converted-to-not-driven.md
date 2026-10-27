# 0124 — The engine is converted to, never driven

- **Date:** 2026-10-27
- **Status:** accepted
- **Paths:** `src/web/packages/host/src/server.ts`,
  `src/web/packages/editor/src/editor-session.ts`

Supersedes [0118](0118-a-scene-is-exported-by-driving-the-engine-ui.md). The
read-only library scan, the host-owned paths and the unpack into
`projects/myprojects/` all stand; the UI automation built to drive the engine's
mobile export is removed, because it cannot finish the job from the host's own
process and because the vendor's export is an author action, not a host one.

## The problem

A scene has to become a video without asking the author to open Wallpaper
Engine's editor. 0118 tried the route the shipped product offers: press
right-click → Send to Mobile Device → Export .mpkg with UI Automation, then let
the author confirm the native Save dialog. The problem 0118 named was "press
four controls in a CEF window and confirm the export it opens"; that framing was
the wrong one, because the confirmation is the part that cannot be automated.

## Rung 1 — Yunari

Searched: `host/src/wallpaper-engine/` (`locate`, `library`, `pkg`, `unpack`,
`source`, `export-mobile`), `editor/src/wallpaper-engine/` (`client`,
`export-sheet`), `editor/src/editor-session.ts` (`importWallpaperExport`), and
every `/api/wallpaper-engine/*` route in `server.ts`.

Found: a container reader, an unpack that writes an editable project, a
directory watcher, a video normaliser, and a sheet that lists exports. The
automation was the only part that touched another program's UI, and it lived in
one module (`export-mobile.ts`) plus one route.

## Rung 2 — dependencies

Searched: workspace manifests for a UI-automation binding (`robotjs`, `nut.js`,
`@nut-tree/*`, `koffi`, `ffi-napi`) and for an `.mpkg` reader.

Found: none installed, and none needed. Node ships `child_process`; Windows
ships UI Automation. A native FFI dependency would buy four clicks and a build
cost, not correctness.

## Rung 3 — platform

Searched: the vendor's documented CLI (`-control pause/play/openWallpaper/…`),
CEF remote debugging, `System.Windows.Automation`, and the native Save dialog.

Found: the CLI has no export, render or encode command, and `wallpaperui.exe`
refuses remote-debugging arguments. UI Automation reaches the CEF tree and Win32
clicks dispatch, but **the Save dialog is unreachable from the host's child
process**: a fresh interactive PowerShell sees the dialog's `File name:` `Edit`
and `Save` `Button`, while a child PowerShell started the way the host starts
one answers the dialog's ancestor list only (`kids=36`, `edit=False`). Not one
of nine attempts from the child succeeded. That is a platform boundary; the
author's Save click is irreducible.

## Rung 4 — ecosystem

Searched: `"automate Wallpaper Engine export"`, `"wallpaper engine .mpkg export
command line"`, `"unmpkg repkg wallpaper engine mobile package wallpaper.mp4"`,
`"Wallpaper Engine mobile video export"`.

Found: **no project exports headlessly.** RePKG, RePKG-GUI, unmpkg, lianpkg and
World Wallpaper Extractor all consume an `.mpkg` a *human* exported through the
UI, then extract `wallpaper.mp4`. The vendor's FAQ documents the same manual
route. The extraction half is a table walk this host already owns; the export
half has no automated shape at all.

## Rung 5 — comparison

| Option | Fit | Cost | Risk | Verdict |
|---|---|---|---|---|
| UI Automation to the engine's export modal (0118) | presses the shipped controls | ~200 lines of PowerShell plus a host module | UI text/geometry drifts; the Save click is still the author's | rejected: the host cannot reach the dialog it ends at |
| Patch/inject `wallpaperui.exe` | full control | DLL injection; vendor blocks debugging | AV false positives, silent wrong output | rejected |
| CEF remote debugging | scripted DOM | none | refused by the app | rejected |
| Render scenes in Yunari | one pipeline | months; shaders, particles, text | unported features wrong | rejected (unchanged) |
| Unpack only; the author exports | no automation, no drifts | deleting code | the author does one manual step | **chosen** |

## Rung 6 — probe

Measured by 0118 on Wallpaper Engine 2.8.42 (2026-10-26), this PC:

- The full UIA sequence reached the export modal and wrote a `.mpkg`
  (`full_moon_[fhd].mpkg`, 3,167,134 bytes).
- The Save dialog was reachable from an interactive PowerShell but never from
  the host's encoded child process (`kids=36`, `edit=False`, 0/9 attempts).
- A project filed into a Wallpaper Engine folder is not in the root grid, and
  the grid's Source filter does not answer synthetic clicks at all.
- The engine starts minimized to the tray when Steam launches it, so a launch
  without restoring the `WPEUI` window answers `no-window` for every attempt.

Every measurement says the same thing: the automation can start the export and
cannot finish it. Removing it costs the author one menu they already know.

## Rung 7 — build

Delete `export-mobile.ts` and its two tests, `launchEditor`, `startDetached`,
`ExportFile`, the three export routes and the source methods behind them.
`unpack.ts` keeps the table walk and gains one field: a fresh project's
descriptor title is prefixed with `"[yunari] "` (never doubled), so an unpacked
project is distinguishable from the workshop item it came from. `project()`
answers only `{ ok, name, reused }`; nothing spawns a process from it.

## Decision

The host **converts and the author exports**; the engine is never driven. A
scene import unpacks the package into `projects/myprojects/<id>/` with the
descriptor's `file` pointed at `scene.json` and a `"[yunari] "` title prefix,
and stops. There is no launch, no Save-dialog watcher, no export folder scan,
and no route that starts another program. The author opens the project in
Wallpaper Engine and exports the video from there; the editor's import path
takes the resulting file as an ordinary video asset.
