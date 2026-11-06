# Architecture

## Runtime shape

One long-lived Node process (the host) owns the machine-facing work: sensor
polling, the theme library, host settings, TLS, HTTP/HTTPS serving and the sample
stream. Everything a person sees is a built browser bundle served by that host:

- `/` — player (display-only). When themes exist and none is chosen, the host
  serves its theme chooser at this address instead.
- `/editor` — editor (localhost only)
- `/settings` — settings page
- `/pair` — display pairing page

The editor and player can also run under `vite preview` for browser tests, but
the host is the only real deployment.

## Packages

npm workspaces live under `src/web/packages/`. Workspace packages are private;
the product version lives once in `src/web/package.json`.

| Package | Role | Workspace dependencies |
|---|---|---|
| `@yunari/renderer-core` | Shared semantics: sample/theme types, protocol codecs, envelope validation and migration, scene planning | none |
| `@yunari/scene-fabric` | Renders a scene plan onto Fabric; persistence and Fabric revival | renderer-core |
| `@yunari/theme-package` | `.yunari-theme` ZIP read/write, widget and path-preset pack readers, validation, credits | renderer-core |
| `@yunari/extension-api` | Pure extension ABI: plugin manifest, execution profiles, capabilities, host API table, capability gate, consent digest, package reader | theme-package |
| `@yunari/theme-kit` | Pure, Node-safe theme authoring: packaged widget units, objects and tokens; no DOM and no Fabric construction | renderer-core, scene-fabric, theme-package |
| `@yunari/mcp` | stdio MCP server that designs themes against the loopback host; also owns `install`, `uninstall` and `status` | renderer-core, theme-kit, theme-package |
| `@yunari/player` | Display-only bundle; live samples and theme rendering | renderer-core, scene-fabric |
| `@yunari/editor` | Authoring shell, inspectors, panes, Fabric canvas | renderer-core, scene-fabric, theme-package; fake-source as a devDependency |
| `@yunari/host` | CLI, HTTP/HTTPS server, providers, SSE, stores, TLS | renderer-core, scene-fabric, theme-package |
| `@yunari/store-worker` | Cloudflare Worker: catalogue, auth, uploads, R2 delivery | renderer-core, theme-package |
| `@yunari/fake-source` | Deterministic synthetic samples for development and tests | renderer-core |

The MCP server is a separate Node process speaking MCP over stdio. It is a
client of the host's loopback HTTP API, not a second host: it reads themes,
sensors, displays and assets through the same routes the editor uses, keeps
drafts in its own memory. It writes the theme library through `save_theme` and
through `preview_theme`, which saves the draft on both the browser and panel
paths; `assign_theme` changes a display's assignment separately.

### Boundary rules

- **One concept, one responsible owner.** Consumers import the owner's vocabulary
  and decisions; they never maintain a parallel list, fallback, persistence path
  or protocol. Put new behavior behind the seam that already owns its lifecycle.
- **Registries are extension seams, not shared implementations.** Each provider,
  panel family or asset source owns its protocol and exports the common contract.
  Managers schedule and compose through that contract without learning internals.
- `renderer-core` imports no Fabric and no DOM. It is the semantic boundary both
  the Node host and the browser bundles can share.
- `scene-fabric` is the only shared layer that constructs Fabric objects. It
  stays canvas-agnostic: the player passes a `StaticCanvas`, the editor an
  interactive `Canvas`.
- Import Fabric from `fabric/es`, never bare `fabric`; the bare entry is a
  pre-bundled file that tree-shaking cannot enter.
- The player never imports editor code. `packages/player/src/boundaries.test.ts`
  asserts that rule, the Fabric subpath and `StaticCanvas`.
  `packages/player/scripts/check-size.mjs` enforces the gzip size budget.
- `fake-source` is a development dependency of the editor. A shipped bundle that
  contains it is reporting fabricated telemetry.
- `theme-kit` is the one authoring vocabulary the editor and the MCP server
  share. It is pure: it emits object JSON and envelope data, imports no React,
  DOM or interactive canvas, and never constructs a Fabric object. The editor
  keeps its canvas, history, inspectors and save flow; the MCP server keeps
  drafts in memory and persists only through the host.
