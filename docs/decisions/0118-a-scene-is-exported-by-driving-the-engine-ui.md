# 0118 — A scene is exported by driving the running engine's own UI

- **Date:** 2026-10-26
- **Status:** accepted
- **Paths:** `src/web/packages/host/src/server.ts`,
  `src/web/packages/editor/src/editor-session.ts`,
  `scripts/`

Supersedes the "Yunari never drives Wallpaper Engine (R1)" clause of
[0097](0097-the-wallpaper-engine-library-is-read-by-the-host.md). The read-only
library scan, the host-owned paths and the unpack into `projects/myprojects/`
all stand; only the refusal to drive the UI changes, because the owner asked for
it explicitly and because the alternative is no automated path at all.

## The problem

Wallpaper Engine's editor export dialog is hidden in normal builds
(`isDebugRuntime` is false outside the vendor's dev tree), so the PNG/MP4 export
the import spec advertised does not exist for a user. The only shipped way to
turn a scene into video is **right-click → Send to Mobile Device → Export
.mpkg**, which always carries "Keep original aspect ratio" and "Original" once
those are picked. The `.mpkg` is a `PKGM` table holding `wallpaper.mp4`.

The shape of the problem is not "run the engine"; it is "press four controls in
a CEF window and confirm the export it opens, then pick up the file it writes".

## Rung 1 — Yunari

Searched: `host/src/wallpaper-engine/` (`locate`, `library`, `pkg`, `unpack`,
`source`, `wire`), `editor/src/wallpaper-engine/` (`client`, `export-sheet`),
`editor/src/editor-session.ts` (`importWallpaperExport`), `host/src/themes/
normalize-video.ts`, and the existing `/api/wallpaper-engine/*` routes.

Found: a host-side container reader, an unpack that writes a runnable project,
a watcher over three directories, an import that already normalises an MP4, and
an export sheet driven by `findExports`. Everything after "a `.mp4` exists on
disk" is already built. Nothing drives the UI, and `launchEditor` starts
`bin/wallpaperui.exe` directly — which the app refuses with "UI improperly
started".

## Rung 2 — dependencies

Searched: workspace manifests for a UI-automation binding (`robotjs`,
`nut.js`, `@nut-tree/*`, `koffi`, `ffi-napi`) and for a native `.mpkg` reader.

Found: none installed, and none needed. Node ships `child_process`; Windows
ships UI Automation and `user32.dll`. A new native FFI dependency for four
clicks is a build and packaging cost with no correctness gain.

## Rung 3 — platform

Searched: the vendor's documented CLI (`-control pause/play/openWallpaper/…`),
CEF remote debugging, and `System.Windows.Automation`.

Found: the CLI has no export, render or encode command, and `wallpaperui.exe`
refuses remote-debugging arguments outright. UI Automation exposes the CEF
accessibility tree as ordinary `Button`/`Text`/`Hyperlink`/`Edit` elements, and
Win32 `SetCursorPos` + `mouse_event` dispatch the right-click and left-click the
CEF layer actually listens for. The platform leaves ordering, waits and failure
classification to us.

The Save dialog is a native Explorer window, and it is **not** reachable from the
process that drives the engine: a fresh interactive PowerShell finds it as a
descendant of the desktop root with a `File name:` `Edit` and a `Save` `Button`,
while a child PowerShell started the way the host starts one (base64
`-EncodedCommand`, no console) answers the same query with the dialog's ancestor
list only (`kids=36`, `edit=False`). `ValuePattern.SetValue` with a full path does
work — from the interactive process. Not one of nine attempts from the child
succeeded, including window-scoped searches, root-level rescans and SendKeys.
That is a platform boundary, not a bug to keep chasing.

## Rung 4 — ecosystem

Searched: `"automate Wallpaper Engine export"`, `"wallpaper engine .mpkg export
command line"`, `"unmpkg repkg wallpaper engine mobile package wallpaper.mp4"`,
`"Wallpaper Engine mobile video export"`.

Found: **no project exports headlessly.** Every tool found (RePKG, RePKG-GUI,
unmpkg, lianpkg, World Wallpaper Extractor) consumes an `.mpkg` that a *human*
exported through the UI, then extracts `wallpaper.mp4`. The vendor's own FAQ
documents the same manual route. Two consequences: the UI step is irreducible,
and the extraction half is a solved, documented table walk we already own.

## Rung 5 — comparison

| Option | Fit | Cost | Risk | Verdict |
|---|---|---|---|---|
| Render scenes in Yunari | one pipeline | months; shader compiler, particles, text | every unported feature wrong | rejected (R2, unchanged) |
| Patch/inject `wallpaperui.exe` | full control | DLL injection; vendor blocks debugging; breaks each release | anti-cheat/AV false positives, silent wrong output | rejected |
| CEF remote debugging | scripted DOM | none | refused by the app (`remote-debugging` arguments rejected) | rejected |
| UI Automation + Win32 clicks, our own PowerShell helper | presses the shipped controls; no binary touched | ~200 lines of PowerShell + one host module | UI text/geometry changes between releases; the author still clicks Save | **chosen** |
| Shell out to RePKG/unmpkg | extraction | new runtime dependency | still leaves the export manual | rejected: the table walk is already ours |

## Rung 6 — probe

Measured on Wallpaper Engine 2.8.42 (2026-10-26), this PC:

- Full Moon [FHD]: full UIA sequence, default Save location (Documents) →
  `full_moon_[fhd].mpkg`, 3,167,134 bytes.
- No Man's Sky: same sequence with `ValuePattern.SetValue` on the Save dialog's
  **File name** field → `nms-test.mpkg` written to an arbitrary absolute path,
  56,554,610 bytes. Modal read "Keep original aspect ratio" / "Original" without
  being clicked, because the previous export left those choices in place.
- `nms-test.mpkg` header `PKGM0014`, four members: `nopreview.jpg` (9,132),
  `project.json` (393), `scene.json` (13,411), `wallpaper.mp4` (56,531,562,
  starts `00 00 00 18 66 74 79 70 6d 70 34 32` — a valid `ftyp mp42`).
- A theme whose workshop creator has not accepted the current Steam Workshop
  subscriber agreement raises "mobile usage permission required" instead of the
  export modal. Exporting the **unpacked local project** bypassed it for the
  themes measured; this is a local-project property, not a per-theme one.
- The built script reached the export modal and its Save dialog, from a fresh
  process and from the host's module, for `Tokyo` on 2026-10-26
  (`YUNARI_WE:{"ok":true}`). A dismissed Save dialog still answers UI Automation
  as a window named `Save As`, so `ok` requires a non-zero handle that
  `IsWindowVisible` agrees with; without that guard a ghost from an earlier run
  read as a success.
- A project filed into a Wallpaper Engine **folder** is not in the root grid and
  is not listed under Source → My Wallpapers either, so the search answers
  `no-tile`. Measured with `Full Moon [FHD]`, which a folder named
  `yunari-background` holds by its absolute `scene.json` path. The export route
  and folder membership are mutually exclusive in 2.8.42 unless the folder itself
  is visible in the filtered grid, and it was not.
- REA: Ghidra 12.1.4 + JDK 21 installed and healthy, but `rea inspect` on the
  12 MB `wallpaperui.exe` hit the 330 s provider timeout on `list_documents`.
  Runtime UIA evidence answered the question static analysis was opened for, so
  the binary was not re-opened.

## Rung 7 — build

One host module (`export-mobile.ts`) holding the PowerShell script as a string,
one `PKGM` branch in the existing table reader, one route, one client call and
the sheet's button. No dependency, no second process owner, no config edits. The
save itself needed no new machinery: `exportsSince` already watches the engine's
export folder and the importer already normalises an MP4, so the host only has to
put the extracted video where that watcher looks.

## Decision

Yunari drives the **running** Wallpaper Engine main window over UI Automation to
the engine's own mobile export modal, sets "Keep original aspect ratio" and
"Original", confirms it, and leaves the native Save dialog open. The automation
never patches, injects, or launches the editor with `-project`; it starts the main
UI and presses the same controls a person would.

Saving is the author's click, deliberately: the Save dialog's controls are not
reachable from the host's child process (Rung 3), and a filename typed into it is
not worth the fragility. The host watches Documents — the dialog's own default —
for the package that click produces, reads `wallpaper.mp4` out of it, and writes
it into the engine's export folder, where the existing watcher and importer take
over. Every failure — window absent, tile absent, agreement modal, no Save dialog
— is returned as a named reason and the sheet names the manual route instead.
