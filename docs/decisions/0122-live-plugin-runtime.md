# 0122 — A live plugin runtime keeps contributions current without a restart

- **Date:** 2026-11-07
- **Status:** accepted
- **Paths:** `src/web/packages/host/src/extensions/plugin-runtime.ts`, `src/web/packages/host/src/extensions/providers.ts`, `src/web/packages/host/src/extensions/declarative-sources.ts`, `src/web/packages/host/src/assets/routes.ts`, `src/web/packages/host/src/providers/registry.ts`, `src/web/packages/host/src/panels/plugin-panel-rows.ts`, `src/web/packages/host/src/main.ts`

## Problem

Installing a trusted-worker plugin and granting its consent while the host runs
left every contribution dead until the next start. A wrong integration fails
quietly here: the worker loop, the provider registry, the asset-source list and
the panel-family rows are four separate registries, and adding a fifth
startup-only copy of any of them would let the surfaces disagree about which
plugins this run serves. The change must also keep one worker per plugin, one
provider order rule, one source-id collision rule and one revocation path.

## Rung 1 — internal owner

Searched: CodeGraph for `recheckPluginSupervisors`, `startPluginSupervisors`,
`createPluginProviders`, `createPluginAssetSources`, `createAssetSources`,
`ProviderRegistry`, `PluginPanelRows`, `PanelFamilyRegistry`, and the
`ExtensionService` `onChange`; then the call sites in `main.ts`.

Found: `ExtensionService.onChange` already fires after install, grant and remove.
`revokePluginRuntime` already stops a worker, drops its allowlist and panel rows
and closes its devices. `PluginPanelRows` and `PanelFamilyRegistry` already
update a live registry. `ProviderRegistry` and the asset-source list were the
only startup snapshots: the registry took a fixed array, and `main.ts` passed a
fixed array to the routes. What was missing was the add/remove half of the
lifecycle and a composition owner that rebuilt the four lists together.

## Rung 2 — installed dependencies

Searched: the host's runtime dependencies (`@yunari/extension-api`,
`@yunari/renderer-core`, native drivers) and the extension-api types and tests
for `InstalledPlugin`, `PluginInstaller`, `InstalledExtension`,
`deviceAllowlistOf`.

Found: `@yunari/extension-api` donates the manifest, installer and device
allowlist shapes this composition reads; it has no registry or lifecycle
container. No installed package owns plugin activation or contribution
reconciliation, so there is nothing to adopt.

## Rung 3 — native platform

Searched: Node's `Map`, promise chaining and the existing `onChange` event.

Found: the event already exists; no poll, watcher or process restart is needed.
A `Map` keyed by plugin key is the platform's own once-per-key rule, and a
serialized promise chain orders two overlapping changes. A filesystem watcher
would be a second, slower trigger for a fact the service already reports.

## Rung 4 — public solutions

Searched: VS Code activation events and extension-host docs
(`code.visualstudio.com/api/references/activation-events`,
`code.visualstudio.com/API/advanced-topics/extension-host`); the cordis plugin
registry and loader (`cordiverse/cordis`); `live-plugin-manager`;
`LibriaForge/plugin-loader`.

Found: VS Code activates an extension once per activation event and tears it
down through `deactivate`; the extension host is restarted when its world
changes. Cordis keeps a `Map` of plugin runtimes, uses set reconciliation
(present in new only → create; both → update; present in old only → remove) and
cascades disposal when a runtime is deleted. `live-plugin-manager` and
`plugin-loader` install and load at runtime but leave the host's contribution
registries to the application. None donates a registry for Yunari's provider,
asset-source and panel shapes.

## Rung 5 — integration comparison

| Option | Fit | Unsolved work | Verdict |
|---|---|---|---|
| Reconcile the four lists from `installer.list()` + `mayLoad` on each `onChange`, updating the existing registries in place | reuses `startPluginSupervisor`, `createPluginProviders`, `createPluginAssetSources`, `declarativeAssetAdapters`, `revokePluginRuntime`, `orderProviders`, `PanelFamilyRegistry` | none beyond a make-live seam on the provider registry and the asset route | chosen |
| Restart the host (or the plugin subsystem) on change | none: the report forbids a restart message | process lifecycle, port, windows, panels | rejected |
| Patch each registry incrementally per event | duplicates the collision, ordering and allowlist rules | five patching paths, each able to disagree | rejected |
| A second runtime that watches the extensions folder | duplicates the service's event and its consent state | watcher debounce, races with install, two sources of truth | rejected |

## Rung 6 — smallest probe

The change is behavior, not a dependency choice. The host test builds the real
controller with the same fakes the supervisor tests use: grant → one worker,
provider, code and declarative source rows and a panel family appear; revoke →
all four leave and the worker stops once; a second grant forks no second worker;
a provider order written between grants is read on the next reconcile. The
asset-route test reads a function-shaped source list twice and sees the row a
change added, proving the route reads the list per request.

## Decision

`extensions/plugin-runtime.ts` is the one live composition owner. `main.ts`
builds the registries once, hands them to the controller and calls
`reconcile()` at startup and from `onChange`. The controller:

- starts one supervisor per loadable code plugin, keyed by plugin key;
- removes a plugin that may no longer load through `revokePluginRuntime`;
- mirrors the allowlists of the plugins that may load;
- rebuilds providers through `createPluginProviders` and `orderProviders`,
  re-reading the provider-order store, and installs them with
  `ProviderRegistry.setProviders`;
- rebuilds panel rows and installs them with `PluginPanelRows.replace`;
- rebuilds code sources through `createPluginAssetSources` and declarative
  sources through `declarativeAssetAdapters`, then one `createAssetSources`.

`AssetRouteOptions.sources` accepts a getter so `/api/assets/sources` reads the
live list per request. Rebuild-on-change keeps one rule per concept; the
rebuild never runs on a poll.