- `@yunari/mcp` talks to the host only through its loopback HTTP routes. It
  imports no editor managers, owns no second theme store and renders no second
  preview path: browser previews are the player's own URL, panel previews are
  the panel manager's capture route. Agent installation is delegated to
  `add-mcp` (server entry) and the `skills` CLI (skill directory), never
  re-implemented as a config writer.

## USB display panels

USB panels are the host's third display kind, beside paired browsers and local
monitors. A panel has no URL: the host renders the player's pixels itself and
drives the hardware. Current driver families cover Lian Li 9.2-inch and Universal
Screen 8.8-inch panels, the TURZX 5-inch panel, and NZXT Kraken Z53/Z63/Z73.

- `panels/panel-device.ts` defines the seam: geometry, still format and minimum
  frame interval, optional video and hardware controls, open/present/close.
- Each driver owns discovery, protocol, transport and its `PanelFamily` rows.
  `panel-families.ts` is `PanelFamilyRegistry`: built-in rows first, plugin rows
  after. A plugin row cannot shadow a built-in or an earlier plugin row, and
  `forDevice` is the only lookup, so every surface answers with the same driver.
  `setPlugins` replaces the plugin rows live when a plugin is revoked; routes,
  preview and the manager hold the same registry object. Managers and UI never
  learn packet formats.
- A plugin panel family is adapted by `panels/plugin-panel-family.ts` and
  `plugin-panel-device.ts` to the same `PanelFamily`/`PanelDevice` port. Managers
  never learn plugin details.
- The host owns every device handle. `extensions/runtime/device-broker.ts` keeps
  an opaque token per open handle, and on the plugin path the broker's backends,
  `usb-backend.ts` and `serial-backend.ts`, are the only route to `usb`,
  `node-hid` or `serialport`. A plugin opens only the vendor/product ids or
  serial path its manifest declares and its hardware consent allows; transfer
  bytes cross the worker boundary as buffers, never a handle.
- A panel-family plugin runs only as `trusted-worker`. A hardware plugin needs
  store review before publish and exact-device hardware consent before load. A
  driver crash or timeout stops that display's runner; for a plugin family the
  failure also closes the plugin's handles, so that plugin's displays stop,
  while built-in families and other plugins' displays keep running. The kill
  list unloads the plugin and closes its handles.
- Node cannot sandbox a native USB stack. Host mediation, store review, hardware
  consent and revocation are the controls, not an OS sandbox.
- `panel-manager.ts` owns one serialized runner per display. It opens attached
  hardware, coordinates start/stop/refresh, and owns cadence.
- One `panel-raster-browser.ts` Chromium runtime serves every panel: one profile,
  one target per display, each target its own headless window. `panel-raster.ts`
  captures one display's page through that target. The browser stops after the
  last panel closes.
- Streaming panels receive frames; storage panels write pixels to the device.
  The driver declares the minimum interval so a storage write does not become a
  per-second flash rewrite. Video-capable adapters own conversion and authored
  placement.
- Hardware support claims belong in the family's `PanelSupport` record. A new
  family is a new driver plus a registry spread, not conditionals in the manager.

## Sample path

Providers acquire only the requested semantic keys. `ProviderRegistry` owns
scheduling, failure isolation and precedence; the host owns buffering, history
and transport. A non-`ok` answer does not claim a key, allowing fallback; a key
nobody measured stays unmapped rather than becoming zero.

1. The host's `ProviderRegistry` takes the union of semantic keys requested by
   connected displays and polls each provider once per distinct device
   assignment and language.
2. Provider failures are isolated and reported; unanswered keys are returned as
   unmapped rather than filled.
3. The host emits a `SampleBatch` Server-Sent Event on `/ws` every 1000 ms. The
   wire protocol version is `1`; the event name is `samples`.
4. The player decodes the batch, resolves its bindings and draws through
   `scene-fabric`. A missing key renders as a gap with a reason.

Stream limits are explicit: at most 64 keys per request, 128 bytes per key, 64
connections, 8 per display, and a 120-frame bounded queue per connection. A
provider or display that falls behind is dropped rather than growing memory.

## Theme document

