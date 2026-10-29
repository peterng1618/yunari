# Yunari

Windows-first hardware-monitoring dashboards. One PC collects its own sensor
readings and serves a local site; a desktop editor authors dashboard themes, and
phones (or this PC's own monitors) display them over local Wi-Fi.

Three processes:

- **Host** (`@yunari/host`) — a Node process: CLI launcher, sensor providers,
  theme storage, static serving and the SSE stream displays read.
- **Editor** (`@yunari/editor`) — the authoring surface, served on this PC only
  at `/editor`. React 19 + Base UI chrome over an imperative Fabric canvas.
- **Player** (`@yunari/player`) — the display-only bundle at `/`, installable as
  an app. It never imports editor code.

## Status

**Pre-release `0.x`.** The current version is `0.1.0`, and the theme format may
still change before `1.0.0`. A theme document carries
`schemaVersion: "2.0.0"`.

Before the first release a format change may break cleanly. **From the first tag
on, the previous schema major is migrated on open**; a document two or more
majors old, or any newer major, is refused instead of being guessed at.

The npm package is **not published yet** — see [Releases](#releases).

## Requirements

- **Windows first.** Sensor acquisition and the helper processes are built and
  tested there.
- **Node 22.12+, 24, or 26+** (the Vitest version's range).
- **A Chromium browser** for the Playwright suites; `npx playwright install
  chromium` installs it.

## Run from source

From `src/web/`:

```bash
npm install
npm run build
node packages/host/bin/yunari.js
```

`npm run build` builds the player, editor and host bundles. The host refuses to
start without its own build and names the command that produces it.

The host prints the addresses it took. Defaults:

- `http://127.0.0.1:5227` — dashboard (player) at `/`, editor at `/editor`,
  settings at `/settings`.
- The same port over `https`, from a certificate the host issues itself.
- The editor and the settings page are **localhost-only**, even when the LAN is
  open, as is the pairing admin API (`/api/pairing/*`). The code exchange is the
  exception, and the `/pair` page itself answers on the LAN so a device with no
  credential can reach it.

State lives in one app folder, `%USERPROFILE%\.yunari` (`~/.yunari` on other
platforms): `themes/` is the theme library and `settings/` is this machine's
own state. `--app-dir <dir>` moves both; `--themes-dir <dir>` moves only the
library.

## First phone

LAN serving is **off by default**. Turn it on explicitly:

```bash
node packages/host/bin/yunari.js --host 0.0.0.0
```

Then, in this order:

1. **Install the root certificate on the phone.** Fetch
   `http://<lan-ip>:<port>/yunari-ca.crt` over plain http — that route answers
   before every gate, so no certificate warning is in the way — and trust it on
   the device.
2. **Open the secure address**, `https://<lan-ip>:<port>/`. Only at that origin
   can the display hold the screen awake and register the service worker that
   makes it installable. Without the root it shows a certificate warning; over
   plain http it loads, but is not a secure context.
3. **Install it as an app** from the browser menu (PWA, `display: standalone`).
4. **Pair it.** The host prints a `/pair?code=…` link. A phone with a camera
   can scan the QR in the editor's publish popover; without one, open `/pair`
   and type the code. The code is six characters and valid for ten minutes. What
   it buys is a durable display credential, which lasts until you remove that
   display on this PC.

Plain LAN HTTP has no confidentiality. Use this on trusted networks only —
never expose it to the internet.

## What it does

- **Editor** — a Fabric scene with shapes, text, images/SVG, groups, layers,
  undo, snapping and reusable widgets, over a versioned theme envelope.
- **Theme library and store** — the host's local library, plus a theme
  catalogue served by a Cloudflare Worker, browsable and installable from the
  editor; signing in is for submitting a theme and seeing your own.
- **Sensors** — baseline readings (CPU load and clock, memory, GPUs, disks,
  network) through
  [`systeminformation`](https://www.npmjs.com/package/systeminformation). CPU
  temperature, fans, power and per-GPU detail through
  [LibreHardwareMonitor](https://github.com/LibreHardwareMonitor/LibreHardwareMonitor),
  read from its web server; Yunari never controls your hardware. A key nobody
  measured stays empty with a stated reason, never a fabricated zero.
- **Displays and devices** — several monitors, each showing a chosen theme;
  which GPU and disk this PC answers with is chosen once for this PC, and a
  theme may answer a slot for itself.
- **Wallpaper Engine** — the host reads the Steam Workshop library and serves a
  wallpaper's preview and video assets to the editor.
- **Steam presence and store metadata** — the foreground game, named from the
  local Steam library or the Steam store, with box art.
- **Weather, media and custom sources** — weather backends and places, the
  now-playing media session, and custom HTTP JSON sources; credentials stay in
  the host's settings folder and are never handed to the browser.
- **Charts, text and glass** — four chart families (pie/donut, radial gauge,
  bars/progress, line/sparkline/area) with typed styling, rich text and
  typography presets, and a frosted-glass treatment for shapes.

LibreHardwareMonitor is optional. Run it yourself with **Options → Run web
server** enabled (port 8085), or stage the pinned release and let the host start
it:

```bash
npm run vendor:lhm -w @yunari/host
node packages/host/bin/yunari.js --lhm-exe packages/host/vendor/lhm/LibreHardwareMonitor.exe
```

## CLI reference

Run `node packages/host/bin/yunari.js --help` (or `yunari --help` once
installed) for the complete option list and its defaults; that output is the
authoritative reference and this section deliberately does not repeat it.

The flags a normal run needs: `--host 0.0.0.0` opens the LAN (off by default),
`-p/--port` moves off 5227, `--app-dir` relocates the app folder, and
`-n/--no-browser` starts the host without opening a window. The
LibreHardwareMonitor flags (`--lhm-url`, `--lhm-exe`, `--register-lhm-task`) are
shown there too.

The host serves `https` beside `http` on the same port and prints the root
certificate path. A run without `--host` obeys the LAN preference saved in the
app folder; a run that passes `--host` obeys that address for that run.

## Releases

The npm package is **`yunari`**, and it provides the `yunari` command. Release
notes and the `.tgz`/`.zip` assets belong on
[GitHub Releases](https://github.com/peterng1618/yunari/releases).

**Public publication is pending: the first publish has not run yet.** Once it
has, the install path is:

```bash
npm i -g yunari@latest
yunari
```

Both commands are the release path, not something that works today.
Prereleases are published under the `next` dist-tag and are not reached by
`@latest`. winget is **not supported**; it is deferred until a packaged Windows
executable exists.

## Architecture

One Node host owns sensor polling, theme storage, TLS and the sample stream.
Everything a person sees is a built browser bundle it serves: the player at
`/`, the editor at `/editor` (localhost only), settings at `/settings`, and the
pairing page at `/pair`.

`@yunari/renderer-core` holds the shared semantics and imports no Fabric or DOM.
`@yunari/scene-fabric` is the only shared layer that builds Fabric objects; the
player uses a `StaticCanvas`, and only the editor constructs an interactive
`Canvas`. Fabric JSON is the scene inside Yunari's versioned envelope — there is
no second scene model. See [`docs/architecture.md`](docs/architecture.md) for the
package table and boundary rules.

## Development

Run all npm commands from `src/web/`.

```bash
npm install
npm run build
npm run gate        # the one command that means green (offline)
npm run test:e2e    # Playwright, after build and `npx playwright install chromium`
```

`docs/development.md` covers the test split, fixed ports, tooling constraints and
Windows notes. [`AGENTS.md`](AGENTS.md) is the short guide for working in this
repository.

## Documentation and licence

- [`AGENTS.md`](AGENTS.md) — repository rules, commands and non-obvious
  invariants.
- [`docs/README.md`](docs/README.md) — documentation map.
- [`DESIGN.md`](DESIGN.md) — normative editor visual language and tokens.
- [`docs/superpowers/specs/`](docs/superpowers/specs/) and
  [`docs/superpowers/plans/`](docs/superpowers/plans/) — feature designs and
  implementation plans.

Yunari is [MIT licensed](LICENSE). Third-party provenance and licences:
[`THIRD-PARTY-NOTICES.md`](THIRD-PARTY-NOTICES.md).
