# Executable Extensions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run trusted-worker plugins in a forked Node process, expose only host-mediated network, storage, secrets, and settings, and feed plugin sensor providers and code asset sources through the existing registries.

**Architecture:** A generic child entry imports the plugin's `main` and speaks one versioned RPC protocol over the fork's IPC channel. The parent supervises the child, rechecks every host call through `gateExtensionCall`, and adapts plugin calls to `SensorProvider` and `AssetSource`. A plugin crash or timeout removes only that plugin's rows.

**Tech Stack:** Node `child_process.fork`, `worker` IPC, `node:crypto`, `node:fs/promises`, existing `undici` fetch path, Vitest. No new runtime dependency.

**Spec:** `docs/superpowers/specs/2026-11-06-extension-platform-design.md`

**Prerequisite:** `2026-11-06-extension-core.md`.

## Global Constraints

- `pluginApi` major `1` is additive. A host refuses newer parameters instead of ignoring them.
- Every host call is rechecked in the host process. Worker-side grants are early refusal only.
- Network access uses the existing SSRF guard, the manifest's declared HTTPS hosts, and the existing redirect re-check.
- Storage, secrets, and settings are plugin-scoped. No plugin reaches another plugin's files or the host credential store.
- Invalid numbers are refused, never coerced to zero. A provider `non-ok` reading stays `non-ok`.
- A failing plugin does not blank another provider or another asset source.
- No plugin code runs before validation and consent. A killed or stale-consent plugin does not start.
- Run every npm command from `src/web/`. `npm run gate` must exit 0 without network access.

## Review Focus

- A plugin worker that sends malformed JSON, an unknown method, or a method its surface cannot call: it must be stopped or refused without taking the host down.
- A plugin that returns `NaN`, `Infinity`, a string where a number belongs, or a missing semantic key: the host refuses that entry and records a failure; no zero is fabricated.
- A `network.fetch` to a private address, a non-declared host, or an HTTPS URL that redirects to a private address: refused before dialling and re-checked on every hop.
- A plugin that writes outside its storage key, uses a path separator, or reads another plugin's secret: refused.
- A plugin that crashes mid-sample or mid-search: the registry reports one failure and the next poll still reaches the built-ins.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/web/packages/extension-api/src/protocol.ts` | Host-to-plugin and plugin-to-host message shapes, method names, and readers. |
| `src/web/packages/extension-api/src/manifest.ts` | `networkHosts` declaration and validation. |
| `src/web/packages/extension-api/src/consent.ts` | Hosts in the consent binding and access growth. |
| `src/web/packages/host/src/extensions/runtime/plugin-host.ts` | Child entry: import the plugin, handshake, gate worker-side, dispatch calls. |
| `src/web/packages/host/src/extensions/runtime/supervisor.ts` | Fork, handshake, request timeout, crash detection, stop. |
| `src/web/packages/host/src/extensions/runtime/host-api.ts` | Host dispatcher for network, storage, secrets, settings, and log. |
| `src/web/packages/host/src/extensions/runtime/network.ts` | Declared-host fetch over the existing SSRF guard. |
| `src/web/packages/host/src/extensions/runtime/scoped-stores.ts` | Plugin storage, secrets, and settings directories. |
| `src/web/packages/host/src/extensions/providers.ts` | `PluginSensorProvider`. |
| `src/web/packages/host/src/extensions/asset-sources.ts` | `PluginAssetSource`. |
| `src/web/packages/host/src/extensions/declarative-sources.ts` | Descriptor reader and HTTP adapter for declarative asset sources. |
| `src/web/packages/host/src/assets/source.ts` | `AssetSource.body` becomes an open string; unknown bodies render only with `ui:frame`. |
| `src/web/packages/host/src/assets/fetch-source.ts` | Export `guardedFetch` for the host dispatcher and keep `fetchSource` as a wrapper. |
| `src/web/packages/host/src/main.ts` | Load plugins, build providers and sources, pass registered rows to the server. |
| `src/web/packages/host/vite.config.ts` | Build `main.js` and `plugin-host.js`. |

---

### Task 1: Record the executable-extension reuse decision

**Files:**
- Create: `docs/decisions/0114-executable-extensions.md`

**Interfaces:**
- Consumes: the spec's `Host API`, `Security invariants`, and `Executable providers` sections.
- Produces: exact `Paths:` claims for the runtime and adapters.

- [ ] **Step 1: Write the decision note**

Header:

```markdown
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
  `src/web/packages/host/src/extensions/asset-sources.ts`
  `src/web/packages/host/src/assets/source.ts`
  `src/web/packages/host/src/assets/fetch-source.ts`
  `src/web/packages/host/src/main.ts`
  `src/web/packages/host/vite.config.ts`
