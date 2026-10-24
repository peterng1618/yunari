# 0110 — A game is identified from local launcher data, never a network search

- **Date:** 2026-10-24
- **Status:** accepted
- **Paths:** `src/web/packages/host/src/providers/game/game-catalogue.ts`,
  `src/web/packages/host/src/providers/game/game-catalogue.test.ts`,
  `src/web/packages/host/src/providers/game/game-classifier.ts`,
  `src/web/packages/host/src/providers/game/game-classifier.test.ts`,
  `src/web/packages/host/src/providers/game/provider.ts`,
  `src/web/packages/host/src/providers/game/provider.test.ts`,
  `src/web/packages/host/src/providers/helpers/foreground.ts`,
  `src/web/packages/renderer-core/src/data/sensor-catalogue.ts`,
  `src/web/packages/renderer-core/src/data/sensor-catalogue.test.ts`,
  `src/web/packages/editor/src/sensor-catalogue.ts`,
  `src/web/packages/player/src/main.ts`

## The problem

`game.running` is `foreground.pid !== 0`, so a browser, an editor or the desktop
reads as a running game, and the Steam store lookup may then be asked to name
that window. The user asked whether searching Steam first would fix it. It would
not: one request per foreground change, process names leaving the machine for
non-games, fuzzy false positives on common words, and a multi-second gap before
`running` could be true. The question is really "what makes this process a
game?" and the answer has to be local.

The second half is unrelated but shares the display surface: the player has no
descriptor catalogue, so a custom source's unit converts in the editor preview
and never on a display (vg-717).

## Rung 1 — Yunari

Searched: `providers/game/` (provider, `steam-library`, `box-art`,
`store-metadata`), `providers/helpers/foreground.ts`, decision 0108/0109, the
sensor spec's game section, `editor/src/sensor-catalogue.ts`,
`renderer-core/src/scene/plan.ts` and `scene-fabric/src/fabric-text.ts`.
Found: Steam is the only catalogue read (`libraryfolders.vdf` + `appmanifest_*.acf`);
presence is any nonzero pid; the store lookup is demand-driven for name/artwork.
`refreshBoundText` already accepts descriptors — the player simply never passes
them, and the wire mapping lives in the editor package, which the player cannot
import.

## Rung 2 — dependencies

Searched: workspace manifests for game, registry, VDF, SQLite or manifest
readers.
Found: none, and the plan's Global Constraints forbid new runtime dependencies.
Node has no registry API; the host already reads HKCU for Steam through
PowerShell (0108). No JSON-file reader or PE parser is needed beyond `fs`.

## Rung 3 — platform

Searched: Windows launcher formats and Win32 APIs.
Found, all readable without admin:

- Steam: `appmanifest_*.acf` + `libraryfolders.vdf` (already implemented).
- Epic: `%ProgramData%\Epic\EpicGamesLauncher\Data\Manifests\*.item` JSON with
  `DisplayName`, `InstallLocation`, `LaunchExecutable`, `AppName`,
  `MainGameAppName`, `bIsIncompleteInstall`.
- GOG: `HKLM\SOFTWARE\WOW6432Node\GOG.com\Games\*` with `gameName`, `path`,
  `exe`, `dependsOn` (DLC marker).
- itch: `%APPDATA%\itch\apps\<game>\` with `.itch.toml`.
- Xbox: `C:\XboxGames\<Title>\Content\MicrosoftGame.config`.
- Microsoft Store / Game Pass: `Get-AppxPackage` through PowerShell gives
  `Name`, `PackageFullName`, `InstallLocation`, `IsFramework`; GDK titles carry
  `MicrosoftGame.config` in that location. UWP windows are hosted by
  `ApplicationFrameHost.exe`, so the helper resolves the child
  `Windows.UI.Core.CoreWindow` to reach the game's own process.
- Generic installers: uninstall registry keys carrying `InstallLocation` and
  `DisplayIcon`.
- `SHQueryUserNotificationState` returns `QUNS_RUNNING_D3D_FULL_SCREEN` for a
  running D3D fullscreen app (PowerToys uses exactly this), and
  `GetWindowRect` + `GetMonitorInfo` identify borderless fullscreen. Both are
  one P/Invoke away from the existing PowerShell foreground helper.
- Window class (`GetClassName`) names the engine: `UnityWndClass`,
  `UnrealWindow`, `SDL_app`, `GLFW30`.

Probes on this PC: the Epic manifest directory holds `EFA9D695…item`, the GOG
registry holds `A Space for the Unbound` (`path`, `gameName`), `C:\XboxGames`
exists with only `GameSave/`, and itch is absent — so a test cannot rely on the
author's machine having any of them.

## Rung 4 — ecosystem

Searched: GitHub/npm for installed-game detection — `EqualGames/game-scanner`
(Rust + napi, Launcher support table), `tv7/Orbit` (C++/Qt, documents the exact
Steam/Epic/GOG/Xbox sources), `VantaCode420/SmartHdrManager` (C# scanner with
per-source readers), `tekgator/GameLib.NET`, `garpunkal/GameIcons` (PowerShell,
same sources plus itch), `dorsaljr/PANOMI`.
Found: every implementation is a native/other-language launcher library; none
is a Node library. `@equal-games/game-scanner` is the closest, but it is a
per-platform native addon, does not cover itch or Xbox, and its Steam state model
is much larger than "name this process". The formats are the reusable knowledge;
the parsers are not.

For classifying a foreground window: `PowerToys` uses
`QUNS_RUNNING_D3D_FULL_SCREEN`; a public overlay project moved from enumerating
graphics modules to "known process names + window class + fullscreen"; a
standby-timer app polls "window rect equals monitor rect" and explicitly rejects
ETW/WMI/D3DKMT as heavier with more permissions.

## Rung 5 — comparison

| Option | Cost | Why not alone |
|---|---|---|
| `@equal-games/game-scanner` | new native dependency, per-platform binaries | no itch/Xbox, no window signal, still needs the classifier |
| PowerShell launcher scan at provider start | one process, slow first demand | workable, but every format is a few lines of `fs`/registry; a script is harder to unit-test |
| Local catalogue + window evidence (chosen) | two small modules, no dependency | must accept that an uncatalogued windowed game is not "running" |
| Steam-store search first (user's question) | one request per foreground change | privacy leak, false positives, latency, offline gap |

## Rung 6 — probe

Probes listed in rung 3, plus: the existing `power-shell` helper already parses
`ConvertTo-Json` single lines, and `parseForegroundLine` drops unknown fields, so
adding `class`, `fullscreen` and `d3dFullscreen` to one line is backward
compatible.

## Rung 7 — build

`providers/game/game-catalogue.ts` reads each source with an injected
`readFile`/`readdir`/`runPowerShell` seam and returns one `InstalledGame[]`
(`source`, `name`, `exes`, `installDir`). `game-classifier.ts` decides
`running` from that list, then from runtime markers beside the exe, then from
window evidence (class plus fullscreen held for two samples), with a non-game
exclusion list. The provider loads the catalogue lazily per demand window and
keeps the store lookup demand-driven exactly as 0109 left it.

For vg-717, the wire→descriptor mapping moves to
`renderer-core/src/data/sensor-catalogue.ts` (pure, no fetch); the editor's
catalogue calls it, and the player fetches `/api/sensors` once per session and
passes the descriptors to `refreshBoundText`.
