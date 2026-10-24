# Game identity and the display catalogue

- **Date:** 2026-10-24
- **Status:** accepted
- **Rows:** vg-723, vg-724, vg-717
- **Decision:** [0110](../decisions/0110-game-identity-is-a-local-catalogue-match.md)
- **Builds on:** [sensor platform](2026-10-24-sensor-platform-design.md), §93, §97

## Goal

A running game is identified from data already on this PC, without a network
request, and a display converts a custom source's units exactly as the editor
preview does. Two outcomes define success:

1. `game.running` is true for a game and false for a browser, an editor, a
   terminal or the desktop, offline, within one sample of it becoming
   foreground.
2. A theme bound to a custom `°C` key with a `°F` display unit reads `°F` on the
   player, not only in the editor.

## Decisions

### D1 — Presence means "identified as a game", not "any foreground window"

`game.running` stops deriving from `pid !== 0`. A foreground process counts as a
game when one of these holds, in order:

1. **Catalogue match** — its executable sits inside an install root read from a
   game store or launcher on this PC (`steam`, `epic`, `gog`, `itch`, `xbox`,
   `appx`).
2. **Runtime marker** — its own directory holds a game-runtime artefact
   (`steam_api64.dll`, `steam_api.dll`, `EOSSDK-Win64-Shipping.dll`,
   `Galaxy64.dll`, `Galaxy.dll`, `UnityPlayer.dll`, `EasyAntiCheat`,
   `BattlEye`, `*.pak` beside an `Engine` directory).
3. **Window evidence** — `fullscreen` or `d3dFullscreen` is true **and** the
   window class is one of the engine classes (`UnityWndClass`,
   `UnrealWindow`, `SDL_app`, `GLFW30`, `Allegro`), held for two consecutive
   helper samples.

No catalogue, marker or window signal means `game.running` is `false`.
`game.app` still reports the executable's file name, and `game.name` still asks
the store only when demanded, exactly as decision 0109 left it. The store is
never consulted to decide whether something is a game.

**Packaged (Microsoft Store / Game Pass) apps are resolved past their host.**
A UWP title's foreground window is an `ApplicationFrameWindow` owned by
`ApplicationFrameHost.exe`, not the game process. The helper therefore reports
the child `Windows.UI.Core.CoreWindow`'s process and class when the foreground
class is `ApplicationFrameWindow`; the frame host never reaches the classifier.
If the child cannot be found, the reading names the frame host and the
classifier answers `false` rather than claiming a game.

**Ruling on the user's question:** "silently search Steam first" is rejected.
It costs one request per foreground change, sends the names of non-game
processes to Valve, accepts fuzzy false positives on common words, and leaves
`running` unknown for the seconds a lookup takes. The catalogue and window
signals answer the same question locally and offline.

### D2 — The catalogue is read, cached per demand window, and never written

Sources and the fields read:

| Source | Where | Fields |
|---|---|---|
| Steam | existing `steam-library.ts` | `appid`, `name`, `installdir` |
| Epic | `%ProgramData%\Epic\EpicGamesLauncher\Data\Manifests\*.item` | `DisplayName`, `InstallLocation`, `LaunchExecutable`, `AppName`, `MainGameAppName`, `bIsIncompleteInstall` |
| GOG | `HKLM\SOFTWARE\WOW6432Node\GOG.com\Games\*` via PowerShell | `gameName`, `path`, `exe`, `dependsOn` |
| itch | `%APPDATA%\itch\apps\<game>\.itch.toml` | install root and its launch executable(s) |
| Xbox | `C:\XboxGames\<Title>\Content\MicrosoftGame.config` | `Executable` (or the sole `.exe` under `Content`) |
| Microsoft Store (GDK only) | `Get-AppxPackage` through PowerShell | `Name`, `PackageFullName`, `InstallLocation`, `IsFramework`, and the `MicrosoftGame.config` a package must carry to be a game |

A DLC or incomplete install is skipped (Epic `MainGameAppName` mismatch,
`bIsIncompleteInstall`, GOG `dependsOn`). A source that is missing is an empty
list, never an error. Nothing is written, and nothing leaves the machine.

### D3 — Classification evidence is reported, not guessed

The classifier returns `{ running, evidence, game? }` so a test and a future
status line can tell a catalogue match from a fullscreen heuristic. The
`evidence` value is not exposed as a sensor this plan.

### D4 — Linux is deferred, not half-built

Manifest parsing is portable but presence is not: the helper is PowerShell and
`GetForegroundWindow`. The Linux half of vg-724 stays open until a Linux
foreground source exists; this plan ships Windows readers only.

### D5 — One descriptor mapping, shared by the editor and the player

The wire→descriptor mapping (`sensor-catalogue.ts`'s `descriptorFromWire`,
`mergeWithBuiltIns`, whitelists) moves to
`@yunari/renderer-core/src/data/sensor-catalogue.ts`. The editor's
`createSensorCatalogue` keeps its fetch/refresh and calls the shared mapping.
The player (D6) fetches `/api/sensors` itself.