- The persisted model is a `FabricThemeEnvelope`: `schemaVersion`,
  `fabricVersion`, `id`, `metadata`, `artboard`, `background`, `globals`,
  `assets`, `bindings`, `editorMetadata` and `scene`.
- `scene` is Fabric JSON. There is no second scene representation.
- `artboard` is `{ width, height, contentFit, shape? }`; `shape` is `rect` or
  `circle`, and absent means `rect`. A circle artboard is square and its glass
  is the inscribed disc; the field is additive, so the schema stays `2.0.0`.
- `background` is document state: `color` is the one style value behind the
  board and its letterbox, and `media` declares the asset, its bounds and
  transform. `mode` is `simple` or `advanced` and absent means `simple`: the
  full-cover media every theme authored before composition has. Only an
  `advanced` background may carry a media `composition`; the validator and the
  published schema refuse it under a simple one rather than ignore it. A
  composition anchors the picture to `top`, `right`, `bottom`, `left` or
  `center`. An edge anchor makes a band whose size along that axis is `extent`
  (`0.1`–`1`); `color` shows on the other side, and `1` lets the band cover the
  box. A centre anchor fits the picture's long edge, so `color` shows in exactly
  the two opposite gaps and never surrounds the media. `fade` is the length of
  the eased ramp that smooths each seam into `color`; its length is a fraction
  of the box, so `1` spans the whole box. The resolver
  `resolveBackgroundComposition` is the one geometry: the DOM
  media layer, the player's glass backdrop and the device-played clip bake all
  take the region and its masks from it, and all sample the same eased ramp. The
  bake composites region, colour and mask in the video plane, so a fade never
  rides the coarse overlay; `panel-video-composition.ts` is the one graph both
  the TURZX and the TUR USB encode.
- Current schema is `2.0.0`. `MIN_SUPPORTED_SCHEMA_MAJOR` is `2`; migrations are
  keyed by the major they migrate from. Missing migration or newer major is a
  refusal, never a best-effort read.
- Artboard maximum is 16384 px per dimension; node depth is 32, node count 5000;
  IDs use `[A-Za-z0-9_-]{1,64}`; asset paths use `assets/…`.
- A package is a ZIP containing `manifest.json`, `theme.json`, optional
  `thumbnail.png`, declared `assets/` and optional credits. Limits: 95 MiB
  archive, 80 MiB per entry, 180 MiB expanded, 2 MiB thumbnail. The exporter
  writes only declared assets.

## Extensions

`@yunari/extension-api` owns the extension ABI as one pure surface the host and
the editor share: the manifest schema with strict unknown-key refusal, the four
execution profiles, the closed capability list, the host API method table, the
deny-by-default gate and the consent binding digest. No surface re-spells a
subset of that vocabulary.

A plugin is a zip whose root carries `yunari-plugin.json`. The manifest names a
kebab-case `id`, a semver `version`, the host range in `engines.yunari`, the
host API major, an `execution` profile, capabilities and contributions. The
profiles are `data`, `declarative`, `sandboxed-ui` and `trusted-worker`; a
manifest may ask for a higher profile than its contributions require, never a
lower one. Unknown keys, capabilities and profiles are refused, not ignored.

The host validates package paths, size, declared file set and manifest before
it writes anything. An install lands under `settings/extensions/` as
`local/<id>/<version>/`, and `installed.json` is what makes it live. Consent is
required and recorded only for the executable profiles, `sandboxed-ui` and
`trusted-worker`; a data or declarative plugin needs no record. A record lives
in `settings/extension-consent.json`, keyed by the qualified plugin key
`publisher/id`, and its fingerprint is a SHA-256 binding digest over the schema
tag, host API major, key, version, install-tree content hash, profile, sorted
capabilities, authority-bearing contribution identities and device allowlists.
It binds rather than signs: a changed file set, version or access yields a new
fingerprint, and stale consent reads as missing.

`/api/extensions` and its children are loopback-only and origin-checked. `GET`
lists installs, `POST /api/extensions/install` takes a package, and `DELETE
/api/extensions/<publisher>/<id>` removes the tree and its grant. `POST
/api/extensions/<publisher>/<id>/consent` recomputes the install's fingerprint
and records a grant only when it matches; a profile that needs no consent is
answered without a record.

