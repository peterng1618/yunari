# 0108 — Game presence reads one foreground process and local Steam files

- **Date:** 2026-10-24
- **Status:** accepted
- **Paths:** `src/web/packages/host/src/providers/game/steam-library.ts`,
  `src/web/packages/host/src/providers/game/provider.ts`,
  `src/web/packages/host/src/providers/game/box-art.ts`,
  `src/web/packages/host/src/providers/helpers/foreground.ts`,
  `src/web/packages/host/src/server.ts`

## The problem

A theme binding `game.name`, `game.app`, `game.running` or `game.artwork` must
learn which game the user is actually playing, on this PC, without asking the
network, installing a native addon, or starting an overlay. The shape is not
"read a window title": it needs the foreground window's owning process, that
process's executable path, a truthful mapping from an executable path to a
Steam app, a lifecycle tied to whether `game.*` is demanded, and an absent
Steam install that reports no game rather than an error. A wrong mapping is
invisible — it renders a plausible game name over the wrong process.

## Rung 1 — Yunari

Searched: `rg -n -i "foreground|GetForegroundWindow|active-win|libraryfolders|appmanifest|steam"`
across `src/web/packages/host/src` and `src/web/packages/renderer-core/src`;
the provider tree; the semantic key vocabulary's `game` family.

Found: the four keys exist with labels and `expectedTier: "extended"`;
`game.artwork` already declares `mediaKind: "image"`. The supervisor
(`startJsonLineHelper`, decision 0102) owns embedded PowerShell, line framing,
restart backoff and tree kill — this helper is its next client. The frame
provider (0107) owns the demand-window pattern this provider follows.
`wallpaper-engine/locate.ts` already finds Steam and reads
`libraryfolders.vdf` line by line, but it is private to Wallpaper Engine, it
shells out to `reg.exe` rather than PowerShell, and it parses only the
`"path"` lines rather than Valve's KeyValues grammar. It is prior art, not a
reusable owner: extracting it would put Wallpaper Engine behind the game
provider or move an unrelated feature's registry call. Nothing reads the
foreground window or an `appmanifest_*.acf`.

## Rung 2 — dependencies

Searched: `packages/host/package.json`; the workspace dependency tree;
`npm search vdf steam`, `npm search foreground window`,
`npm search active window windows`.

Found: runtime deps are `ffmpeg-static`, `node-forge`, `systeminformation` and
workspace packages. No VDF parser, no window/process package, no FFI. Every
candidate below either requires a native build or solves more than this task,
and the task guardrail forbids adding an npm dependency for either half.

## Rung 3 — platform

Searched: Windows user32 (`GetForegroundWindow`,
`GetWindowThreadProcessId`), .NET `System.Diagnostics.Process`, the registry
path `HKCU\Software\Valve\Steam\SteamPath`, and Node's built-in APIs.

Found: `GetForegroundWindow` plus `GetWindowThreadProcessId` gives the owning
process id without elevation and without UAC; `Process.GetProcessById` gives
`MainModule.FileName` (it throws for a process this user may not inspect, so
the script must fail closed per line). Steam's root is one HKCU string; Node
has no registry API, so the lookup goes through an embedded PowerShell script,
not `reg.exe` and not a native addon. `libraryfolders.vdf` and
`appmanifest_*.acf` are plain KeyValues text on disk: quoting, escaped
backslashes, and nested `{ }` blocks. The OS provides no VDF reader.

What the platform leaves to us: polling (no foreground-window event without a
hook), the KeyValues grammar, deciding that a path is inside an app's install
directory, and treating a missing Steam install as "no game" rather than a
failure.

## Rung 4 — ecosystem

Searched (npm, live, 2026-10-24):

- `npm view vdf` → 0.0.2, ISC, "port of steamodd's vdf.py"; last modified
  2022, and it still declares the deprecated `util` package as a dependency.
- `npm view @node-steam/vdf` → 2.2.0, MIT, 11 KB unpacked. It parses and
  serialises KeyValues correctly, but it is a whole grammar/serialiser we do
  not own, and the task forbids a new runtime dependency.
- `npm view steam-vdf` → 404, not published.
- `npm search vdf steam` also returned `simple-vdf`, `binarykvparser` and
  `steam-binary-vdf`; the last two are binary VDF, which these files are not.
- `npm view active-win` → 9.0.0, MIT, but its `install` script is
  `node-pre-gyp install --fallback-to-build` with `node-addon-api` and
  `node-gyp`; it ships a NAPI binary per platform/ABI. It returns a window
  object (title, bounds, owner) when one executable name and path are enough,
  and it needs a downloadable/buildable native artifact at install time.
- `npm view get-windows` → 9.3.0, MIT, same `node-pre-gyp` shape and the same
  native binary packaging as `active-win`.
- `npm view node-window-manager` → 2.2.4, MIT, but `install` runs
  `node-gyp rebuild`; it needs a compiler on the machine that installs Yunari.
- `npm search foreground window` also returned `foreground-window` (native
  addon, one pid, no path), `@paymoapp/active-window` (native modules) and
  `ym-fullscreen-detector` (native, fullscreen only).
