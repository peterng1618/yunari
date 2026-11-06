# 0112 — extension core

- **Date:** 2026-11-06
- **Status:** accepted
- **Paths:** `src/web/packages/extension-api/src/manifest.ts`
  `src/web/packages/extension-api/src/capabilities.ts`
  `src/web/packages/extension-api/src/host-api.ts`
  `src/web/packages/extension-api/src/gate.ts`
  `src/web/packages/extension-api/src/consent.ts`
  `src/web/packages/extension-api/src/package.ts`
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

Searched: Orca's extension manifest and capability gate (manifest, deny-by-
default host API table, consent), VS Code's `engines`/`activationEvents`, and
Chrome's manifest permission model.

Found: Orca is the closest prior art — its manifest plus deny-by-default host
API table plus consent is the shape the spec adopts. VS Code and Chrome both
veto an unknown permission and both gate calls, but neither supplies Yunari's
qualified plugin key (store account plus id) or its content-binding digest, so
neither model can be adopted whole.

## Rung 5 — integration comparison

| Option | Fit | Unsolved work | Verdict |
|---|---|---|---|
| One shared pure ABI package (`@yunari/extension-api`) | Editor, host and store Worker import one wire shape; no runtime deps | Package scaffold and build wiring | Chosen |
| Host-only types, imported by consumers | Keeps types next to install code | Editor and Worker depend on the host package, or re-spell the subset | Reject |
| Schema library for the manifest | Validates JSON declaratively | Adds a runtime dependency for a closed, hand-checkable manifest | Reject |

## Rung 6 — smallest probe

A disposable local package declared `process:spawn` in its manifest and was
handed to the manifest reader. It was refused with
`Unknown capability "process:spawn".` — not installed and not executed. The
closed capability list therefore fails before any install or execution path is
reached, which is what the gate is meant to guarantee.

## Decision

Build the pure ABI in one new `@yunari/extension-api` package: manifest schema
and limits, execution-profile rules, capability list, host API table,
capability gate and consent fingerprint helpers. The host imports it for
install, consent and routes; the editor and store Worker import the same wire
shape. No new runtime dependency: validation is hand-written over the closed
manifest, and hashing uses `node:crypto`. Execution stays out of this plan —
`main` and `ui` are validated and recorded, not run, until Plan 4.