Declarative contributions join the registries they extend; no manager learns
plugin details. An installed `assetCategories` entry is drawn by the finder's
generic grid, and `customSources` rows from a declarative extension join the
custom source provider. A declarative profile needs no consent; executable
profiles are gated.

`trusted-worker` is the only profile that executes plugin code. The host forks
one Node child per loadable plugin from `plugin-host.js`, a second Vite SSR
entry beside the host bundle, and speaks to it over IPC. The child imports the
manifest's `main` only after the parent's `init` handshake, and inherits no
environment beyond `PATH`. Its method allowlist refuses a call before IPC; the
parent rechecks every plugin call through `gateExtensionCall` against the
manifest's capabilities and the grant the worker started with, so the allowlist
is early refusal, not the authority. A running worker keeps the grant it was
started with: installing, revoking consent or removing the extension affects
that worker only at the next host start.

The fork is a consent boundary, not a sandbox: the child is ordinary Node code
with this account's privileges, and the gate and guarded fetch constrain what
it does through the host API, not what its own code can do. The profile is
consent-gated for that reason.

The parent bounds the child. Startup and the `init` answer have 5 s, a request
has a 35 s default (above the 30 s host API deadline, so a slow fetch does not
kill the worker), a host API call has a 30 s deadline, and `stop` gets 2 s
before the parent kills the process. At most the last 2 KiB of stderr is kept,
redacted for machine addresses, and that text is the crash detail. A start
failure, an unexpected exit and an unanswered request are the same one crash
report: pending calls settle as failures, and stopping is idempotent.

A plugin's calls land in `runtime/host-api.ts`, which rebuilds the gate context
from the manifest and the grant captured when the worker started on every call;
a caller cannot widen what the gate sees. Parameters are checked against a closed key
set per method, denials name the method and the gate's reason only, and no
method returns a host credential. `network.fetch` is `https` only and reaches
only the hosts the manifest declares. Every hop re-checks the host, refuses
link-local and metadata addresses, re-checks a redirect and refuses a scheme
change, caps the body at 1 MiB, and pins the checked address through
`createPinnedFetch` so a second DNS answer cannot redirect the socket. A plugin
uses its own secrets for its own requests; the host adds no credential, and a
plugin-contributed asset source declaring `requires` or `request.auth` is
refused.

A code asset source answers through the same supervised child with
`asset.search` and `asset.bytes`; a bytes answer is capped at 32 MiB and its
content type and filename are validated before use. A declarative asset source
takes the same guarded JSON and byte paths as its search and artwork fetches.
A plugin requesting a network call takes one of the host's four shared fetch
slots, which bounds how many plugin connections run at once; a stalled call
holds its slot until its deadline.

Each plugin owns three scopes under `settings/extensions/`:
`data/<publisher>/<id>/` for keyed values (1 MiB per value, 1,000 keys),
`secrets/<publisher>/<id>/` in the OS-protected secret store, and
`settings/<publisher>/<id>.json` (64 KiB). File names are derived from the key,
and publisher and id are revalidated as path segments, so neither a key nor a
manifest can steer a path.

Sensor providers and code asset sources from a loadable plugin register through
the existing `ProviderRegistry` and `AssetSource` registry: one provider per
plugin using its first sensor-provider contribution, and one adapter per code
asset entry; they never reach a manager. A plugin that fails to start
contributes no rows. A plugin that crashes keeps its registered adapters: its
providers and sources report failures, every other provider and source keeps
answering, and its keys arrive as gaps with a reason, not as zero or a
placeholder. Built-in providers keep their own precedence and
plugin rows follow, ordered by `settings/extensions/provider-order.json`. The
order is read and written at `GET`/`PUT /api/extensions/provider-order`,
loopback-only and origin-checked like the rest of `/api/extensions`.

## Data packs

Widget packs and path presets are installable data, and the host owns what is
installed. One widget pack is one directory under
`settings/widget-packs/<packId>/package.zip`; the path-preset list is
`settings/path-presets.json`. The editor reads both surfaces and the MCP server
the widget packs, through the same loopback routes — `/api/widget-packs` and
`/api/path-presets` — so no surface keeps an independent library once a
browser's list has migrated. Both surfaces are
loopback admin, and every write also refuses a foreign origin. Installing a
pack is a host API call in this phase; no import control ships yet.

