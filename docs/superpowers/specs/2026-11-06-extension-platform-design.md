# Extension platform design (Orca parity)

## Status

Approved design. Implementation follows in separate plans. Yunari is
pre-release, so the internal extension ABI may break cleanly; no compatibility
glue is added for a superseded internal design.

## Goal

One extension model for every user-extensible surface in Yunari:

- executable plugins for sensor providers, asset sources, settings UI, and USB
  panel drivers;
- declarative plugins for asset categories, asset sources, and custom data
  sources;
- data packs for dashboard themes, editor themes, dashboard widgets, and
  custom path presets;
- online-store distribution with validation, versions, review where required,
  consent, update holds, and revocation.

Orca parity means Orca's extension mechanics, not every Orca contribution
point. The surfaces Yunari does not have — terminal plugins, command palette,
status bar items, agent harnesses, VM recipes — are out of scope.

## Product direction

- **Dashboard panels are widget packs.** A dashboard panel is a group of canvas
  objects, carried as data, not a code-defined renderer. The starter theme and
  the default widget pack are bundled content.
- **The starter theme is a normal theme.** It is a `theme.json` with declared
  assets, loaded through the theme package reader. The code that composes it is
  removed.
- **Path presets are user data.** Built-in presets remain data. User presets and
  installed preset packs share one host-owned list, so the editor and MCP see
  the same presets.
- **USB display panels remain code.** A panel family owns a hardware protocol.
  It cannot be a data pack. It is admitted only as a reviewed trusted worker
  with host-mediated device access.

## Current state

| Surface | Current owner | Gap |
|---|---|---|
| Sensor providers | `SensorProvider`, `ProviderRegistry`; static array in `host/src/main.ts` | No runtime plugin loader, manifest, capabilities, consent |
| Asset sources | `AssetSource`, `ASSET_SOURCES` | Static registry; closed category/body unions |
| Asset categories | `SourceCategory`, `ListingCategory`, editor `CATEGORY_ORDER` | New category needs wire and editor edits |
| Custom data sources | `CustomSource` JSON, SSRF-guarded fetch, JSON-pointer fields | No sharing, no pagination, no code provider path |
| USB panel families | `PanelFamily`, static `PANEL_FAMILIES` | No plugin admission, no hardware consent |
| Dashboard widgets | `CARD_LIBRARY`, `cards.ts` builders | Code-generated; widget package reader exists but import/install is not wired |
| Starter theme | `createStarterTheme`, `cards.ts`, `starter-backdrop.ts` | Generated code; should be data |
| Path presets | `path-presets.ts`, browser `localStorage` | No pack format, no sharing, no host ownership |
| Store | `dashboard-theme` only; validated theme envelope | No data-pack kinds, plugin kind, consent, review, update policy, kill list |

The widget package container already exists:
`theme-package/src/index.ts` defines `yunari-widget-package` (`manifest.json`,
`widget.json`, declared assets, no artboard). `writeWidgetPackage` and
`readWidgetPackage` are implemented, and the editor exports a selection
(`editor-document.ts` `exportWidget`). Import/install is the missing half.

## Extension model

### Package kinds

| Store kind | Payload | Code |
|---|---|---|
| `dashboard-theme` | existing `yunari-theme-package` | no |
| `editor-theme` | existing editor-token package | no |
| `widget-pack` | existing `yunari-widget-package` | no |
| `path-preset-pack` | `yunari-path-preset-pack` JSON v1 | no |
| `plugin` | `yunari-plugin-package` zip | yes or declarative |

Declarative source packs are `plugin` items with `execution: "declarative"` and
no entry. There is no separate source-pack item kind.

### Plugin manifest

Root member `yunari-plugin.json`, `manifestVersion: 1`, strict unknown-key
refusal. Required fields:

```json
{
  "manifestVersion": 1,
  "id": "acme-sensors",
  "name": "Acme Sensors",
  "version": "1.2.0",
  "description": "Reads Acme hardware.",
  "engines": { "yunari": ">=0.1.0" },
  "pluginApi": 1,
  "execution": "trusted-worker",
  "capabilities": ["sensor:provide", "network:fetch", "storage:own"],
  "contributes": {
    "sensorProviders": [{ "id": "acme", "label": "Acme" }]
  },
  "main": "main.js"
}
```

- `id` is kebab-case. Reserved ids start with `yunari-`.
- `publisher` is optional. The catalog derives it from the store account or
  repository. Local installs use `local`. Reserved publisher names are
  `yunari`, `official`, and any `yunari` prefix.
- `version` is semver. `engines.yunari` is the oldest supported release.
- `pluginApi` is the host API major. It starts at `1`.
- `execution` is `data`, `declarative`, `sandboxed-ui`, or `trusted-worker`.
- `capabilities` is a closed list, at most 32 entries.
- `contributes` is strict and closed.
- `main` is required by `trusted-worker`; `ui` is required by
  `sandboxed-ui`.

