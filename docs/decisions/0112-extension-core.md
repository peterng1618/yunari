# 0112 — extension core

- **Date:** 2026-11-06
- **Status:** accepted
- **Paths:** `src/web/packages/extension-api/src/manifest.ts`
  `src/web/packages/extension-api/src/manifest-values.ts`
  `src/web/packages/extension-api/src/manifest-contributions.ts`
  `src/web/packages/extension-api/src/capabilities.ts`
  `src/web/packages/extension-api/src/host-api.ts`
  `src/web/packages/extension-api/src/gate.ts`
  `src/web/packages/extension-api/src/consent.ts`
  `src/web/packages/extension-api/src/package.ts`
  `src/web/packages/extension-api/src/index.ts`
  `src/web/packages/extension-api/src/installed.ts`
  `src/web/packages/host/src/extensions/content-hash.ts`
  `src/web/packages/host/src/extensions/install.ts`
  `src/web/packages/host/src/extensions/consent-store.ts`
  `src/web/packages/host/src/extensions/service.ts`
  `src/web/packages/host/src/server/extension-routes.ts`
  `src/web/packages/renderer-core/src/assets/wire.ts`
  `src/web/packages/editor/src/asset-finder/finder-model.ts`

## Problem

Extension contributions feed registries the host and editor already own: sensor
providers, asset sources and categories, panel families, and settings pages. A
wrong boundary here fails quietly — a manifest shape the editor accepts but the
host rejects installs a plugin that never runs, and a capability check that
lives on only one side lets a call through that the other side believes denied.
The manifest, capability list, host API table, gate and consent fingerprint must
be one definition every surface reads, not three derivations of the same rule.

## Rung 1 — internal owner

Searched: the registries and guards the contributions extend —
`packages/host/src/providers/registry.ts`,
`packages/host/src/assets/` (`ASSET_SOURCES`),
`packages/host/src/panels/panel-families.ts`,
`packages/renderer-core/src/assets/wire.ts`,
`packages/host/src/settings/sources.ts`, plus route guards in
`packages/host/src/server/identity.ts` and atomic stores in
`packages/host/src/settings/json-file.ts`.

Found: each registry owns its concept and already accepts a row from a driver
module (`PANEL_FAMILIES` gathers driver exports; `ASSET_SOURCES` is a table the
routes and search read). The asset wire types are the editor/host contract, and
`json-file.ts` already provides queued atomic read-modify-write. What remains
unsolved is the shared vocabulary in front of these registries: no manifest
schema, capability list, host API table, gate or consent record exists.

## Rung 2 — installed dependencies

Searched: `packages/theme-package` (`readPackageArchive`,
`archive-preflight.ts`, `fflate`) and the `renderer-core` wire types.

Found: `readPackageArchive` already opens a zip safely — `archive-preflight`
bounds entry count, size and offset before `fflate` unpacks — so a plugin
archive does not need a second archive reader. `renderer-core` owns the asset
wire types the contributions must speak. No dependency provides a manifest
schema, capability vocabulary, gate or consent fingerprint.

## Rung 3 — native platform

Searched: Node 22 `node:fs/promises` (write-temp-then-rename, fsync),
`node:crypto` (`randomBytes`, `createHash`) and Web Crypto `subtle.digest`.

Found: these supply atomic writes and a SHA-256 digest, which is what a binding
fingerprint needs. They supply no ABI: no manifest validation, no execution
profile rules, no capability gate and no consent semantics.

## Rung 4 — public solutions

Searched:
- Yunari's parity target, `docs/superpowers/specs/2026-11-06-extension-platform-design.md`
  (`Extension model`, `Security invariants`) — the manifest, deny-by-default
  host API table and consent shape this note adopts.
- VS Code manifest and activation events:
  `https://code.visualstudio.com/api/references/extension-manifest`,
  `https://code.visualstudio.com/api/references/activation-events`.
- Chrome manifest and permissions:
  `https://developer.chrome.com/docs/extensions/reference/manifest`,
  `https://developer.chrome.com/docs/extensions/reference/permissions`.
- Node `fs.rename` and `fsync`: `https://nodejs.org/api/fs.html`.

Found: the spec is the parity target. VS Code and Chrome both tolerate what
they do not understand — an unknown contribution point is warned about and the
extension still loads, and an unrecognised permission or manifest key is warned
about and ignored. They invalidate only what they depend on, so an unknown key
does not stop the extension. Neither supplies Yunari's qualified plugin key
(store account plus id), its binding digest over the install tree, or
host-mediated execution for a trusted worker. Yunari instead refuses unknown
manifest keys, unknown capabilities and unknown contribution points at the
boundary, which is this note's decision. Node's rename/fsync underpin the atomic
consent store but carry no plugin semantics.

## Rung 5 — integration comparison

| Option | Fit | Unsolved work | Verdict |
|---|---|---|---|
| One shared pure ABI package (`@yunari/extension-api`) | Editor, host and store Worker import one wire shape; no runtime deps | Package scaffold and build wiring | Chosen |
| Host-only types, imported by consumers | Keeps types next to install code | Editor and Worker depend on the host package, or re-spell the subset | Reject |
| Schema library for the manifest | Validates JSON declaratively | Adds a runtime dependency for a closed, hand-checkable manifest | Reject |

## Rung 6 — smallest probe

No manifest reader exists when this note lands — the reader is built in Task 2.
The probe this note authorises is therefore the reader's first test: a local
package declaring `process:spawn` is refused with
`Unknown capability "process:spawn".`, and no install or execution path is
reached. This is design-established here, not measured; the Task 2 test measures
it.

## Decision

Build the pure ABI in one new `@yunari/extension-api` package: manifest schema
and limits, execution-profile rules, capability list, host API table,
capability gate and consent fingerprint helpers. The host imports it for
install, consent and routes; the editor and store Worker import the same wire
shape. No new runtime dependency: validation is hand-written over the closed
manifest, and hashing uses `node:crypto`. Execution stays out of this plan —
`main` and `ui` are validated and recorded, not run, until Plan 4.