- A widget pack keeps the `yunari-widget-package` container (`manifest.json`,
  `widget.json`, declared assets) and adds unit derivation: the package's scene
  is read as insertable units, each with its own bindings and assets. A package
  is read before it is written, and the bytes are written to a temporary
  directory and renamed into place, so an install is never half a pack. A unit
  id is unique across installed packs; two packs claiming one is refused rather
  than settled by listing order.
- A path-preset pack is one JSON document: `format: "yunari-path-preset-pack"`,
  `version: 1`, an id, a name and its presets. The reader is structural and
  bounded; drawability and paint are the canvas geometry rule, applied before
  anything is stored.
- Built-in path presets stay bundled data in `BUILTIN_PATH_PRESETS`. The host
  merges them ahead of the stored rows, minus the ids the author removed. A
  stored row's id is `user:<id>` for one the author added and
  `pack:<packId>:<presetId>` for one a pack carries, so neither can collide
  with a built-in id.
- The starter theme is a bundled `yunari-theme-package` committed at
  `packages/editor/src/bundled/starter.theme.zip` and read once at boot. The
  default widget pack is the bundled
  `packages/host/src/packs/default.widgets.zip`. No runtime generator composes
  either.
- A browser's stored preset list is migration source only. At boot the editor
  posts it once; the local rows are kept until the host accepts them and cleared
  after, so a host that cannot be reached still has the only list that browser
  knows.
- Packs are not scene state. The theme envelope and its schema (`2.0.0`) are
  unchanged, and Fabric JSON in the envelope remains the only persisted scene
  model.

## Host serving and gates

The host serves HTTP and HTTPS on the same port. HTTPS uses a locally issued
root plus a leaf for the machine's current addresses; the root is printed and
served at `/yunari-ca.crt` before every gate so a display can trust it.

| Surface | Reachability |
|---|---|
| `/`, `/settings`, `/pair`, `/api/health` | According to current LAN/hosting state |
| `/editor` | Loopback only |
| `/api/devices`, `PUT /api/display`, `/api/pairing/*` admin routes | Loopback only |
| `POST /api/pairing/claim` | LAN, because an unpaired display must reach it |
| `/ws` sample stream | A paired display credential |

Pairing uses one live six-character code (alphabet excludes `I`, `L`, `O`, `0`,
`1`), valid for ten minutes. Wrong guesses are delayed with a bounded penalty
rather than burning the code or locking the person out. A successful claim
issues a durable display credential, which lasts until the display is removed.

The host holds a lock file in its settings directory, so two hosts cannot serve
one app folder. If the requested port is taken, binding walks upward for at most
ten ports and reports the port it took.

## State on disk

The default app folder is `%USERPROFILE%\.yunari` (`~/.yunari` elsewhere):

- `themes/` — one directory per local theme.
- `settings/` — host state: displays, devices, hosting preference, active theme,
- `settings/` — host state: displays, devices, hosting preference, active theme,
  credentials, provider settings, installed widget packs (`widget-packs/`), the
  path-preset list (`path-presets.json`), `tls/` (root certificate and encrypted
  root key).
- `settings/extensions/` — installed plugin trees, one directory per
  `local/<id>/<version>`, with `installed.json` as the live index.
- `cache/` — downloaded media artwork and game metadata, beside `settings/`.

`--app-dir` moves both; `--themes-dir` moves only the library. Settings are kept
out of `themes/` so a theme folder is only ever a theme.

## Store Worker

`@yunari/store-worker` is a Cloudflare Worker with D1 (`DB`) and R2 (`BUCKET`)
bindings and better-auth. Routes:

- `GET /api/health`
- `POST /migrate` — token-protected migration runner
- `/api/auth/*`, `GET /api/me` — better-auth
- `GET /auth/start`, `GET /auth/return` — sign-in flow for GitHub and Google

Uploads are proxied through the Worker; R2 needs only the binding. A cron
(`*/15 * * * *`) drains abandoned uploads. Sign-in is needed to submit a theme
and see your own items, not to browse the catalogue.