```

Rungs: existing `ProviderRegistry`, `AssetSource`, `fetchSource`, `createSecretStore`, and `createJsonFile` are the owners; Node supplies `child_process.fork` and IPC; Orca's forked worker and host API are the public prior art; the probe is a real temp plugin `main.js` returning one sample over IPC. Decision: fork a generic child entry, keep all authority in the parent dispatcher.

- [ ] **Step 2: Verify the hook accepts the claims**

```bash
echo '{"tool_input":{"file_path":"src/web/packages/host/src/extensions/runtime/supervisor.ts"}}' | node scripts/reuse-gate.mjs
echo "exit=$?"
```

Expected: `exit=0`.

- [ ] **Step 3: Commit**

```bash
git add docs/decisions/0114-executable-extensions.md
git commit -m "docs(decisions): authorise executable extensions

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 2: Define the worker protocol and declared hosts

**Files:**
- Create: `src/web/packages/extension-api/src/protocol.ts`
- Modify: `src/web/packages/extension-api/src/manifest.ts`
- Modify: `src/web/packages/extension-api/src/consent.ts`
- Modify: `src/web/packages/extension-api/src/index.ts`
- Test: `src/web/packages/extension-api/src/protocol.test.ts`
- Test: `src/web/packages/extension-api/src/manifest.test.ts`
- Test: `src/web/packages/extension-api/src/consent.test.ts`

**Interfaces:**
- Produces:

```ts
export type HostMethod =
  | "init"
  | "describe"
  | "sample"
  | "health"
  | "stop"
  | "asset.search"
  | "asset.bytes";

export type PluginMethod =
  | "network.fetch"
  | "storage.get"
  | "storage.set"
  | "storage.remove"
  | "storage.list"
  | "secrets.get"
  | "secrets.set"
  | "secrets.remove"
  | "settings.get"
  | "settings.set"
  | "log";

export interface HostRequest {
  readonly type: "host.request";
  readonly id: string;
  readonly method: HostMethod;
  readonly params: unknown;
}
export interface PluginRequest {
  readonly type: "plugin.request";
  readonly id: string;
  readonly method: PluginMethod;
  readonly params: unknown;
}
export interface PluginResult {
  readonly type: "plugin.result";
  readonly id: string;
  readonly ok: boolean;
  readonly value?: unknown;
  readonly reason?: string;
}
export interface PluginReady {
  readonly type: "plugin.ready";
  readonly pluginApi: 1;
}
export interface PluginLog {
  readonly type: "plugin.log";
  readonly level: "info" | "warn" | "error";
  readonly message: string;
}

export type HostMessage = HostRequest;
export type PluginMessage = PluginRequest | PluginResult | PluginReady | PluginLog;
export function readPluginMessage(value: unknown): PluginMessage | undefined;
```

`PluginManifest` gains:

```ts
readonly networkHosts?: readonly string[];
```

Rules: at most 16 hosts, each a lowercase DNS name or IPv4 literal with no scheme, path, port, wildcard, or trailing dot. A host must be declared for `network.fetch`. `ConsentBinding` gains `readonly hosts: readonly string[]`; `accessGrowth` reports `host:<name>`.

- [ ] **Step 1: Write the failing tests**

```ts
it("refuses a network host with a scheme or path", () => {
  expect(readPluginManifest({ ...validManifest(), networkHosts: ["https://api.acme.test/v1"] })).toEqual({
    ok: false,
    reason: 'The network host "https://api.acme.test/v1" must be a bare DNS name.',
  });
});

it("reads a plugin request and refuses an unknown message", () => {
  expect(readPluginMessage({ type: "plugin.request", id: "1", method: "network.fetch", params: {} })).toMatchObject({ method: "network.fetch" });
  expect(readPluginMessage({ type: "plugin.request", id: "1", method: "process.spawn", params: {} })).toBeUndefined();
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run packages/extension-api/src/protocol.test.ts packages/extension-api/src/manifest.test.ts packages/extension-api/src/consent.test.ts
```

