# 0114 — executable extensions

- **Date:** 2026-11-06
- **Status:** accepted
- **Paths:** `src/web/packages/extension-api/src/protocol.ts`
  `src/web/packages/extension-api/src/manifest.ts`
  `src/web/packages/extension-api/src/consent.ts`
  `src/web/packages/host/src/extensions/runtime/plugin-host.ts`
  `src/web/packages/host/src/extensions/runtime/supervisor.ts`
  `src/web/packages/host/src/extensions/runtime/host-api.ts`
  `src/web/packages/host/src/extensions/runtime/network.ts`
  `src/web/packages/host/src/extensions/runtime/scoped-stores.ts`
  `src/web/packages/host/src/extensions/providers.ts`
  `src/web/packages/host/src/extensions/provider-order.ts`
  `src/web/packages/host/src/extensions/asset-sources.ts`
  `src/web/packages/host/src/extensions/declarative-contributions.ts`
  `src/web/packages/host/src/extensions/declarative-sources.ts`
  `src/web/packages/host/src/assets/source.ts`
  `src/web/packages/host/src/providers/custom/fetch-source.ts`
  `src/web/packages/host/src/main.ts`
  `src/web/packages/host/vite.config.ts`

## Problem

A trusted-worker plugin contributes sensor providers and code asset sources, so
arbitrary plugin code must run. The quiet failure is authority: if the child
owns the provider registry, credentials, network policy or the host API table, a
plugin sees more than its consent grants; if it runs in the host process, a hang
or crash takes the dashboard with it. The boundary must execute plugin code
without moving any authority out of the host.

## Rung 1 — internal owner

Searched: `ProviderRegistry` (`providers/registry.ts`), the `AssetSource` port
(`assets/source.ts`), `fetchSource` and its `pluginContributed` flag
(`providers/custom/fetch-source.ts`), `createSecretStore`
(`settings/secret-store.ts`), `createJsonFile` (`settings/json-file.ts`), and
the extension core from 0112 (`install.ts`, `consent-store.ts`, `service.ts`).
Found: the registries, the pinned SSRF-guarded fetch that refuses private
origins for plugin rows, the OS-wrapped secret store and the atomic JSON stores
already exist. Nothing executes plugin code, and no scoped store or
host-mediated network call exists for a child. Those are the only new
mechanisms. The guarded-fetch claim is
`src/web/packages/host/src/providers/custom/fetch-source.ts`, not the plan's
`src/web/packages/host/src/assets/fetch-source.ts`: the latter does not exist,
and the former is the existing policy owner.

## Rung 2 — installed dependencies

Searched: `packages/host/package.json` runtime dependencies, the
`@yunari/extension-api` package, and `fetch-source.ts`'s fetch/pinning path.
Found: no installed dependency provides process isolation or IPC. Node's
`child_process.fork` and its IPC channel are built in, so no runtime dependency
is added. `@yunari/extension-api` already owns the manifest, capability list and
host API table (0112), and `fetchSource` already carries redirect handling,
DNS pinning and the private-origin refusal a mediated fetch needs.

## Rung 3 — native platform

Searched: Node's `child_process.fork`, IPC `send`/`message`, `disconnect`,
`kill`, and `stdio` options; Node's permission model.
Found: `fork` gives a separate process with a serialized message channel, so
plugin memory cannot alias host state and exit is observable. Node supplies
transport and liveness only: it has no per-process capability sandbox, so every
gate, credential read and outbound request must still be enforced by the parent.

## Rung 4 — public solutions

Compared from prior knowledge: Orca's forked worker and host API (the runtime
hosting this worktree), VS Code's extension-host process split, and the
`worker_threads` alternative. No live documentation or source was fetched.
Found: Orca forks a generic worker entry per task and talks to it over a parent-
owned API; VS Code runs extensions in a separate host process behind an RPC
surface. Both keep the authority and API table in the parent, which is the shape
that fits a plugin that must not own the registry or credentials.
`worker_threads` isolates execution but shares the process and heap, so it does
not contain a native fault or a runaway plugin.

## Rung 5 — integration comparison

| Option | Fit | Unsolved work | Verdict |
|---|---|---|---|
| Import plugin `main` in the host | Full access to every owner | Consent and crash containment impossible | Rejected |
| `worker_threads` | Shares process and heap; no fault containment | Authority still in-process | Rejected |
| `fork` the plugin's own entry as dispatcher | Process boundary, but each plugin re-implements host API, stores and network | Duplicate authority per plugin | Rejected |
| `fork` a generic child entry; parent dispatcher | Child runs only plugin code; one gate, one fetch path, one store owner | IPC protocol, supervisor restart/timeout, a second Vite entry | Chosen |

The chosen split keeps Yunari's existing seams intact: `ProviderRegistry` and
the asset-source port stay in the parent and receive plugin results, the parent
dispatcher reuses the fetch policy owned by `providers/custom/fetch-source.ts`
through `runtime/network.ts` and `createJsonFile` / `createSecretStore` for
scoped stores, and consent from 0112 is checked before each call. The child
learns no settings path and holds no credential. A plugin-contributed
declarative source may not name a host credential (`requires`/`request.auth`):
the credential would travel to a host the manifest chose, and the spec keeps
host credentials out of plugins.

## Rung 6 — smallest probe

Forked a temp `main.js` from a directory outside the repo with
`stdio: ["ignore","ignore","ignore","ipc"]`, sent `{type:"sample"}` over IPC,
and received one `{sensor, value, at}` sample. Exit `0`. This settles that a
generic child entry can be forked, answers a typed request and exits under host
control without any additional dependency.

## Decision

Fork a generic child entry (`plugin-host.ts`); keep every authority in the
parent dispatcher (`supervisor.ts`, `host-api.ts`, `network.ts`,
`scoped-stores.ts`). One child per trusted-worker plugin, results fed into the
existing provider and asset-source owners. The rejected options either move
authority into the plugin or cannot contain a fault; neither fits the capability
gate and consent model in 0112.
