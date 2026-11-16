# Product

Yunari turns one Windows PC into a local hardware-monitoring display system. The
PC reads its own sensors and serves dashboards to paired phones and local
monitors, and renders dashboards directly to supported USB display panels.

Current release line: pre-release `0.1.0`. Theme documents carry
`schemaVersion: "3.0.0"`. The npm package is not published yet.

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

The host also forwards `/settings` to the editor's Settings mode and serves a
`/pair` page for displays.

## What it does

- **Authoring.** Shapes, text, images/SVG, groups, layers, undo, snapping and
  reusable card widgets from the installed widget packs on a Fabric canvas. Six
  chart families (gauge, line, bar, pie, radar and polar bar), rich text and
  typography presets, paints and type tokens, and a frosted-glass treatment for
  shapes. A theme's artboard is rectangular or circular. A circular theme is a
  square artboard whose glass is the disc inscribed in it: the four corners fall
  outside the glass and are cropped on output. A rectangular theme shown on a
  round panel keeps its artboard inscribed in the disc, corners on the ring. A
  new theme starts blank or from the bundled starter template; a selection can
  be exported as a `yunari-widget-package`.
- **Widget packs and path presets.** The host owns the installed widget packs
  and the one path-preset list under its settings folder. The editor reads both
  and the MCP server reads the same installed widget-pack rows, so neither keeps
  an independent library once a browser's list has migrated. Widget packs keep the
  `yunari-widget-package` container and add insertable units with their
  bindings and assets; path-preset packs are `yunari-path-preset-pack` JSON v1.
  Built-in path shapes stay bundled data, and a stored preset is `user:<id>` or
  `pack:<packId>:<presetId>`. A browser's old preset list is migrated to the
  host once and kept locally until the host accepts it. The starter theme and
  the default widget pack are committed packages; no runtime generator builds
  them. Installing a pack is a host API call in this phase: no import control
  ships yet.
- **Library and store.** Themes are local first. The editor's Library mode is
  one catalogue over every user-extensible kind: eight browse pages plus My
  submissions, and one installed-state filter (`All`, `On this PC`, `Not
  installed`). A listing is the install unit and its members are the browse
  unit; a collection is a listing of listings that resolves each include to
  its latest published version and installs them in one press.
- **Sensors.** CPU load and clock, memory, GPUs, disks and network through
  `systeminformation`. Temperatures, fans, power and per-GPU detail through
  LibreHardwareMonitor when the owner runs it. Frame metrics come from RTSS or a
  vendored PresentMon. Missing readings stay missing.
- **Displays and devices.** Several monitors each show a chosen theme. One GPU
  and one disk are chosen for this PC, while a theme may answer a slot itself.
- **USB display panels.** The host renders and drives supported Lian Li 9.2-inch
  and Universal Screen 8.8-inch panels, the TURZX 5-inch panel, and NZXT Kraken
  Z53/Z63/Z73. Drivers expose stills and optional video; TURZX also exposes
  brightness, screen, restart and status controls through the common contract.
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

## Extensions

An extension package is a zip with `yunari-plugin.json` at its root. The
manifest names a kebab-case id, a semver version, the minimum Yunari release it
supports (`engines.yunari` `>=x.y.z`), host API major `1`, an execution profile,
capabilities and the contributions it adds. The four execution profiles are
`data` (metadata only), `declarative` (descriptors only), `sandboxed-ui` (an
isolated frame) and `trusted-worker` (a forked worker). A manifest may ask for a
higher profile than its contributions require, never a lower one.

Capabilities are a closed list of ten: `sensor:provide`, `asset:provide`,
`panel:drive`, `network:fetch`, `storage:own`, `secrets:own`, `settings:own`,
`ui:frame`, `usb:device` and `serial:device`. An unknown capability refuses the
manifest. No plugin receives arbitrary filesystem access, a way to spawn
processes or the host's credential store.

Consent is required and recorded for the executable profiles, `sandboxed-ui`
and `trusted-worker`, against the qualified key `publisher/id`, never the bare
id. A grant binds one fingerprint: version, install contents, profile,
capabilities, authority-bearing contributions and device allowlists. Any of
those changing asks the owner again, and missing or stale consent stops the
plugin loading. The fingerprint is a binding digest, not a signature. Local
installs use publisher `local`; `yunari`, `official` and `yunari`-prefixed names
are reserved. Extension management is available on this PC only.

Today an extension is installed from a package on this PC or from the store's
`plugin` kind. Declarative asset categories and custom sources take
effect without editor code, and a declarative plugin records no consent. No
plugin code runs yet: executable providers, sandboxed UI and USB panel drivers
are not in this release.

