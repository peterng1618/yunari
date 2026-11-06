# 0111 — data-pack foundations

- **Date:** 2026-11-06
- **Status:** accepted
- **Paths:** `src/web/packages/theme-package/src/index.ts`
  `src/web/packages/theme-package/src/path-preset-pack.ts`
  `src/web/packages/theme-kit/src/card-library.ts`
  `src/web/packages/theme-kit/src/widget-unit.ts`
  `src/web/packages/scene-fabric/src/path-preset.ts`
  `src/web/packages/editor/src/asset-manager/index.ts`
  `src/web/packages/editor/src/widget-packs.ts`
  `src/web/packages/editor/src/path-presets.ts`
  `src/web/packages/editor/src/new-fabric-theme.ts`
  `src/web/packages/editor/src/new-object-panel.ts`
  `src/web/packages/editor/src/settings-mode/pages/path-presets-page.tsx`
  `src/web/packages/editor/src/editor-shell/shell-layout.tsx`
  `src/web/packages/host/src/packs/widget-packs.ts`
  `src/web/packages/host/src/packs/bundled-default-pack.ts`
  `src/web/packages/host/src/presets/path-presets.ts`
  `src/web/packages/host/src/server/pack-routes.ts`
  `src/web/packages/host/src/server.ts`
  `src/web/packages/mcp/src/tools/compose.ts`

## Problem

Widget packs, the starter theme, and path presets are still composed by code.
`CARD_LIBRARY` and `cards.ts` build dashboard widgets at runtime, the starter
theme is `createStarterTheme`, and path presets live in one browser's
`localStorage`. The product needs all three to be installable data, with the
host as the one owner of installed packs and one path-preset list, so the
editor and MCP read the same rows and a pack installs, validates and removes
without partial state. A wrong integration fails quietly: a pack that installs
half its assets, a preset list that forks between browser and host, or a
second scene model built beside Fabric JSON.

## Rung 1 — internal owner

Searched: CodeGraph/source for `readWidgetPackage`, `writeWidgetPackage`,
`readThemePackage`, `instantiateCard`, `CARD_LIBRARY`, `AssetManager`,
`path-presets.ts`, `createJsonFile`, host route handlers.

Found: the package container already exists in
`theme-package/src/index.ts` — `yunari-widget-package` with strict manifest,
archive preflight, declared-asset matching, and a round-trip writer.
`theme-package/src/archive-preflight.ts` owns entry-count, size and path rules.
`theme-kit/src/card-library.ts` already owns copying, id minting, binding
remap, token substitution and provenance; only its unit source is a module
constant. `AssetManager` owns declaration allocation, byte storage, SHA-256 and
mutation notification. The host already stores JSON state through
`createJsonFile` and serves loopback-checked write routes. The unsolved part is
the seam between them: a package file map with no units, a unit model with no
package source, and a preset list with no host row.

## Rung 2 — installed dependencies

Searched: `fflate` source/types already used by `theme-package`; Fabric `Path`
and `hasClosedPath` in `scene-fabric`.

Found: `fflate` `unzipSync`/`zipSync` and the archive preflight already provide
bounded extraction; no archive library is added. Fabric's `Path(data)` parses
SVG path data into commands and reports `width`/`height`; `hasClosedPath`
already decides stroke vs fill from those commands, so path-preset validation
reuses both rather than writing a second SVG parser.

## Rung 3 — native platform

Searched: Node `fs/promises` (atomic `rename`, `mkdir`), JSON, `node:crypto`
SHA-256; browser `Storage`.

Found: native `fs` gives atomic-ish install (write temp, rename) and directory
listing; JSON is the preset format. `Storage` remains only as the migration
source; it is not a second owner after migration. The platform leaves the
package semantics (manifest, declared assets, unit derivation) to the app.

## Rung 4 — public solutions

Searched: VS Code extension manifest and VSIX packaging
(`code.visualstudio.com/api/references/extension-manifest`,
`.../publishing-extension`); Figma widget manifest
(`developers.figma.com/docs/widgets/widget-manifest/`).

Found: both platforms put one JSON manifest at a known root member with a
format id, required fields, and declared contributions, and validate the file
set before activation. VSIX adds a second XML manifest and MIME table — more
container than a data pack needs. Figma's manifest is nearest in shape but
still assumes executable `main` code. Neither solves Yunari's specific unit
question: one package carrying several insertable canvas groups with their
bindings and assets. The existing Yunari container already answers that, and
the spec's Orca-parity model separates code plugins from data packs.

## Rung 5 — integration comparison

| Option | Fit | Unsolved work | Verdict |
|---|---|---|---|
| Reuse `yunari-widget-package` and add a file-map reader with unit derivation | Same archive preflight, manifest, writer and asset rules; editor, host and MCP already import `theme-package` | Derive units, per-unit bindings/assets, refuse duplicate ids | Chosen |
| Add a second widget document/container format | Duplicates archive preflight and validation | Second scene model, migration, two writers | Rejected |
| Keep `CARD_LIBRARY`, install packs beside it | No format work | Two sources of widget units; the Add pane and MCP can disagree | Rejected by spec |
| Move presets to a database | Host already has JSON-file state | New dependency, migration, no benefit for one list | Rejected |
| Render starter at runtime from a generator | No data work | Contradicts "starter is data"; saved themes still need the package reader | Rejected by spec |

## Rung 6 — smallest probe

The probe is the Task 2 file-map reader run against a real exported widget
package and the Task 7 archives generated by the current writers. If the
existing `writeWidgetPackage` output cannot be read back through the file-map
path with its units, bindings and assets intact, the reuse decision is wrong.
The probe is executable in the package test suite before any host or editor
wiring.

## Decision

Reuse the `yunari-widget-package` and `yunari-theme-package` containers and
extend `theme-package` with a file-map reader, unit derivation, and a
`yunari-path-preset-pack` v1 structural reader. Reuse `instantiateCard` and
`AssetManager` for insertion and asset adoption. The host gains one installed
widget-pack store and one path-preset store under the settings directory; the
editor and MCP read those rows. The starter theme and default widget pack ship
as committed archives produced by the existing writers. No new runtime
dependency is added.