### D6 — The player loads descriptors once per session and repaints with them

`startHostedTheme` fetches `{ sensors }` through the display session's `fetch`
(same failure rule as display preferences: a failed request keeps the built-in
vocabulary and is not an author-facing error), maps them with D5, and passes
them as the seventh argument to `refreshBoundText` on every repaint. No
persisted data changes and no theme field is added: the catalogue is runtime
state, per §97's "providers acquire; the host owns scheduling".

## Interfaces

```ts
// providers/game/game-catalogue.ts
export interface InstalledGame {
  readonly source: "steam" | "epic" | "gog" | "itch" | "xbox" | "appx";
  readonly name: string;
  readonly installDir: string;
  readonly exes: readonly string[];
}
export function readInstalledGames(seams?: CatalogueSeams): Promise<readonly InstalledGame[]>;

// providers/game/game-classifier.ts
export interface GameEvidence {
  readonly running: boolean;
  readonly evidence: "catalogue" | "runtime" | "window" | "none";
  readonly game?: InstalledGame;
}
export function classifyForeground(
  reading: ClassifierReading,
  catalogue: readonly InstalledGame[],
  state: { fullscreenSamples: number },
): GameEvidence;

// renderer-core/src/data/sensor-catalogue.ts
export function descriptorsFromWire(sensors: readonly unknown[]): readonly SemanticKeyDescriptor[];
```

`ClassifierReading` extends the helper reading with `class`, `fullscreen` and
`d3dFullscreen`. The helper emits those three fields on the same JSON line;
older lines without them still parse.

## Behaviour

- The helper reports, once a second: `pid`, `path`, `name`, `class`,
  `fullscreen`, `d3dFullscreen`. `fullscreen` means the window rect equals its
  monitor's rect; `d3dFullscreen` means `SHQueryUserNotificationState` returned
  `QUNS_RUNNING_D3D_FULL_SCREEN`.
- A catalogue is read on the first demand of a window and reused for its life,
  matching Steam's existing rule. A foreground change to a process outside every
  install costs no I/O.
- Window evidence needs two consecutive samples so alt-tab does not flap
  `running`; any catalogue or runtime match is immediate.
- A process whose name is in the exclusion list (`explorer`, `dwm`,
  `SearchHost`, `ShellExperienceHost`, `ApplicationFrameHost`, `LockApp`,
  `LogonUI`, `winlogon`, plus the host's own executable) is never a game, even
  fullscreen.
- A store failure still yields `game.running` correctly; only the name/artwork
  keys carry the store's reason.

## Testing

Unit (Vitest):

- Each catalogue source against a fixture directory/registry answer, including
  DLC and incomplete-install skips, a missing source, and a malformed file.
- Classifier: catalogue match, runtime marker, class+fullscreen, fullscreen
  alone, class alone, exclusion list, two-sample debounce, no match.
- Helper line parsing with and without the three new fields.
- Shared mapping: whitelists, built-ins winning collisions, malformed entries
  dropped, and the editor's catalogue returning the same list as the shared
  mapper for the same wire input.
- Player: descriptors reach `refreshBoundText` (a spy/capture seam), a failed
  catalogue fetch leaves the built-in table.

Browser (Playwright): one player arm — a real host, a custom `°C` source bound
to `°F`, reading `°F`, failing when the descriptors are not passed. Game
identity is proven by the classifier and provider unit tests plus
`game-metadata.spec.ts`'s fixed-foreground arm: a fixture catalogue cannot
stand in for a real machine's install roots, so no browser arm asserts
`game.running`.

## Acceptance

1. A browser window, the desktop and a terminal all report `game.running:false`
   and still report `game.app`.
2. A process inside an Epic manifest, a GOG registry entry or a Steam install
   reports `game.running:true`, its catalogue name and no network request.
3. A fullscreen `UnityWndClass` process outside every catalogue turns
   `running` true only on the second sample; a fullscreen browser does not.
4. The player converts a custom source's unit using the host catalogue.
5. `npm run gate` exit 0.

## Out of scope

- Linux catalogue readers and Linux foreground detection (D4).
- Box art for catalogue-matched non-Steam games: no local art is read, and the
  Steam store lookup stays the cover source for Steam titles only.
- A tray icon, autostart and any lifetime control for the host.
- A user-managed allow/deny list beyond the fixed exclusion list.
- Persisting classification or catalogue data.

## Risks

- **False negatives are visible:** a portable game installed manually and not
  fullscreen reports `running:false`. The alternative is false positives, which
  the row was filed about.
- **PowerShell cost:** GOG's registry read is one process per demand window; it
  is cached exactly like Steam's VDF read.
- **Epic/itch/Xbox formats are undocumented:** each reader is fixture-tested
  against a captured shape, and an unreadable file is skipped rather than
  failing the provider.