## Store distribution

The store carries six kinds: `dashboard-theme`, `editor-theme`,
`widget-pack`, `path-preset-pack`, `plugin` and `collection`. All six share one
listing and one version ladder; a package's bytes are validated by the store
when the version is finalized and again by the host after download.

A listing is one catalogue item with one package and one version ladder; its
**members** are the things a person browses and installs. Every listing carries
a `members` array, derived by the store at finalize from the package it already
validated, so a submission never declares its own members. The member kinds are
`dashboard-theme`, `editor-theme`, `widget`, `shape`, `sensor-provider`,
`asset-source`, `panel-driver` and `data-source`. A theme is one member, a
widget pack one per unit, a path-preset pack one per preset, and a plugin one
per sensor-provider, data-source, asset-source and panel-driver contribution;
settings pages and asset categories are not members. A member kind this build
does not ship still lists by its identifier.

A **collection** is a listing whose package
(`format: "yunari-collection-package"`, `version: 1`) names published catalogue
ids as includes, each required or optional. Collections are one level deep: a
collection cannot include itself or another collection, and a duplicate,
unknown or unpublished include is refused. Members are ids, not pinned
versions, so an include always resolves to its latest published version and a
member update needs no collection release. Changing membership ships a new
collection version: publishing a name that matches one of the author's own
collections adds a `minor` version instead of a new listing. A collection's
cover is its first include's published thumbnail; when that picture cannot be
fetched the publish is refused. Collections are self-serve and carry no review.

The publisher is the store account's slug, derived from the account when an item
is first submitted. A manifest's own `publisher` field is ignored, and reserved
slugs — `yunari`, `official` and anything starting with `yunari` — cannot be
claimed. A hardware plugin, one contributing a panel family or asking for
`usb:device` or `serial:device`, is submitted as `pending` and published only by
an owner verdict.

An install downloads only over https from the configured store origin, verifies
the store's exact size and SHA-256, and then hands the bytes to the kind's own
owner. Its refusals are staged as `address`, `download`, `integrity`, `package`
or `store`; a plugin install also reports whether the package's execution
profile requires consent. An update that adds a capability, contribution,
device, execution profile or store publisher is held for the owner's review
instead of installing.

A collection install runs one pre-flight over every chosen include — size,
SHA-256, the kind's own package reader, the kill list and consent — before any
write. One killed, unpublished or refused member refuses the collection by name
and writes nothing. Each chosen member then installs through its existing
per-kind path, so an install part-way through reports which members landed; a
retry skips members this PC already holds, and a member records the collection
that installed it.

A collection's install sheet lists every chosen include with its publisher,
kind and size, locks required members and aggregates each code member's
execution profile, capabilities and devices. The sheet asks for no consent of
its own. Consent stays per plugin: the host revalidates each code member and
records consent against that plugin's qualified key, and a press that wrote
nothing grants nothing.

`GET /kill-list.json` is the store's revoke list. The host caches the last good
list and checks it before consent, so a revoked plugin does not load whatever its
grant says; a failed fetch keeps the cached list and no cache kills nothing.

## Product rules

- **Readings are truthful.** A key no provider measured is absent, with a stated
  reason. It is never a zero, a fabricated value or a dash that could be read as
  data. The synthetic `fake-source` package exists only for development and
  tests and must not appear in a shipped bundle.
- **The theme is portable.** A saved theme is a versioned JSON envelope; an
  exported theme is a `.yunari-theme` ZIP containing `manifest.json`,
  `theme.json`, an optional `thumbnail.png`, declared `assets/` and optional
  credits. Import validates before writing. Each background asset's framing is
  editor working data, not authored state: it lives in the library folder's
  `background-media.json`, is not exported or imported, and is dropped when the
  theme is deleted.
- **The previous major is the compatibility floor.** Schema `3.0.0` is current.
  The reader accepts major `3`, migrates major `2` upward, and refuses an older
  document with no migration, or any newer major, rather than guessing.
- **Data packs are host state.** Installed widget packs and the path-preset
  list live in the host's settings folder, and every surface that offers them
  reads them through the host. A pack adds widgets or shapes; it never adds a
  scene format or changes the schema.
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
  are built and tested there. Game presence is Windows-only: Epic, GOG and itch
  libraries on Linux have no provider, because no Linux release is planned.
- The npm package, winget package and packaged Windows executable do not exist
  yet. The install path documented in the root README is the release path, not
  something that works today.
- The store needs a deployed Worker, D1 database and R2 bucket before catalogue
  or sign-in features are usable.