### Execution profiles

The required profile is the highest required by any contribution:

| Profile | May run | Required by |
|---|---|---|
| `data` | nothing; store metadata only | reserved for future non-code contributions; current data content uses store item kinds |
| `declarative` | descriptors only | `assetCategories`, `assetSources` descriptors, `customSources`, `settingsPages` forms |
| `sandboxed-ui` | isolated frame | `ui`, custom asset bodies, sandboxed settings |
| `trusted-worker` | forked worker | `sensorProviders`, `panelFamilies`, code `assetSources` |

A manifest may declare a higher profile than its contributions require. It may
not declare a lower one. `main` requires `trusted-worker`. A `trusted-worker`
manifest without `main` is refused.

### Capability vocabulary

Closed set:

| Capability | Grants |
|---|---|
| `sensor:provide` | Register a sensor provider |
| `asset:provide` | Register an asset source or category |
| `panel:drive` | Register a USB panel family; trusted only |
| `network:fetch` | Host-mediated outbound requests to declared hosts |
| `storage:own` | Plugin-scoped storage directory |
| `secrets:own` | Plugin-scoped encrypted secrets |
| `settings:own` | Plugin-owned settings |
| `ui:frame` | Sandboxed frame contribution |
| `usb:device` | Host-mediated USB transfers for declared vendor/product IDs; trusted only |
| `serial:device` | Host-mediated serial transfers for declared paths/IDs; trusted only |

Unknown capabilities are refused, not ignored. No plugin receives
`process:spawn`, arbitrary filesystem access, or the host credential store.

### Contribution points

- `sensorProviders` — `{ id, label }`; keys are discovered through the provider
  API, not declared in the manifest.
- `assetCategories` — `{ id, label, icon, resultKind, body: "grid" }`.
- `assetSources` — `{ id, label, category, body, requires?, request, result,
  paging? }` for declarative sources, or a code entry for trusted sources.
- `panelFamilies` — `{ id, label, vendorId, productId, geometry, support,
  commands, renderModes? }`.
- `settingsPages` — declarative form descriptor or sandboxed UI entry.
- `customSources` — existing `CustomSource` schema plus optional paging.

Contribution identities are part of consent. Adding an authority-bearing
contribution forces re-consent.

### Host API

A shared pure package, `@yunari/extension-api`, owns:

- manifest schema and limits;
- execution-profile rules;
- capability list and descriptions;
- the host API method table;
- the capability gate;
- consent fingerprint helpers.

Every method entry names its capability, allowed surfaces, scope, `since`
version, and strict parameter/result schemas.

Host-to-plugin requests: `init`, `describe`, `sample`, `health`, `stop`,
`panel.open`, `panel.present`, `panel.command`, `panel.close`,
`settings.render`.

Plugin-to-host requests: `network.fetch`, `storage.*`, `secrets.*`,
`settings.*`, `usb.*`, `serial.*`, `log`.

`pluginApi` major 1 is additive. A newer minor may add methods. An older host
refuses newer parameters instead of silently ignoring them. `engines.yunari`
must cover every requested capability's `since` release.

### Capability gate

`gateExtensionCall` is deny-by-default:

1. Look up the method in the host API table. Missing method denies.
2. Check the calling surface. A worker cannot call frame methods, and a frame
   cannot call worker-only methods.
3. Require a non-null consent. Null means unknown, disabled, missing, or stale
   consent; all deny.
4. If the method requires a capability and the granted set lacks it, deny.
5. Otherwise allow.

The host rechecks every call. Worker-side grants are for early refusal only.
An empty capability set is trusted but grants nothing.

### Consent

Consent is stored against `(qualified plugin key → fingerprint)`, never the
bare id.

The fingerprint is a SHA-256 binding digest over canonical JSON:

- schema tag and host API major;
- qualified plugin key and version;
- content hash of the install tree;
- execution profile;
- sorted canonical capabilities;
- authority-bearing contribution identities;
- device allowlists.

It is a binding digest, not a cryptographic signature. Different plugin,
version, file set, or broader access produces a new fingerprint.

The consent surface lists the execution profile, every capability, device
allowlists, contributions, and command replacements if any. Data-only items do
not require consent. Local development folders may run edited code under the
same approval; new access, a higher profile, or changed authority-bearing
contributions requires approval again.

### Update policy

- Auto-update only when the update asks for nothing new.
- Hold for review when capabilities, execution profile, authority-bearing
  contribution identities, device allowlists, or publisher change.
- Publisher identity comes from the catalog, not the manifest.
- A held update surfaces as a review notice with plugin key, name, and
  publisher.

### Registry integration

First-party and plugin rows feed the same owners:

- `ProviderRegistry` gains plugin-backed providers. Built-ins keep precedence;
  the user may reorder plugin providers.
- `ASSET_SOURCES` becomes a registry with built-ins plus declarative and code
  contributions.
- `PANEL_FAMILIES` becomes a registry with built-in drivers plus reviewed
  plugin families.
- `SourceCategory` becomes an open id with built-in ordering. The generic grid
  renders unknown categories. Custom bodies require `sandboxed-ui`.
- No manager learns plugin details. The provider, asset-source, and panel
  contracts stay the public ABI.

## Data packs

### Widget packs

A widget pack uses the existing `yunari-widget-package` container. A pack may
carry one or more units. The package manifest may carry an optional
`units: [{ id, label, objectId }]` list. When it is absent, each top-level group
that carries `provenance.widgetId` is one unit, and `provenance.widgetName` is
its label. The existing `instantiateCard` logic remains the owner of copying,
id collision, binding remap, and token substitution.

The Add pane and MCP `add_card` read installed widget packs, not a module
constant. The bundled default pack replaces `CARD_LIBRARY`. A user-made
selection export is already a valid pack; it gains an install path.

### Starter theme and default widget pack

The starter theme becomes bundled data:

- `theme.json` plus declared assets, loaded through the theme package reader;
- `STARTER_TEMPLATE` keeps its id;
- the default widget pack is bundled beside it;
- the starter theme contains copies of the widget groups; theme content may
  duplicate widget content because a theme is authored content, not a second
  derivation of a rule.

Remove the generators:

- `theme-kit/src/starter.ts` composition (`createStarterTheme`);
- `theme-kit/src/cards.ts`;
- `CARD_LIBRARY` build functions (keep the copy/remap mechanism);
- `editor/src/starter-backdrop.ts` module and its `?url` loader;
- the starter branch of `createNewFabricTheme`.

`createBlankTheme` becomes a literal blank envelope, not "starter minus
composition". Generic authoring helpers in `theme-kit` stay for MCP and
external authoring, but starter palette and type tokens move to the bundled
data.

### Path preset packs

Format:

```json
{
  "format": "yunari-path-preset-pack",
  "version": 1,
  "id": "acme-shapes",
  "name": "Acme Shapes",
  "presets": [
    { "id": "wave", "label": "Wave", "data": "M 0 0 ...", "paint": "stroke" }
  ]
}
```

Validation uses the existing user-preset rules: non-empty label and data,
Fabric `Path` parses, non-zero extent on at least one axis, paint derived from
`hasClosedPath`. No assets, so no zip container.

The host becomes the owner of the preset list:

- built-ins remain bundled data;
- local user presets keep `user:` ids;
- imported pack presets use `pack:<packId>:<presetId>`;
- the editor migrates `yunari.editor.path-presets` and
  `yunari.editor.removed-path-presets` once, then reads the host list;
- removing a pack removes only its presets;
- removing a built-in still uses the separate removed-ids list.

The editor, settings page, and MCP read the same host-owned list.

### Declarative sources and categories

`assetCategories` declares a category and uses the generic grid. No editor code
change is needed for a new category. `font` and `local` remain built-in bodies.

`assetSources` uses the existing asset wire shape plus a request/result/paging
descriptor. `customSources` uses the existing `CustomSource` schema plus
optional paging. The existing SSRF guard, host allowlist, headers, auth modes,
interval and timeout bounds remain the validators.

Complex providers use a `trusted-worker` code contribution. They return the
same `AssetPage` and `SampleEntry` shapes; the host still owns scheduling,
buffering, history, and fallback.

## USB panel drivers

A panel family plugin runs only as `trusted-worker` and declares:

- vendor and product ids;
- geometry;
- support and command list;
- render modes;
- required device transports.

The host owns every device handle. The plugin requests:

- `usb.open`, `usb.close`;
- `usb.bulkTransfer`, `usb.controlTransfer`, `usb.interruptTransfer`;
- `hid.read`, `hid.write`;
- `serial.read`, `serial.write`, `serial.drain`.

The host checks the declared vendor/product ids or serial path allowlist,
claims the interface, and applies backpressure. No device handle crosses the
worker boundary. Frame bytes travel as buffers.

Install requires explicit hardware consent naming the device ids. Store review
is mandatory before publish. A driver crash or timeout stops only that
display's runner. The kill list unloads it.

Known limitation: Node cannot fully sandbox a native USB stack. Host mediation,
review, consent, and revocation are the controls. The spec does not claim an
OS-level sandbox that does not exist.

## Store and distribution

### Item kinds

`dashboard-theme`, `editor-theme`, `widget-pack`, `path-preset-pack`, and
`plugin`.