Expected: FAIL because the protocol and `networkHosts` do not exist.

- [ ] **Step 3: Implement the protocol and host declaration**

Keep every reader total: an unknown `type`, method, or extra key returns `undefined`. Add `networkHosts` to the consent binding's canonical object and to the access-growth comparison.

- [ ] **Step 4: Run the extension-api suite**

```bash
npx vitest run packages/extension-api/src
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/web/packages/extension-api/src
git commit -m "feat(extension-api): define the worker protocol and hosts

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 3: Fork and supervise one plugin process

**Files:**
- Create: `src/web/packages/host/src/extensions/runtime/plugin-host.ts`
- Create: `src/web/packages/host/src/extensions/runtime/supervisor.ts`
- Modify: `src/web/packages/host/vite.config.ts`
- Test: `src/web/packages/host/src/extensions/runtime/supervisor.test.ts`

**Interfaces:**
- Produces:

```ts
export interface PluginSupervisorOptions {
  readonly plugin: InstalledPlugin;
  readonly granted: readonly Capability[];
  readonly consent: ConsentRecord;
  readonly hostApi: HostApiDispatcher;
  readonly workerEntry?: string;
  readonly requestTimeoutMs?: number;
  readonly onCrash?: (reason: string) => void;
}

export interface PluginSupervisor {
  readonly alive: boolean;
  start(): Promise<void>;
  request<T>(method: HostMethod, params: unknown): Promise<T>;
  stop(): Promise<void>;
}
export function createPluginSupervisor(options: PluginSupervisorOptions): PluginSupervisor;
```

Child rules: import `pathToFileURL(join(plugin.directory, manifest.main))`; send `{ type: "plugin.ready", pluginApi: 1 }`; handle `host.request` by calling the exported method named by the protocol; forward plugin calls to the parent; exit non-zero when the plugin module throws during import or a request handler throws twice. Parent rules: `fork(workerEntry, [], { stdio: ["ignore", "pipe", "pipe", "ipc"] })`; one request in flight per id; default timeout 5,000 ms; a timeout rejects that request and marks the supervisor dead; `stop()` is idempotent and waits at most 2,000 ms before `kill`.

Build: `vite.config.ts` builds two entries, `main.js` and `plugin-host.js`, with `build.ssr` and `rollupOptions.input`. `main.ts` resolves the sibling `plugin-host.js` from `import.meta.url`.

- [ ] **Step 1: Write the failing test**

```ts
it("runs a real temp plugin over IPC", async () => {
  const plugin = await writeTempPlugin(`export async function describe() { return [{ sensorId: "x", semanticKey: "cpu.load", label: "Load", tier: "basic" }]; }`);
  const supervisor = createPluginSupervisor({ plugin, granted: ["sensor:provide"], consent: record(), hostApi: fakeHostApi() });
  await supervisor.start();
  expect(await supervisor.request("describe", {})).toEqual([expect.objectContaining({ semanticKey: "cpu.load" })]);
  await supervisor.stop();
});

