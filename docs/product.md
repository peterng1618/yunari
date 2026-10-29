# Product

Yunari turns one Windows PC into a local hardware-monitoring display system. The
PC reads its own sensors and serves dashboards; phones and the PC's own monitors
show them over local Wi-Fi.

Current release line: pre-release `0.1.0`. Theme documents carry
`schemaVersion: "2.0.0"`. The npm package is not published yet.

## The three surfaces

- **Host** (`@yunari/host`) — a Node process started by the `yunari` CLI. It
  collects samples, stores themes and settings, serves the built browser
  bundles, and streams samples to displays.
- **Player** (`@yunari/player`) — the display-only bundle at `/`. It renders a
  theme and live data, can hold the screen awake, and installs as an app at the
  secure origin. It contains no authoring controls.
- **Editor** (`@yunari/editor`) — the authoring surface at `/editor`, available
  on this PC only. It edits the Fabric scene inside Yunari's theme envelope,
  previews the result, saves to the local library and publishes to the store.

The host also serves a settings page and a `/pair` page for displays.

## What it does

- **Authoring.** Shapes, text, images/SVG, groups, layers, undo, snapping and
  reusable card widgets on a Fabric canvas. Four chart families (pie/donut,
  radial gauge, bars/progress, line/sparkline/area), rich text and typography
  presets, paints and type tokens, and a frosted-glass treatment for shapes.
- **Theme library and store.** Themes are local first. The editor can browse a
  Cloudflare-hosted catalogue, install a package, sign in to submit a theme and
  see its own submissions.
- **Sensors.** CPU load and clock, memory, GPUs, disks and network through
  `systeminformation`. Temperatures, fans, power and per-GPU detail through
  LibreHardwareMonitor when the owner runs it. Frame metrics come from RTSS or a
  vendored PresentMon. Missing readings stay missing.
- **Displays and devices.** Several monitors each show a chosen theme. One GPU
  and one disk are chosen for this PC, while a theme may answer a slot itself.
- **Wallpaper Engine.** The host reads the local Steam Workshop library and
  serves previews and video assets to the editor.
- **Steam presence and metadata.** The foreground game is named from the local
  Steam library or the Steam store, with box art where available.
- **Weather, media and custom sources.** Weather backends and places, the
  now-playing media session, and custom HTTP JSON sources. Credentials stay in
  the host's settings folder.

LibreHardwareMonitor is optional and never controlled by Yunari beyond the
explicit launch flags. Yunari reads its web server; it does not own its hardware
support.

## Product rules

- **Readings are truthful.** A key no provider measured is absent, with a stated
  reason. It is never a zero, a fabricated value or a dash that could be read as
  data. The synthetic `fake-source` package exists only for development and
  tests and must not appear in a shipped bundle.
- **The theme is portable.** A saved theme is a versioned JSON envelope; an
  exported theme is a `.yunari-theme` ZIP containing `manifest.json`,
  `theme.json`, an optional `thumbnail.png`, declared `assets/` and optional
  credits. Import validates before writing.
- **The previous major is the compatibility floor.** Schema `2.0.0` is current.
  The reader accepts major `2`; an older document with no migration, or any
  newer major, is refused rather than guessed at.
- **Local by default.** The host binds loopback. LAN exposure requires
  `--host 0.0.0.0`, and plain HTTP on the LAN has no confidentiality.
- **Secure origin is mandatory for install and wake lock.** The host issues a
  local root and a short-lived leaf, serves HTTPS beside HTTP on the same port,
  and prints the root certificate to install. A display pair is a durable
  credential, not a session cookie.
- **Authoring state is what persists.** Entering a group, a display lens, zoom
  and other view state belong to the editor view; they never rewrite authored
  object properties or the saved document.
- **No usage telemetry.** The host serves locally and has no analytics or
  usage-reporting endpoint.

## Current limits

- Windows is the first-class platform; sensor acquisition and helper processes
  are built and tested there.
- The npm package, winget package and packaged Windows executable do not exist
  yet. The install path documented in the root README is the release path, not
  something that works today.
- The store needs a deployed Worker, D1 database and R2 bucket before catalogue
  or sign-in features are usable.