- GitHub (`api.github.com/search/repositories`): `steam libraryfolders` →
  no repositories; `steam appmanifest parser` → `zsnmwy/steam-acf2json`
  (JavaScript, no licence); `vdf parser steam` → ValvePython/vdf (MIT),
  xPaw/SteamAppInfo (MIT, binary VDF), TinyTinni/ValveFileVDF (MIT, C++),
  shravan2x/Gameloop.Vdf (MIT, C#), andygrunwald/vdf (MIT, Go),
  CosmicHorrorDev/vdf-rs (Rust) — all parser libraries for another runtime,
  none reading Steam's library or foreground process. `windows foreground
  process node` → `issacg/whoisopen`, a C++ Node extension with no licence,
  returning one pid.

The closest prior art is `active-win`/`get-windows`: they solve the native
window enumeration and return exactly the pid and path this provider needs,
but they do it by shipping a prebuilt or compiled native addon. The VDF
libraries solve grammar; none solves the two halves together, the demand
window, the install-directory containment rule, or the "Steam absent" state.

## Rung 5 — comparison

| Option | Fit | Cost | Risk | Verdict |
|---|---|---|---|---|
| Embedded PowerShell: user32 foreground pid + `Process.MainModule`, registry SteamPath; minimal VDF parser in TypeScript | Exact fields; no dependency; supervisor already owns the process, encoding, restart and tree kill | ~80 lines of script + ~120 lines of parser | `MainModule` throws for an inaccessible process, handled per line | Chosen |
| `active-win` / `get-windows` | Gives pid and path | Native prebuild or `node-gyp` toolchain; new runtime dependency and notices entry | Install failure on a machine without a compiler or matching ABI; returns more than needed | Rejected |
| `node-window-manager` | Same data | `node-gyp rebuild` on install | Compiler required; native addon maintenance for one field | Rejected |
| `@node-steam/vdf` | Correct KeyValues parser | 11 KB dependency, MIT | New runtime dependency forbidden by the task; full grammar when four fields are read | Rejected |
| `reg.exe query` (as in `wallpaper-engine/locate.ts`) | Resolves SteamPath | None (built in) | Controller ruling requires a PowerShell helper for the registry; Node cannot read it directly | Rejected |

## Rung 6 — probe

On this machine (2026-10-24, before implementation):

- `HKCU\Software\Valve\Steam\SteamPath` reports `d:/games/steam` (forward
  slashes), and `d:/games/steam/steamapps/libraryfolders.vdf` exists with 19
  `appmanifest_*.acf` files in `steamapps`.
- The vdf is tab-separated quoted key/value with escaped backslashes:
  `"libraryfolders" { "0" { "path" "D:\\Games\\Steam" ... "apps" { "10"
  "318799907" ... } } }`. A spaced, quoted path has to survive the parser.
- An app manifest begins `"AppState" { "appid" "10" "Universe" "1"
  "LauncherPath" ... "name" "Counter-Strike" "installdir" "Half-Life" ... }`.
  The manifest's `installdir` is relative to `steamapps/common`; the provider
  joins it to the library that contained the manifest.
- The mould-breaking case is segment containment: a prefix test matches
  `.../Half-Life2` under `.../Half-Life`; the implementation normalises both
  sides with `win32` semantics, folds case, and requires a separator after the
  install directory.
- **Registry probe.** The embedded PowerShell lookup returned
  `root=d:/games/steam` (exit 0), the forward-slash spelling the registry
  holds.
- **Real-library probe.** `readSteamApps("d:/games/steam")` returned
  `count=19`, matching the 19 `appmanifest_*.acf` files. The first entries were
  `{"appId":"10","name":"Counter-Strike","installDir":"d:\\games\\steam\\steamapps\\common\\Half-Life"}`,
  `{"appId":"1070710","name":"Kind Words",...}` and
  `{"appId":"1172940","name":"Cockwork Industries Complete",...}` — the
  multi-word install directory survived the parser.
- **Foreground probe.** A three-second run of the extracted helper emitted
  three lines, all
  `{"kind":"foreground","pid":20104,"path":"C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe","name":"chrome"}`
  — one per second, UTF-8, with the executable path. No game was running, so a
  Steam-matched live reading is unverified; the synthetic provider cases cover
  the matching path.

## Box art stays on this machine

`game.artwork` is the running Steam app's box art, read from the cache Steam
itself writes: `<steam>/appcache/librarycache/<appId>/library_600x900.jpg`.
Probed on this machine (2026-10-24): 16 of the 19 installed apps have that file
and three do not (`228980`, `292030`, `990080`), so "no local image" is a real
state, not an error. The folder also holds `header.jpg`, `library_hero.jpg`,
`logo.png` and `library_capsule.jpg`; only the 600x900 box art is served, so
the route cannot become a listing of whatever Steam happens to cache.

The host serves those bytes at `/api/game/artwork/<appId>.jpg` instead of
letting a display request Steam's CDN. A CDN URL carries the app id off this
machine, which tells Valve's servers what the user owns and is playing; the
route keeps that membership local. The app id is also the whole allow-list: a
decimal id of 1–10 digits that is among the installed apps, and anything else
is a 404, so the route is not a file oracle. Bytes are read only after a
`stat` bound of 5 MiB, and a missing file is a 404 the image binding treats as
a load error, leaving the authored asset.

Authorisation mirrors `/api/media/artwork/`: loopback is this PC and needs no
credential, and any other request must resolve through `displayFor` with a
live display session. The response is `image/jpeg`, `nosniff`, and
`private, max-age=3600` — not `immutable`, because the name is an app id and
Steam can replace the file in place.

## Decision

Use one embedded PowerShell helper under the 0102 supervisor to read the
foreground window's process id and executable path once a second, and one
PowerShell registry lookup per demand window for Steam's root. Parse
`libraryfolders.vdf` and `appmanifest_*.acf` with a small KeyValues reader in
the host: four fields are needed, the task forbids a dependency, and the
existing Wallpaper Engine reader is neither a shared owner nor a grammar.
Containment is a normalised, case-folded segment check, not a string prefix.
The helper starts only while `game.*` is demanded and stops after the grace
period; an absent Steam install yields no Steam apps and no error, and a
missing foreground line is `missing`/`unavailable`, never a fabricated name or
a zero.
