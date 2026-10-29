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
| `@yunari/theme-package` | `.yunari-theme` ZIP read/write, validation, credits | renderer-core |
| `@yunari/player` | Display-only bundle; live samples and theme rendering | renderer-core, scene-fabric |
| `@yunari/editor` | Authoring shell, inspectors, panes, Fabric canvas | renderer-core, scene-fabric, theme-package; fake-source as a devDependency |
| `@yunari/host` | CLI, HTTP/HTTPS server, providers, SSE, stores, TLS | renderer-core, scene-fabric, theme-package |
| `@yunari/store-worker` | Cloudflare Worker: catalogue, auth, uploads, R2 delivery | renderer-core, theme-package |
| `@yunari/fake-source` | Deterministic synthetic samples for development and tests | renderer-core |

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

## USB display panels

USB panels are the host's third display kind, beside paired browsers and local
monitors. A panel has no URL: the host renders the player's pixels itself and
drives the hardware. Current driver families cover Lian Li 9.2-inch and Universal
Screen 8.8-inch panels, the TURZX 5-inch panel, and NZXT Kraken Z53/Z63/Z73.

- `panels/panel-device.ts` defines the seam: geometry, still format and minimum
  frame interval, optional video and hardware controls, open/present/close.
- Each driver owns discovery, protocol, transport and its `PanelFamily` rows.
  `panel-families.ts` only gathers those rows and resolves USB IDs; managers and
  UI never learn packet formats.
- `panel-manager.ts` owns one serialized runner per display. It opens attached
  hardware, coordinates start/stop/refresh, and owns cadence; `panel-raster.ts`
  captures the host's own player through Chromium.
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
- Current schema is `2.0.0`. `MIN_SUPPORTED_SCHEMA_MAJOR` is `2`; migrations are
  keyed by the major they migrate from. Missing migration or newer major is a
  refusal, never a best-effort read.
- Artboard maximum is 16384 px per dimension; node depth is 32, node count 5000;
  IDs use `[A-Za-z0-9_-]{1,64}`; asset paths use `assets/…`.
- A package is a ZIP containing `manifest.json`, `theme.json`, optional
  `thumbnail.png`, declared `assets/` and optional credits. Limits: 95 MiB
  archive, 80 MiB per entry, 180 MiB expanded, 2 MiB thumbnail. The exporter
  writes only declared assets.

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
  credentials, provider settings, `tls/` (root certificate and encrypted root
  key).
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
