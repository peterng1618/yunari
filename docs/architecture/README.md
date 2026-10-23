# Yunari architecture

Current system shape and hard boundaries. Product intent lives in
[`../product/requirements.md`](../product/requirements.md); detailed concept
ownership lives in [`ownership.md`](ownership.md); durable architecture choices
live in [`../adr/`](../adr/).

## System

```text
                         renderer-core
                 types · semantics · planning
                       (no Fabric import)
                         /          \
                        /            \
                    host          scene-fabric
                 Node/SSE      Fabric objects/persistence
                                  /        \
                                 /          \
                            player          editor
                         StaticCanvas   interactive Canvas
```

`renderer-core` is the semantic boundary. `scene-fabric` prevents browser/Fabric
code from leaking into the Node host.

## Current editor boundary

`@yunari/editor` mounts `fabric/es` directly; there is no adopted
image-editor package. Generic canvas mechanics are split by concern, the same
separation the retired fork used (canvas/text/image/layer/lock/history
managers), sized to what Yunari's panels actually exercise rather than the
fork's full feature surface. `editor-shell.ts` owns canvas mount/disposal,
viewport fitting and artboard paint, and composes the other managers behind
the `EditorInteraction` contract consumed by product panels. `editor-session.ts`
owns product composition over that shell — panel wiring, the chord table, the
action façade and deterministic disposal — and `editor-document.ts` owns the
document that composition edits: the authored envelope and every write to it,
the fan-out each write makes, the picture a save ships, and the file protocol
that creates, opens, saves and releases a package, the replacement question
included. `scene-fabric`'s `FabricSceneHandle` exposes `updateArtboard` for
document-level artboard geometry a `ScenePlan` cannot carry, and
`updateBackground` for the background layer's own writes: a `ScenePlan` carries
only the background's resolved colour, never its media.

`editor-shell/` is React chrome over that boundary: it owns the header menus,
rail, pane bar and canvas dock, and React re-renders only on selection
changes. It never creates or mirrors Fabric objects — menus and dock dispatch
through `editor-session.ts`'s action façade and `EditorInteraction`, and panels
keep their own DOM, relocated into React-owned host nodes.

**The shell has three modes, switched in the header** (`editor-shell/shell-layout.tsx`;
`docs/decisions/0074`). **Editor** is the boundary above, and the only mode with a
canvas. **Themes** is the store — a region that renders no canvas at all, whose
local half lists the host's library and whose catalogue half is phase C's
(`editor/src/store-mode/`). **Host** is `host/public/settings.html` rebuilt in
React: the displays and the theme each shows, the devices and their names, the
display settings, and the hardware the theme on the chosen display reads
(`editor/src/host-settings-mode/`). A mode is shell state and not a route —
nothing persists it, and each region renders in the content area in place of the
editor's body. Both non-editor modes read the host through routes it already
served: the store's `ThemeLibraryClient`, and `host-settings-mode/client.ts` for
this PC's settings.

Importing a package is a **host write**: the browser posts bytes to
`/api/themes/import` (`editor/src/theme-import.ts`) and `host/src/themes/import.ts`
reads the package, mints the id and writes it, so the browser never parses one and
a package never overwrites a theme already in the library.

## Runtime data flow

```text
provider.sample()
    ↓
ProviderRegistry          one poll for the union of connected clients' keys
    ↓
SampleBatch
    ↓ SSE /ws?keys=…
createLiveSource / SampleStore
    ↓
plan.ts                   pure domain decisions
    ↓
scene-fabric
    ↓
StaticCanvas / interactive Canvas
```

Rules: non-`ok` data is a gap, never zero; fake data is test/dev only; providers
acquire while the host schedules; themes bind semantic keys, not provider IDs.
Providers form a fallback chain: a non-`ok` sample does not claim its key, so a
later provider may still answer it; a key nobody measured keeps the earliest
provider's stated reason.

## Persisted theme

The development v2 envelope is:

```text
Theme envelope
├── schemaVersion / fabricVersion / id / metadata (incl. themeLanguage)
├── artboard
├── globals / assets / bindings / editor metadata
└── scene: Fabric JSON
```

Fabric owns geometry, transforms, grouping, stacking, visibility, lock and
custom-object state. Yunari owns semantic/versioned envelope data. Do not add a
parallel simplified scene tree.

`scene-fabric/src/persist.ts` is the canonical serializer/revival path. A Fabric
runtime mismatch is refused before revival. Runtime samples, ECharts options and
render scale are never persisted.

The v2 **scene ownership** and palette/type-preset semantics are implemented.
Envelope validation rejects legacy global groups and local paint/type values. No
external compatibility promise exists before the first release.

## Rendering boundaries

| Boundary | Rule |
|---|---|
| Host ↔ browser | `renderer-core` stays Fabric/DOM-free |
| Player ↔ editor | player may use `scene-fabric`, never editor UI/managers or interactive `Canvas` |
| Domain ↔ renderer | `renderer-core` decides; `scene-fabric` applies |
| Charts ↔ ECharts | typed Yunari settings cross one adapter; raw ECharts options never enter theme files |

`player/src/boundaries.test.ts` guards the player import boundary and `fabric/es`
usage.

## State categories

| State | Examples | Rule |
|---|---|---|
| Authored | geometry, chart settings, token refs | persisted; history where supported |
| Derived | resolved tokens, built ECharts options | recomputed |
| Runtime | telemetry, animation/playback | never saved/undoable |
| UI transient | selection, viewport, gesture state | never document content |

## Consumer settings scope

| Setting | Scope | Owner |
|---|---|---|
| Device assignments, display names, clock zone, measurement system | this PC, whatever theme is shown | `host/src/settings/devices.ts`, `host/src/settings/display.ts` |
| A theme's device answers | one theme on this machine; asked only for the slots its bindings need | `host/src/settings/theme-settings.ts`, `host/src/settings/required-devices.ts` |

A global setting never reads the active theme: filtering this PC's own controls
by what is displayed makes a machine-level choice unreachable. Device assignment
resolves in one place — theme answer → global answer → provider default — and
resolves **per display**, for the display whose tick is asking: every input to it
(devices, the chosen theme, a theme's answers) is read in `currentAssignment()` in
`host/src/server.ts`, so a display is served the device it resolved on its own
next sample.

Where a preference is applied follows from what it is about. The zone is a fact
about the machine's clock, so the **provider** applies it when it reads, and every
display agrees without re-converting. The measurement system changes presentation
only, so the **display** applies it: a sample stays what the provider measured
(§97), conversion happens after a binding's own scale and offset and before
formatting, and only for a family that declares one — temperature today, in
`renderer-core/src/scene/measurement.ts`. A hosted theme is revived rather than
planned, so it converts in `refreshBoundText`. A display reads the
preference once at load (`player/src/theme-loader.ts`); the editor preview does
not, so it stays metric.

## Verification boundaries

Unit tests cover pure/domain behaviour and adapter contracts. Browser tests prove
canvas/editor wiring and pixels. Browser tests preview bundles rather than the
host. Visible renderer changes require inspection of selected affected evidence;
screenshots are evidence, not cross-platform golden files.