it("marks the supervisor dead when a request times out", async () => {
  const supervisor = createPluginSupervisor({ plugin: hangingPlugin(), requestTimeoutMs: 20, ... });
  await supervisor.start();
  await expect(supervisor.request("health", {})).rejects.toThrow("did not answer");
  expect(supervisor.alive).toBe(false);
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run packages/host/src/extensions/runtime/supervisor.test.ts
```

Expected: FAIL because the runner does not exist.

- [ ] **Step 3: Implement the child and supervisor**

Use `os.tmpdir()` for the test plugin directory; never write test plugins into the repository. The child does not inherit `process.env` beyond `PATH`; pass only the plugin directory and consent record in the first `init` message. Capture child stderr and include its last 2 KB in the crash reason after redaction.

- [ ] **Step 4: Run the runtime test**

```bash
npx vitest run packages/host/src/extensions/runtime
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/web/packages/host/src/extensions/runtime/plugin-host.ts src/web/packages/host/src/extensions/runtime/supervisor.ts src/web/packages/host/vite.config.ts
git commit -m "feat(host): fork and supervise plugin workers

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 4: Mediate network, storage, secrets, and settings

**Files:**
- Create: `src/web/packages/host/src/extensions/runtime/host-api.ts`
- Create: `src/web/packages/host/src/extensions/runtime/network.ts`
- Create: `src/web/packages/host/src/extensions/runtime/scoped-stores.ts`
- Modify: `src/web/packages/host/src/assets/fetch-source.ts`
- Test: `src/web/packages/host/src/extensions/runtime/host-api.test.ts`
- Test: `src/web/packages/host/src/extensions/runtime/network.test.ts`
- Test: `src/web/packages/host/src/extensions/runtime/scoped-stores.test.ts`

**Interfaces:**
- Produces:

```ts
export interface HostApiDispatcher {
  call(input: {
    readonly plugin: InstalledPlugin;
    readonly consent: ConsentRecord;
    readonly method: string;
    readonly params: unknown;
  }): Promise<unknown>;
}

export interface GuardedFetchOptions {
  readonly url: string;
  readonly allowedHosts: readonly string[];
  readonly headers?: Readonly<Record<string, string>>;
  readonly signal: AbortSignal;
  readonly maxBytes: number;
  readonly fetchImpl?: typeof fetch;
}
export function guardedFetch(options: GuardedFetchOptions): Promise<FetchOutcome>;

export interface ScopedStores {
  readonly storage: StorageScope;
  readonly secrets: SecretStore;
  readonly settings: PluginSettingsScope;
}
export function createScopedStores(root: string, plugin: InstalledPlugin): ScopedStores;
```

Rules:

- `host-api.call` rebuilds the `CallContext` from the stored consent and granted set and calls `gateExtensionCall`; a denied call returns `{ ok: false, reason }` and is logged without parameters.
- `network.fetch` params: `{ url, method?: "GET" | "POST", headers?, body? }`. The URL must be HTTPS, the host must be in `networkHosts`, and the existing guard runs on every hop. Body cap 1 MiB. A credential never crosses: the plugin sends its own headers; no host credential is injected.
- `storage.*` keys match `^[A-Za-z0-9._-]{1,128}$`; each value is at most 1 MiB; at most 1,000 files. Root `<settingsDir>/extensions/data/<publisher>/<id>/`.
- `secrets.*` uses `createSecretStore(<settingsDir>/extensions/secrets/<publisher>/<id>)`; names use the storage key grammar.
- `settings.*` reads/writes one JSON object at `<settingsDir>/extensions/settings/<publisher>/<id>.json`, at most 64 KiB; `settings.get` returns the object or `{}`.

- [ ] **Step 1: Write the failing tests**

```ts
it("refuses a host the manifest did not declare", async () => {
  await expect(guardedFetch({ url: "https://evil.test/x", allowedHosts: ["api.acme.test"], signal: new AbortController().signal, maxBytes: 1024 })).resolves.toMatchObject({ ok: false, reason: expect.stringContaining("not declared") });
});

it("refuses a storage key with a separator", async () => {
  const stores = createScopedStores(dir, plugin());
  await expect(stores.storage.set("../escape", "x")).rejects.toThrow("not a storage key");
});

it("denies a call the consent does not grant", async () => {
  const api = createHostApiDispatcher({ ... });
  expect(await api.call({ plugin: plugin(), consent: consentWithout("network:fetch"), method: "network.fetch", params: {} })).toEqual({
    ok: false,
    reason: "missing-capability",
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run packages/host/src/extensions/runtime/host-api.test.ts packages/host/src/extensions/runtime/network.test.ts packages/host/src/extensions/runtime/scoped-stores.test.ts
```

Expected: FAIL because the dispatcher and scoped stores do not exist.

- [ ] **Step 3: Implement the dispatcher and refactor `guardedFetch`**

Move the existing private fetch policy out of `fetchSource` into `guardedFetch`; `fetchSource` calls it with `allowedHosts: [new URL(source.url).hostname]` and the source credential. Keep every existing refusal and test unchanged.

- [ ] **Step 4: Run the runtime and custom-source suites**

```bash
npx vitest run packages/host/src/extensions/runtime packages/host/src/providers/custom
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/web/packages/host/src/extensions/runtime src/web/packages/host/src/assets/fetch-source.ts
git commit -m "feat(host): mediate plugin network and storage

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 5: Adapt plugin sensor providers

**Files:**
- Create: `src/web/packages/host/src/extensions/providers.ts`
- Create: `src/web/packages/host/src/extensions/provider-order.ts`
- Modify: `src/web/packages/host/src/providers/registry.ts`
- Modify: `src/web/packages/host/src/extensions/service.ts`
- Modify: `src/web/packages/host/src/server/extension-routes.ts`
- Modify: `src/web/packages/host/src/main.ts`
- Test: `src/web/packages/host/src/extensions/providers.test.ts`
- Test: `src/web/packages/host/src/providers/registry.test.ts`
- Test: `src/web/packages/host/src/server/extension-routes.test.ts`

**Interfaces:**
- Produces:

```ts
export class PluginSensorProvider implements SensorProvider {
  readonly id: string;
  readonly label: string;
  constructor(options: {
    readonly plugin: InstalledPlugin;
    readonly supervisor: PluginSupervisor;
    readonly contribution: { readonly id: string; readonly label: string };
  });
  describe(): Promise<readonly SensorDescriptor[]>;
  sample(semanticKeys: readonly string[], nowMs: number, context?: SampleContext): Promise<readonly SampleEntry[]>;
  health(): ProviderHealth;
}

export interface ProviderOrder {
  readonly version: 1;
  readonly pluginOrder: readonly string[];
}
export function readProviderOrder(value: unknown): ProviderOrder;
export function orderProviders(
  builtins: readonly SensorProvider[],
  plugins: readonly SensorProvider[],
  order: ProviderOrder,
): readonly SensorProvider[];
export function createProviderOrderStore(file: string): {
  read(): Promise<ProviderOrder>;
  write(order: ProviderOrder): Promise<void>;
};
```

Rules: `sample` passes only the requested keys; `health` is a cache read updated by the last `health` call, so a display poll never spawns a second request. Every returned descriptor is validated: non-empty `sensorId`, `semanticKey`, `label`, a known `tier`, and an optional numeric `unitKind` that the vocabulary declares. Every `SampleEntry` is validated: known `semanticKey`, and a number value that is finite; an invalid entry becomes a provider failure, never zero. `orderProviders` keeps built-ins first and orders plugin rows by the stored key list; an unknown key sorts last and is ignored. `ExtensionService` gains `readProviderOrder()` and `writeProviderOrder(order)`, whose keys must all be installed plugin provider keys; the routes are `GET` and `PUT /api/extensions/provider-order`, loopback-only and origin-checked.

- [ ] **Step 1: Write the failing tests**

```ts
it("keeps a built-in answering when a plugin provider fails", async () => {
  const registry = new ProviderRegistry([builtin(), new PluginSensorProvider({ plugin: plugin(), supervisor: failingSupervisor(), contribution: { id: "acme", label: "Acme" } })]);
  const cycle = await registry.sample(["cpu.load"], 0);
  expect(cycle.entries).toContainEqual(expect.objectContaining({ semanticKey: "cpu.load", status: "ok" }));
  expect(cycle.failures).toEqual([expect.objectContaining({ providerId: "acme" })]);
});

it("refuses NaN instead of writing zero", async () => {
  const entries = await providerReturning({ semanticKey: "cpu.load", value: Number.NaN }).sample(["cpu.load"], 0);
  expect(entries).toEqual([expect.objectContaining({ status: "unavailable" })]);
  expect(entries[0]?.value).not.toBe(0);
});

it("refuses a provider order naming an uninstalled plugin", async () => {
  expect(await service.writeProviderOrder({ version: 1, pluginOrder: ["local/gone"] })).toEqual({
    ok: false,
    message: 'No installed extension provides the provider "local/gone".',
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run packages/host/src/extensions/providers.test.ts packages/host/src/providers/registry.test.ts
```

Expected: FAIL because the adapter does not exist.

- [ ] **Step 3: Implement the provider adapter and ordering**

Start supervisors only for installed, consented, non-killed trusted-worker plugins. A failed start reports one failure and leaves the other providers in the registry. `main.ts` awaits the plugin list before constructing `ProviderRegistry`. Store the order in `<settingsDir>/extensions/provider-order.json` and apply it when the registry is built.

- [ ] **Step 4: Run the provider suites**

```bash
npx vitest run packages/host/src/extensions/providers.test.ts packages/host/src/providers
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/web/packages/host/src/extensions/providers.ts src/web/packages/host/src/extensions/provider-order.ts src/web/packages/host/src/extensions/service.ts src/web/packages/host/src/server/extension-routes.ts src/web/packages/host/src/providers/registry.ts src/web/packages/host/src/main.ts
git commit -m "feat(host): sample through plugin providers

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 6: Adapt plugin code asset sources

**Files:**
- Create: `src/web/packages/host/src/extensions/asset-sources.ts`
- Modify: `src/web/packages/host/src/assets/source.ts`
- Modify: `src/web/packages/host/src/assets/sources.ts`
- Modify: `src/web/packages/host/src/server.ts`
- Modify: `src/web/packages/host/src/main.ts`
- Test: `src/web/packages/host/src/extensions/asset-sources.test.ts`
- Test: `src/web/packages/host/src/assets/routes.test.ts`

**Interfaces:**
- Produces:

```ts
export interface CodeAssetSourceContribution {
  readonly id: string;
  readonly label: string;
  readonly category: string;
  readonly body: string;
  readonly requires?: string;
  readonly presetKind?: PresetKind;
  readonly host?: string;
  readonly entry: "code";
}

export class PluginAssetSource implements AssetSource {
  constructor(options: {
    readonly plugin: InstalledPlugin;
    readonly supervisor: PluginSupervisor;
    readonly contribution: CodeAssetSourceContribution;
  });
}

export function createAssetSources(
  builtins: readonly AssetSource[],
  plugins: readonly AssetSource[],
): readonly AssetSource[];
```

Rules: plugin `search` receives `{ query, page }` and returns the existing `SearchPage` shape (`{ results, totalPages }`); the host validates every `AssetResult` and prefixes ids with `<source>:`. `bytesOf` returns `{ bytes, contentType, filename }`, cap 32 MiB, and a non-empty filename. A plugin that returns a malformed page records a `failed` page, not an empty success. Plugin sources cannot shadow a built-in id.

- [ ] **Step 1: Write the failing tests**

```ts
it("prefixes plugin result ids and keeps the page shape", async () => {
  const source = new PluginAssetSource({ plugin: plugin(), supervisor: returning({ results: [result("a")], totalPages: 2 }), contribution: codeContribution() });
  expect(await source.search("x", 1, context())).toEqual({
    results: [expect.objectContaining({ id: "plugin-source:a" })],
    totalPages: 2,
  });
});

it("refuses a plugin source whose id shadows a built-in", () => {
  expect(() => createAssetSources([builtin("unsplash")], [pluginSource("unsplash")])).toThrow('"unsplash" is already an asset source');
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run packages/host/src/extensions/asset-sources.test.ts packages/host/src/assets/routes.test.ts
```

Expected: FAIL because the adapter does not exist.

- [ ] **Step 3: Implement the asset-source adapter**

`server.ts` passes `createAssetSources(ASSET_SOURCES, pluginSources)` to `AssetRouteOptions.sources`. The existing `/api/assets/sources` listing then includes plugin rows; the editor's generic grid already renders them.

- [ ] **Step 4: Run the asset suites**

```bash
npx vitest run packages/host/src/extensions/asset-sources.test.ts packages/host/src/assets
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/web/packages/host/src/extensions/asset-sources.ts src/web/packages/host/src/assets/sources.ts src/web/packages/host/src/server.ts src/web/packages/host/src/main.ts
git commit -m "feat(host): search through plugin asset sources

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 7: Adapt declarative asset sources

**Files:**
- Create: `src/web/packages/host/src/extensions/declarative-sources.ts`
- Modify: `src/web/packages/host/src/assets/sources.ts`
- Modify: `src/web/packages/host/src/extensions/asset-sources.ts`
- Modify: `src/web/packages/host/src/extensions/service.ts`
- Modify: `src/web/packages/host/src/main.ts`
- Test: `src/web/packages/host/src/extensions/declarative-sources.test.ts`
- Test: `src/web/packages/host/src/assets/sources.test.ts`

**Interfaces:**
- Produces:

```ts
export interface DeclarativeAssetSource {
  readonly id: string;
  readonly label: string;
  readonly category: string;
  readonly body: "grid";
  readonly requires?: string;
  readonly presetKind?: PresetKind;
  readonly host: string;
  readonly request: {
    readonly url: string;
    readonly headers?: Readonly<Record<string, string>>;
    readonly pageParam?: string;
    readonly firstPage?: number;
    readonly totalPath?: string;
  };
  readonly result: {
    readonly itemsPath: string;
    readonly id: string;
    readonly name: string;
    readonly preview?: string;
    readonly subtitle?: string;
    readonly kind?: string;
    readonly licence?: string;
    readonly sourceUrl?: string;
  };
}
export function readDeclarativeAssetSource(value: unknown):
  | { readonly ok: true; readonly source: DeclarativeAssetSource }
  | { readonly ok: false; readonly message: string };
export function declarativeAssetSources(
  extensions: readonly InstalledExtension[],
): readonly DeclarativeAssetSource[];
export class DeclarativeAssetSourceAdapter implements AssetSource {
  constructor(options: {
    readonly plugin: InstalledExtension;
    readonly contribution: DeclarativeAssetSource;
  });
}
```

Rules: only `https:` URLs; a URL with userinfo is refused. `request.url` may contain `{query}` and, when `pageParam` is set, `{page}`; a missing placeholder is filled by appending query parameters. `requires` names the existing credential; `auth` inserts its value as a header or query parameter, and the value never appears in a result. `itemsPath` and each field pointer resolve with an own-property JSON pointer; a missing item field is a failed page, not an empty string. Results are mapped to the existing `AssetResult`; the id is the result's own id without the source prefix (the host adds `<source>:` as it already does). `bytesOf` fetches the result's `sourceUrl` through the same guard with the 32 MiB cap. An extension may contribute at most 20 declarative sources, and a source id may not shadow a built-in.

- [ ] **Step 1: Write the failing tests**

```ts
it("maps an item and follows the page parameter", async () => {
  const source = new DeclarativeAssetSourceAdapter({
    plugin: installed(),
    contribution: declarativeSource({ request: { url: "https://api.acme.test/search?q={query}&page={page}", pageParam: "page", firstPage: 1 }, result: { itemsPath: "/items", id: "/id", name: "/name", preview: "/thumb" } }),
  });
  expect(await source.search("glass", 2, context())).toEqual({
    results: [{ id: "r1", name: "Glass", preview: "https://cdn.acme.test/r1.png", kind: "unknown", subtitle: undefined, licence: "unknown", sourceUrl: "https://api.acme.test/items/r1" }],
    totalPages: 3,
  });
});

it("refuses a plain-http source and a userinfo URL", () => {
  expect(readDeclarativeAssetSource(declarativeSource({ request: { url: "http://api.acme.test" } }))).toEqual({ ok: false, message: "Declarative asset sources must use https." });
  expect(readDeclarativeAssetSource(declarativeSource({ request: { url: "https://user:pass@api.acme.test" } }))).toEqual({ ok: false, message: "A declarative asset source URL may not carry user information." });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run packages/host/src/extensions/declarative-sources.test.ts packages/host/src/assets/sources.test.ts
```

Expected: FAIL because declarative asset sources do not exist.

- [ ] **Step 3: Implement the reader and adapter**

Parse the contribution once at load; a bad contribution disables only that source with a stated failure. `search` runs through the existing `guardedFetch` and per-source timeout, never through a plugin supervisor. Add the adapters to `createAssetSources(builtins, plugins)` after the built-in rows.

- [ ] **Step 4: Run the asset-source suites**

```bash
npx vitest run packages/host/src/extensions/declarative-sources.test.ts packages/host/src/assets/sources.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/web/packages/host/src/extensions/declarative-sources.ts src/web/packages/host/src/assets/sources.ts src/web/packages/host/src/extensions/asset-sources.ts src/web/packages/host/src/extensions/service.ts src/web/packages/host/src/main.ts
git commit -m "feat(host): search declarative asset sources

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 8: Document execution and run the gate

**Files:**
- Modify: `docs/architecture.md`
- Modify: `docs/operations.md`

- [ ] **Step 1: Update the docs**

State the fork, the host-mediated authority, the per-plugin scopes, the failure isolation, and that a plugin never receives a host credential.

- [ ] **Step 2: Run the gate**

```bash
cd src/web
npm run gate
echo "exit=$?"
```

Expected: `exit=0`.

- [ ] **Step 3: Commit**

```bash
git add docs/architecture.md docs/operations.md
git commit -m "docs: describe executable extensions

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```