`dashboard-theme`, `editor-theme`, `widget-pack`, and `path-preset-pack`
publish self-serve after validation. `plugin` items publish self-serve when
they are `declarative`, `sandboxed-ui`, or non-hardware `trusted-worker`.
Plugins that declare `panelFamilies`, `usb:device`, or `serial:device` require
review before publish.

### Validation

The store validates the manifest, package paths, size caps, declared file set,
SHA-256, entry points, contribution schemas, capability vocabulary, execution
profile, and reserved names. The host revalidates before install. A package is
never executed before validation and consent.

### Store worker

Add to the item version record:

- `metadata_json` for pack manifests and plugin metadata;
- package kind and execution profile;
- package size and SHA-256;
- review state per item kind.

`dashboard-theme` keeps its existing `envelope_json` path. The catalogue index
gains pack/plugin kinds and facets. Existing version ladder, remix, status,
downloads, and author listing remain the owners.

### Publisher identity and review

Publisher is derived from the store account or repository, never trusted from
the manifest. Reserved names cannot be claimed. Hardware plugins enter the
existing review queue before `published`.

### Install, update, uninstall

Install:

1. Download the package from the store.
2. Verify size and SHA-256.
3. Validate paths, manifest, package kind, and contributions.
4. Store under the host settings directory.
5. Show consent when required.
6. Add rows to the registry and reload the relevant manager.

Update follows the version ladder and update policy. Uninstall removes the
plugin directory and its registry rows; it does not touch user-authored
themes, widgets, or presets.

### Kill list

`kill-list.json` v1 carries a generated timestamp and entries keyed by
qualified plugin key with an optional HTTPS advisory URL. The store serves the
list; the host fetches it at startup and on install/update checks, caching the
last good list. The host blocks a killed plugin from loading. Unknown fields
are ignored so older clients still revoke. The disabled list overrides consent.

## Security invariants

- Credentials stay in the host. A plugin receives only its own secrets.
- Network access is host-mediated with the existing SSRF guard and declared
  hosts only.
- Package paths are relative, with no traversal, no symlinks, and bounded entry
  count, size, and depth.
- No fabricated telemetry. Provider `non-ok` semantics and fallback order are
  unchanged.
- LAN and admin rules are unchanged. Plugin management is loopback-only.
- Theme schema `2.0.0` is unchanged. Widget and preset packs do not create a
  second scene model.
- One owner per concept: installed-pack registry, preset list, provider
  registry, panel registry.
- Store review is a gate before publish; host validation and consent are gates
  before execution.

## Migration

- Existing themes and editor themes are unchanged.
- Existing widget packages become installable; the export format does not
  change.
- Existing user path presets migrate once from browser storage to the host.
  If the host is unavailable, the editor keeps the local list and retries; no
  preset is lost.
- `STARTER_TEMPLATE` id is stable. A saved theme is never rewritten.
- The default widget pack becomes the only source of the bundled units; the
  starter theme remains a normal theme document.
- No theme schema version bump.

## Delivery phases

The implementation splits into these plans, in order:

1. **Data-pack foundations.** Widget pack registry and import/install; bundled
   default pack; bundled starter theme; path-preset pack format and host
   ownership; remove generators.
2. **Extension core.** Manifest schema, execution profiles, capability list,
   host API table, capability gate, consent store, local plugin install,
   registry integration for declarative contributions.
3. **Store distribution.** New item kinds, worker metadata, validation,
   publisher identity, update policy, kill list, review for hardware.
4. **Executable providers and asset sources.** Trusted-worker providers and
   code asset sources; storage, secrets, settings, network mediation.
5. **Sandboxed UI and settings.** Isolated frame protocol, gesture-gated frame
   API, plugin settings pages, custom asset bodies.
6. **USB panel drivers.** Host-mediated USB/HID/serial API, panel family
   contribution, hardware consent, reviewed store admission, fake-device tests.

## Acceptance criteria

- The starter template renders from bundled data; no generator module is
  imported by the editor.
- The Add pane and MCP list the same installed widget units.
- A path-preset pack installs, inserts, exports, and removes without touching
  other presets.
- A declarative asset category appears in the finder with no editor code
  change.
- A plugin provider samples through `ProviderRegistry`; a failing plugin does
  not blank other providers.
- Consent, access growth, update hold, kill list, uninstall, and stale consent
  are covered by tests.
- A reviewed fake USB family drives a fake device only through host-mediated
  transfers.
- `npm run gate` exits 0.

## Decisions

- Non-hardware executable plugins are self-serve with consent; hardware
  plugins require review.
- The consent fingerprint is a binding digest, not a signature.
- USB panel drivers use host-mediated device access, not direct handles.
- Declarative source packs are `plugin` items, not a separate kind.
- Path presets and packs are host-owned.
- New asset categories use the generic grid; custom bodies require
  `sandboxed-ui`.
- The starter theme and default widget pack are data; their generators are
  deleted.
