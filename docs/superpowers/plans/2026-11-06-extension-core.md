# Extension Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the shared extension ABI, deny-by-default capability gate, consent binding, local plugin install, and declarative contribution loading that every later plan builds on.

**Architecture:** A new pure `@yunari/extension-api` package owns the manifest, execution profiles, capability vocabulary, host API table, gate, and consent fingerprint. The host owns installed plugin trees, the consent file, and loopback-only management routes. Declarative contributions feed existing registries; no plugin code runs in this plan.

**Tech Stack:** TypeScript, Node `fs/promises` and `node:crypto`, Web Crypto `subtle.digest` in the shared package, `fflate` through `@yunari/theme-package`, Vitest. No new runtime dependency.

**Spec:** `docs/superpowers/specs/2026-11-06-extension-platform-design.md`

## Global Constraints

- `manifestVersion` is `1`; `pluginApi` is `1`; unknown manifest keys are refused, not ignored.
- Capabilities are the closed ten: `sensor:provide`, `asset:provide`, `panel:drive`, `network:fetch`, `storage:own`, `secrets:own`, `settings:own`, `ui:frame`, `usb:device`, `serial:device`.
- Execution profiles are `data`, `declarative`, `sandboxed-ui`, `trusted-worker`; a manifest may declare a higher profile than its contributions require, never lower.
- A missing method, wrong surface, null consent, or missing capability denies. An empty capability set is trusted and grants nothing.
- Consent is keyed by the qualified plugin key `publisher/id`, never the bare id. The fingerprint is a binding digest, not a signature.
- Local installs use publisher `local`. Reserved publishers are `yunari`, `official`, and any `yunari` prefix.
- Plugin management routes are loopback-only and origin-checked. No plugin code executes before validation and consent.
- Credentials stay in the host. A plugin receives only its own secrets.
- Run every npm command from `src/web/`. `npm run gate` must exit 0 without network access.

## Review Focus

- A manifest with an unknown key, unknown capability, or lower execution profile than its contribution requires: refused with the offending key or rule named.
- A call from a worker to a frame-only method, or with stale or missing consent: denied, even when the plugin holds the capability.
- A plugin package with `../`, an absolute path, a symlink-like entry, or an entry outside the declared file set: refused before any directory is created.
- A local reinstall of edited code under the same approval: allowed only while the binding digest is unchanged; any access growth requires a fresh consent record.
- A declarative asset category whose id collides with a built-in: refused, and the built-in order and labels are unchanged.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/web/packages/extension-api/src/manifest.ts` | Manifest schema, strict unknown-key validation, execution rules, reserved names. |
| `src/web/packages/extension-api/src/capabilities.ts` | Closed capability list and descriptions. |
| `src/web/packages/extension-api/src/host-api.ts` | Host API method table with surface, scope, `since`, parameter and result readers. |
| `src/web/packages/extension-api/src/gate.ts` | `gateExtensionCall`, deny-by-default. |
| `src/web/packages/extension-api/src/consent.ts` | Canonical JSON, binding digest, consent record, access growth. |
| `src/web/packages/extension-api/src/installed.ts` | The wire shape the host serves and the editor reads. |
| `src/web/packages/extension-api/src/index.ts` | One public surface. |
| `src/web/packages/extension-api/src/package.ts` | Plugin zip reader and path safety, shared with the store Worker. |
| `src/web/packages/host/src/extensions/content-hash.ts` | Stable install-tree digest. |
| `src/web/packages/host/src/extensions/install.ts` | Validate, write, list, remove local plugin trees. |
| `src/web/packages/host/src/extensions/consent-store.ts` | Consent file under the settings directory. |
| `src/web/packages/host/src/extensions/service.ts` | Installed extensions, consent checks, declarative contributions. |
| `src/web/packages/host/src/server/extension-routes.ts` | Loopback-only management routes. |
| `src/web/packages/renderer-core/src/assets/wire.ts` | Open category ids with built-in ordering. |
| `src/web/packages/editor/src/asset-finder/finder-model.ts` | Dynamic category views and generic grid fallback. |

---

### Task 1: Record the extension-core reuse decision

**Files:**
- Create: `docs/decisions/0112-extension-core.md`

**Interfaces:**
- Consumes: the spec's `Extension model` and `Security invariants` sections.
- Produces: exact `Paths:` claims for the new package and host extension files.

- [ ] **Step 1: Write the decision note**

Use `docs/decisions/README.md`. Header:

```markdown
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
```

Rungs: Orca's manifest and gate are the public prior art; Yunari already has the registries and route guards; Node supplies `fs` and `crypto`; the probe is a local package with an unknown capability being refused. Decision: build the pure ABI in one shared package and keep execution out until Plan 4.

- [ ] **Step 2: Verify the hook accepts the claims**

```bash
echo '{"tool_input":{"file_path":"src/web/packages/extension-api/src/manifest.ts"}}' | node scripts/reuse-gate.mjs
echo "exit=$?"
```

Expected: `exit=0`.

- [ ] **Step 3: Commit**

```bash
git add docs/decisions/0112-extension-core.md
git commit -m "docs(decisions): authorise the extension core

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 2: Create the shared ABI package and manifest validator

**Files:**
- Create: `src/web/packages/extension-api/package.json`
- Create: `src/web/packages/extension-api/tsconfig.json`
- Create: `src/web/packages/extension-api/src/capabilities.ts`
- Create: `src/web/packages/extension-api/src/manifest.ts`
- Create: `src/web/packages/extension-api/src/installed.ts`
- Create: `src/web/packages/extension-api/src/index.ts`
- Modify: `src/web/package.json`
- Test: `src/web/packages/extension-api/src/manifest.test.ts`

**Interfaces:**
- Produces:

```ts
export const MANIFEST_VERSION = 1;
export const PLUGIN_API_MAJOR = 1;
export const PLUGIN_MANIFEST_MEMBER = "yunari-plugin.json";

export type ExecutionProfile =
  | "data"
  | "declarative"
  | "sandboxed-ui"
  | "trusted-worker";

export type Capability =
  | "sensor:provide"
  | "asset:provide"
  | "panel:drive"
  | "network:fetch"
  | "storage:own"
  | "secrets:own"
  | "settings:own"
  | "ui:frame"
  | "usb:device"
  | "serial:device";

export interface PluginContributions {
  readonly sensorProviders?: readonly { readonly id: string; readonly label: string }[];
  readonly assetCategories?: readonly {
    readonly id: string;
    readonly label: string;
    readonly icon: string;
    readonly resultKind: string;
    readonly body: "grid";
  }[];
  readonly assetSources?: readonly Readonly<Record<string, unknown>>[];
  readonly panelFamilies?: readonly {
    readonly id: string;
    readonly label: string;
    readonly vendorId: number;
    readonly productId: number;
    readonly geometry: { readonly width: number; readonly height: number };
    readonly support: {
      readonly maker: string;
      readonly hardwareRevision: string;
      readonly supportedFirmware: readonly string[];
      readonly updatedAt: string;
    };
    readonly commands: readonly string[];
    readonly renderModes?: readonly string[];
  }[];
  readonly settingsPages?: readonly {
    readonly id: string;
    readonly label: string;
    readonly section?: string;
    readonly fields?: readonly Readonly<Record<string, unknown>>[];
    readonly ui?: string;
  }[];
  readonly customSources?: readonly Readonly<Record<string, unknown>>[];
}

export interface PluginManifest {
  readonly manifestVersion: 1;
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly description: string;
  readonly engines: { readonly yunari: string };
  readonly pluginApi: 1;
  readonly execution: ExecutionProfile;
  readonly capabilities: readonly Capability[];
  readonly contributes: PluginContributions;
  readonly main?: string;
  readonly ui?: string;
  readonly publisher?: string;
}

export type ManifestResult =
  | { readonly ok: true; readonly manifest: PluginManifest }
  | { readonly ok: false; readonly reason: string };

export function readPluginManifest(value: unknown): ManifestResult;
export function requiredExecution(manifest: PluginManifest): ExecutionProfile;
export function validateManifestExecution(manifest: PluginManifest): ManifestResult;
export function qualifiedPluginKey(publisher: string, id: string): string;
export function isReservedPublisher(publisher: string): boolean;

export type ConsentState = "not-required" | "granted" | "missing";
export interface InstalledExtension {
  readonly key: string;
  readonly name: string;
  readonly version: string;
  readonly execution: ExecutionProfile;
  readonly capabilities: readonly Capability[];
  readonly contributions: PluginContributions;
  readonly consent: ConsentState;
  readonly fingerprint: string;
}
```

Validation rules:

- `id` matches `^[a-z0-9]+(?:-[a-z0-9]+)*$`, length 1–64, and does not start with `yunari-`.
- `publisher`, when present, matches the same shape and is not reserved.
- `version` is semver `x.y.z` with optional prerelease/build; `engines.yunari` is `>=x.y.z`.
- `capabilities` has at most 32 entries, no duplicates, and every entry is in the closed set.
- `contributes` is strict and every nested object is strict.
- `main` is required for `trusted-worker`; `ui` is required for `sandboxed-ui`.
- `main` and `ui` are relative paths under the package root, no `..`, no leading `/`.
- `assetCategories` and `assetSources` require `asset:provide`; `settingsPages` requires `settings:own`; `sensorProviders` requires `sensor:provide`; `panelFamilies` requires `panel:drive`.
- `requiredExecution` returns the highest profile any contribution requires: `sensorProviders` and `panelFamilies` -> `trusted-worker`; custom asset bodies or sandboxed settings -> `sandboxed-ui`; descriptors and forms -> `declarative`; `validateManifestExecution` refuses a declared profile below it.

- [ ] **Step 1: Write the failing tests**

```ts
it("refuses an unknown capability", () => {
  expect(readPluginManifest({ ...validManifest(), capabilities: ["process:spawn"] })).toEqual({
    ok: false,
    reason: 'Unknown capability "process:spawn".',
  });
});

it("refuses trusted-worker without main", () => {
  const { main: _main, ...rest } = validManifest();
  expect(readPluginManifest(rest)).toEqual({
    ok: false,
    reason: 'A trusted-worker plugin needs "main".',
  });
});

it("refuses a lower profile than the contributions require", () => {
  const manifest = { ...validManifest(), execution: "declarative", contributes: { sensorProviders: [{ id: "acme", label: "Acme" }] } };
  expect(validateManifestExecution(manifest)).toEqual({
    ok: false,
    reason: 'The sensorProviders contribution requires "trusted-worker", but the manifest declares "declarative".',
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run packages/extension-api/src/manifest.test.ts
```

Expected: FAIL because the package does not exist.

- [ ] **Step 3: Implement the package**

Add `packages/extension-api` to the root `workspaces` list. Use the same tsconfig shape as `theme-package`, with a dependency on `@yunari/theme-package` for `readPackageArchive`. Hand-write the strict readers; no schema library is added.

- [ ] **Step 4: Run the package test**

```bash
npx vitest run packages/extension-api/src/manifest.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/web/package.json src/web/packages/extension-api
git commit -m "feat(extension-api): add the manifest ABI

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 3: Add the host API table and deny-by-default gate

**Files:**
- Create: `src/web/packages/extension-api/src/host-api.ts`
- Create: `src/web/packages/extension-api/src/gate.ts`
- Test: `src/web/packages/extension-api/src/gate.test.ts`

**Interfaces:**
- Produces:

```ts
export type ExtensionSurface = "worker" | "frame";

export interface ReadResult<T> {
  readonly ok: boolean;
  readonly value?: T;
  readonly reason?: string;
}

export interface HostApiMethod {
  readonly capability: Capability | null;
  readonly surfaces: readonly ExtensionSurface[];
  readonly scope: "plugin" | "device";
  readonly since: string;
  readonly readParams: (value: unknown) => ReadResult<unknown>;
  readonly readResult: (value: unknown) => ReadResult<unknown>;
}

export const HOST_API_METHODS: Readonly<Record<string, HostApiMethod>>;

export function hostApiMethod(name: string): HostApiMethod | undefined;

export interface CallContext {
  readonly method: string;
  readonly surface: ExtensionSurface;
  readonly consent: { readonly fingerprint: string } | null;
  readonly granted: readonly Capability[];
}

export type GateReason =
  | "unknown-method"
  | "wrong-surface"
  | "no-consent"
  | "missing-capability";

export type GateDecision =
  | { readonly ok: true; readonly method: HostApiMethod }
  | { readonly ok: false; readonly reason: GateReason; readonly capability?: Capability };

export function gateExtensionCall(context: CallContext): GateDecision;
```

The Plan 2 table contains exactly these methods:

| Method | Capability | Surfaces | Scope | Since |
|---|---|---|---|---|
| `init` | null | worker | plugin | `0.1.0` |
| `describe` | `sensor:provide` | worker | plugin | `0.1.0` |
| `sample` | `sensor:provide` | worker | plugin | `0.1.0` |
| `health` | `sensor:provide` | worker | plugin | `0.1.0` |
| `stop` | null | worker | plugin | `0.1.0` |
| `network.fetch` | `network:fetch` | worker | plugin | `0.1.0` |
| `storage.get` / `storage.set` / `storage.remove` / `storage.list` | `storage:own` | worker | plugin | `0.1.0` |
| `secrets.get` / `secrets.set` / `secrets.remove` | `secrets:own` | worker | plugin | `0.1.0` |
| `settings.get` / `settings.set` | `settings:own` | worker | plugin | `0.1.0` |
| `log` | null | worker, frame | plugin | `0.1.0` |

Later plans add panel, frame, and device methods to this one table.

- [ ] **Step 1: Write the failing tests**

```ts
it("denies an unknown method before consent is considered", () => {
  expect(gateExtensionCall({ method: "process.spawn", surface: "worker", consent: null, granted: [] })).toEqual({
    ok: false,
    reason: "unknown-method",
  });
});

it("denies a frame calling a worker-only method", () => {
  expect(gateExtensionCall({ method: "sample", surface: "frame", consent: consent(), granted: ["sensor:provide"] })).toEqual({
    ok: false,
    reason: "wrong-surface",
  });
});

it("allows a consented worker with the capability", () => {
  expect(gateExtensionCall({ method: "network.fetch", surface: "worker", consent: consent(), granted: ["network:fetch"] })).toMatchObject({ ok: true });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run packages/extension-api/src/gate.test.ts
```

Expected: FAIL because the table and gate do not exist.

- [ ] **Step 3: Implement the table and gate**

The gate checks in order: method present, surface allowed, non-null consent, capability granted. A method with `capability: null` still requires consent. Keep the method name list exhaustive by typing `HOST_API_METHODS` as `Record<HostApiMethodName, HostApiMethod>`.

- [ ] **Step 4: Run the gate test**

```bash
npx vitest run packages/extension-api/src/gate.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/web/packages/extension-api/src/host-api.ts src/web/packages/extension-api/src/gate.ts src/web/packages/extension-api/src/gate.test.ts
git commit -m "feat(extension-api): gate every host call

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 4: Bind consent to content, access, and publisher

**Files:**
- Create: `src/web/packages/extension-api/src/consent.ts`
- Create: `src/web/packages/host/src/extensions/consent-store.ts`
- Test: `src/web/packages/extension-api/src/consent.test.ts`
- Test: `src/web/packages/host/src/extensions/consent-store.test.ts`

**Interfaces:**
- Produces:

```ts
export const CONSENT_SCHEMA_TAG = "yunari-extension-consent-v1";

export interface ConsentBinding {
  readonly schemaTag: typeof CONSENT_SCHEMA_TAG;
  readonly pluginApi: 1;
  readonly pluginKey: string;
  readonly version: string;
  readonly contentHash: string;
  readonly execution: ExecutionProfile;
  readonly capabilities: readonly Capability[];
  readonly contributions: readonly string[];
  readonly devices: readonly string[];
}

export async function consentFingerprint(binding: ConsentBinding): Promise<string>;

export interface ConsentRecord {
  readonly pluginKey: string;
  readonly version: string;
  readonly fingerprint: string;
  readonly grantedAt: string;
}

export interface ConsentFile {
  readonly version: 1;
  readonly plugins: Readonly<Record<string, ConsentRecord>>;
}

export function consentRequired(execution: ExecutionProfile): boolean;
export function consentMatches(record: ConsentRecord | undefined, fingerprint: string): boolean;
export function accessGrowth(previous: ConsentBinding, next: ConsentBinding): readonly string[];

export interface ConsentStore {
  read(): Promise<ConsentFile>;
  grant(record: ConsentRecord): Promise<ConsentFile>;
  revoke(pluginKey: string): Promise<ConsentFile>;
}
export function createConsentStore(directory: string): ConsentStore;
```

Rules: canonical JSON sorts object keys recursively and preserves array order after sorting the binding's capability, contribution, and device lists. The digest is `yc1-` plus lowercase hex SHA-256. `consentRequired` is false for `data` and `declarative`, true for the two executable profiles. `accessGrowth` reports `profile`, `capability:<name>`, `contribution:<identity>`, `device:<id>`, and `publisher` when the qualified key's publisher changes.

- [ ] **Step 1: Write the failing tests**

```ts
it("is stable across key order and list order", async () => {
  expect(await consentFingerprint({ ...binding(), capabilities: ["network:fetch", "storage:own"] })).toBe(
    await consentFingerprint({ ...binding(), capabilities: ["storage:own", "network:fetch"] }),
  );
});

it("changes when a device is added", async () => {
  expect(await consentFingerprint(binding())).not.toBe(
    await consentFingerprint({ ...binding(), devices: ["usb:1cbe:a092"] }),
  );
});

it("reports access growth", () => {
  expect(accessGrowth(binding(), { ...binding(), capabilities: ["network:fetch", "storage:own"] })).toEqual(["capability:storage:own"]);
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run packages/extension-api/src/consent.test.ts packages/host/src/extensions/consent-store.test.ts
```

Expected: FAIL because the binding and store do not exist.

- [ ] **Step 3: Implement consent**

Use `crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonicalJson(binding)))`. The store uses `createJsonFile<ConsentFile>(directory, "extension-consent.json", ...)` and writes `grantedAt` from the caller so tests are deterministic.

- [ ] **Step 4: Run the consent tests**

```bash
npx vitest run packages/extension-api/src/consent.test.ts packages/host/src/extensions/consent-store.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/web/packages/extension-api/src/consent.ts src/web/packages/host/src/extensions/consent-store.ts src/web/packages/extension-api/src/consent.test.ts src/web/packages/host/src/extensions/consent-store.test.ts
git commit -m "feat(extension-api): bind consent to the install tree

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 5: Read and install a local plugin package safely

**Files:**
- Create: `src/web/packages/extension-api/src/package.ts`
- Modify: `src/web/packages/extension-api/src/index.ts`
- Modify: `src/web/packages/theme-package/src/index.ts` (export `readPackageArchive`)
- Create: `src/web/packages/host/src/extensions/content-hash.ts`
- Create: `src/web/packages/host/src/extensions/install.ts`
- Test: `src/web/packages/extension-api/src/package.test.ts`
- Test: `src/web/packages/host/src/extensions/install.test.ts`

**Interfaces:**
- Consumes: `readPluginManifest`, `validateManifestExecution`; `readPackageArchive` from `@yunari/theme-package`.
- Produces (`package.ts` lives in the shared pure package so the store Worker and the host read the same zip):

```ts
export interface PluginPackage {
  readonly manifest: PluginManifest;
  readonly files: Readonly<Record<string, Uint8Array>>;
}

export function readPluginPackage(bytes: Uint8Array):
  | { readonly ok: true; readonly package: PluginPackage }
  | { readonly ok: false; readonly message: string };

export interface InstalledPlugin {
  readonly key: string;
  readonly publisher: string;
  readonly manifest: PluginManifest;
  readonly directory: string;
  readonly contentHash: string;
}

export interface InstallResult {
  readonly ok: boolean;
  readonly plugin?: InstalledPlugin;
  readonly message?: string;
}

export interface PluginInstaller {
  list(): Promise<readonly InstalledPlugin[]>;
  read(key: string): Promise<InstalledPlugin | undefined>;
  install(bytes: Uint8Array): Promise<InstallResult>;
  remove(key: string): Promise<void>;
}
export function createPluginInstaller(directory: string): PluginInstaller;
```

Package rules: root `yunari-plugin.json` required; entry count at most 512; expanded bytes at most 64 MiB; each path relative, no `..`, no absolute path, no backslash, no NUL, no duplicate name; every file is under the package root; `main`/`ui` must exist in the file set. The install directory is `<settingsDir>/extensions/<publisher>/<id>/<version>`. Write to a sibling temp directory, `fsync`/rename into place, then rewrite `installed.json` atomically. Reinstalling the same version with the same content hash is idempotent; a different hash replaces the version only through the same validated path.

- [ ] **Step 1: Write the failing tests**

```ts
it("refuses a path traversal entry", () => {
  expect(readPluginPackage(zipWith({ "../main.js": "x" }))).toEqual({
    ok: false,
    message: 'Plugin package path "../main.js" is not relative to the package root.',
  });
});

it("installs and removes one plugin tree", async () => {
  const installer = createPluginInstaller(dir);
  const installed = await installer.install(validPluginBytes());
  assert(installed.ok);
  expect((await installer.list()).map((plugin) => plugin.key)).toEqual(["local/acme-sensors"]);
  await installer.remove("local/acme-sensors");
  expect(await installer.list()).toEqual([]);
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run packages/extension-api/src/package.test.ts packages/host/src/extensions/install.test.ts
```

Expected: FAIL because the readers do not exist.

- [ ] **Step 3: Implement the package reader and installer**

`readPackageArchive` already enforces zip central-directory and entry bounds. Add the plugin-specific path and entry checks on top. `contentHash` is SHA-256 over sorted `path NUL sha256(bytes) NUL` lines. `installed.json` stores key, publisher, directory, manifest, and content hash; a missing or unreadable index reads as empty.

- [ ] **Step 4: Run the extension host tests**

```bash
npx vitest run packages/host/src/extensions
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/web/packages/extension-api/src/package.ts src/web/packages/extension-api/src/package.test.ts src/web/packages/extension-api/src/index.ts src/web/packages/theme-package/src/index.ts src/web/packages/host/src/extensions/content-hash.ts src/web/packages/host/src/extensions/install.ts src/web/packages/host/src/extensions/install.test.ts
git commit -m "feat(host): install local plugin packages

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 6: Add the extension service and management routes

**Files:**
- Create: `src/web/packages/host/src/extensions/service.ts`
- Create: `src/web/packages/host/src/server/extension-routes.ts`
- Modify: `src/web/packages/host/src/server/options.ts`
- Modify: `src/web/packages/host/src/server.ts`
- Modify: `src/web/packages/host/src/main.ts`
- Test: `src/web/packages/host/src/extensions/service.test.ts`
- Test: `src/web/packages/host/src/server/extension-routes.test.ts`

**Interfaces:**
- Produces:

```ts
// `InstalledExtension` is imported from `@yunari/extension-api` and re-exported for host callers.
export type { InstalledExtension } from "@yunari/extension-api";

export interface ExtensionService {
  list(): Promise<readonly InstalledExtension[]>;
  install(bytes: Uint8Array): Promise<InstallResult>;
  grantConsent(key: string, fingerprint: string): Promise<{ readonly ok: boolean; readonly message?: string }>;
  remove(key: string): Promise<void>;
  /** False when the plugin is killed, stale, or its consent is missing. */
  mayLoad(key: string): Promise<boolean>;
}
export function createExtensionService(options: {
  readonly installer: PluginInstaller;
  readonly consent: ConsentStore;
  readonly now: () => string;
}): ExtensionService;
```

Routes, all loopback-only and origin-checked:

- `GET /api/extensions` -> `{ extensions: InstalledExtension[] }`.
- `POST /api/extensions/install` -> raw plugin zip, answers `{ ok, plugin }`.
- `POST /api/extensions/:key/consent` -> `{ fingerprint }`, recomputes and stores the record.
- `DELETE /api/extensions/:key` -> removes the tree and revokes consent.

`HostServerOptions` gains `extensions?: ExtensionService`. `main.ts` creates the installer under `<settingsDir>/extensions` and passes the service. `mayLoad` returns false when consent is required and missing; Plan 3 adds the kill list check here.

- [ ] **Step 1: Write the failing tests**

```ts
it("reports missing consent for a trusted-worker plugin", async () => {
  const service = createExtensionService({ installer, consent, now: () => "2026-11-06T00:00:00Z" });
  await service.install(validPluginBytes());
  expect(await service.list()).toEqual([
    expect.objectContaining({ key: "local/acme-sensors", consent: "missing" }),
  ]);
  expect(await service.mayLoad("local/acme-sensors")).toBe(false);
});

it("refuses a consent fingerprint the host did not compute", async () => {
  expect(await service.grantConsent("local/acme-sensors", "yc1-nope")).toEqual({
    ok: false,
    message: "That consent does not match the installed plugin.",
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run packages/host/src/extensions/service.test.ts packages/host/src/server/extension-routes.test.ts
```

Expected: FAIL because the service and routes do not exist.

- [ ] **Step 3: Implement the service and routes**

Resolve the installed plugin, build its `ConsentBinding` from manifest, content hash, qualified key, capabilities, contribution identities, and device allowlists, then compare the submitted fingerprint. The route body limit is 64 MiB; a larger body is 413 before unzip. The browser never sees a plugin file path.

- [ ] **Step 4: Run the host extension and route suites**

```bash
npx vitest run packages/host/src/extensions packages/host/src/server/extension-routes.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/web/packages/host/src/extensions/service.ts src/web/packages/host/src/server/extension-routes.ts src/web/packages/host/src/server/options.ts src/web/packages/host/src/server.ts src/web/packages/host/src/main.ts
git commit -m "feat(host): expose installed extensions and consent

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 7: Open asset categories and register declarative ones

**Files:**
- Modify: `src/web/packages/renderer-core/src/assets/wire.ts`
- Modify: `src/web/packages/editor/package.json`
- Modify: `src/web/packages/editor/src/asset-finder/finder-model.ts`
- Modify: `src/web/packages/editor/src/asset-finder/modal.tsx`
- Modify: `src/web/packages/editor/src/asset-finder/use-tab-searches.ts`
- Modify: `src/web/packages/editor/src/asset-finder/finder-toolbar.tsx`
- Modify: `src/web/packages/editor/src/editor-shell/icons.ts`
- Modify: `src/web/packages/editor/src/ui-copy.ts`
- Modify: `src/web/packages/host/src/assets/sources.ts`
- Modify: `src/web/packages/host/src/extensions/service.ts`
- Test: `src/web/packages/renderer-core/src/assets/wire.test.ts`
- Test: `src/web/packages/editor/src/asset-finder/finder-model.test.ts`
- Test: `src/web/packages/host/src/extensions/service.test.ts`

**Interfaces:**
- Produces:

```ts
export const BUILTIN_SOURCE_CATEGORIES = ["font", "icon", "image", "video", "colour"] as const;
export type BuiltinSourceCategory = (typeof BUILTIN_SOURCE_CATEGORIES)[number];
export type SourceCategory = string;
export const BUILTIN_LISTING_CATEGORIES = [...BUILTIN_SOURCE_CATEGORIES, "local"] as const;
export type BuiltinListingCategory = (typeof BUILTIN_LISTING_CATEGORIES)[number];
export type ListingCategory = string;

export interface DeclarativeCategory {
  readonly id: string;
  readonly label: string;
  readonly icon: string;
  readonly resultKind: string;
  readonly body: "grid";
}
export function declarativeCategories(extensions: readonly InstalledExtension[]): readonly DeclarativeCategory[];
```

Editor rules: `CATEGORY_ORDER` is the built-in order; `emptyViews()` is `Record<string, TabView>`; `bodyOf(category)` returns `"grid"` for every unknown category; tabs append unknown categories from the listing after the built-ins; `FINDER_TAB_GLYPHS` becomes `Readonly<Record<string, LucideIcon>>` with the image glyph as fallback; labels use the built-in copy table and fall back to the category id.

- [ ] **Step 1: Write the failing tests**

```ts
it("keeps built-in order and appends an unknown category", () => {
  expect(categoryTabs({ category: "brand", label: "Brand" }, [])).toEqual([
    ...BUILTIN_LISTING_CATEGORIES,
    "brand",
  ]);
});

it("falls back to the generic grid for an unknown category", () => {
  expect(bodyOf("brand")).toBe("grid");
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run packages/renderer-core/src/assets/wire.test.ts packages/editor/src/asset-finder/finder-model.test.ts packages/host/src/extensions/service.test.ts
```

Expected: FAIL because the category types are closed.

- [ ] **Step 3: Open the unions and update the finder**

Add `@yunari/extension-api` as a workspace dependency of the editor; the types are browser-safe and import no Node built-in. Keep `AssetSource.category` a string. The host's `searchSources` already filters by the requested category. The editor renders an unknown category through the existing grid body; only `font-picker` and `wallpaper-engine` stay special.

- [ ] **Step 4: Run the affected suites**

```bash
npx vitest run packages/renderer-core/src/assets packages/editor/src/asset-finder packages/host/src/extensions
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/web/packages/renderer-core/src/assets/wire.ts src/web/packages/editor/package.json src/web/packages/editor/src/asset-finder src/web/packages/editor/src/editor-shell/icons.ts src/web/packages/editor/src/ui-copy.ts src/web/packages/host/src/assets/sources.ts src/web/packages/host/src/extensions/service.ts
git commit -m "feat: render declarative asset categories

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 8: Feed declarative custom sources and paging

**Files:**
- Modify: `src/web/packages/host/src/settings/sources.ts`
- Modify: `src/web/packages/host/src/providers/custom/provider.ts`
- Modify: `src/web/packages/host/src/providers/custom/fetch-source.ts`
- Modify: `src/web/packages/host/src/main.ts`
- Test: `src/web/packages/host/src/settings/sources.test.ts`
- Test: `src/web/packages/host/src/providers/custom/provider.test.ts`

**Interfaces:**
- Produces:

```ts
export interface CustomSourcePaging {
  readonly pageParam: string;
  readonly firstPage: number;
  readonly maxPages: number;
  /** A JSON pointer to the array on each page, merged before field pointers run. */
  readonly itemsPath?: string;
}
export interface CustomSource {
  // existing fields unchanged
  readonly paging?: CustomSourcePaging;
}
export function readCustomSource(value: unknown):
  | { readonly ok: true; readonly source: CustomSource }
  | { readonly ok: false; readonly message: string };

export interface CustomSourceProviderOptions {
  readonly sources: SourceStore;
  readonly credentials: CredentialStore;
  /** Plugin-contributed rows, read on every reload. */
  readonly extraSources?: () => readonly CustomSource[];
  readonly fetcher?: typeof fetch;
  readonly now?: () => number;
}
```

Rules: `readCustomSource` is the one validator for both `sources.json` and a plugin contribution. `extraSources` rows are merged after the user rows; a duplicate id is refused and the user row keeps precedence. `paging.pageParam` is a non-empty query parameter name; `maxPages` is `1..10`. `fetchSource` appends the page number and fetches each page in order; when `itemsPath` is set, the array at that pointer is concatenated and becomes the root the field pointers read. A page that fails fails the whole source; no partial merge is reported as a complete reading.

- [ ] **Step 1: Write the failing tests**

```ts
it("merges a plugin custom source after the user rows", async () => {
  const provider = new CustomSourceProvider({ sources, credentials, extraSources: () => [pluginSource()] });
  await provider.reload();
  expect(provider.status().map((row) => row.sourceId)).toContain("acme.weather");
});

it("follows two pages and resolves fields against the merged array", async () => {
  const fetcher = pageFetcher([[{ temp: 1 }], [{ temp: 2 }]]);
  const source = customSource({ paging: { pageParam: "page", firstPage: 1, maxPages: 2, itemsPath: "/items" } });
  expect(await fetchSource(source, { fetcher, credential: () => undefined, signal: new AbortController().signal })).toMatchObject({ ok: true, body: [{ temp: 1 }, { temp: 2 }] });
});

it("refuses a paging bound above ten", () => {
  expect(readCustomSource({ ...customSource(), paging: { pageParam: "page", firstPage: 1, maxPages: 11 } })).toEqual({
    ok: false,
    message: "A custom source may fetch at most 10 pages.",
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run packages/host/src/settings/sources.test.ts packages/host/src/providers/custom/provider.test.ts
```

Expected: FAIL because custom paging and `extraSources` do not exist.

- [ ] **Step 3: Implement the source merge and paging**

Export `readCustomSource` from `sources.ts` and use it in `asSource`. Add `extraSources` to the provider's reload, refusing a duplicate id. Extend the request builder in `fetch-source.ts`; every page still goes through the existing SSRF guard, redirect check, byte cap, and in-flight limit.

- [ ] **Step 4: Run the custom-source suites**

```bash
npx vitest run packages/host/src/settings/sources.test.ts packages/host/src/providers/custom
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/web/packages/host/src/settings/sources.ts src/web/packages/host/src/providers/custom/provider.ts src/web/packages/host/src/providers/custom/fetch-source.ts src/web/packages/host/src/main.ts
git commit -m "feat(host): load declarative custom sources

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 9: Document the ABI and run the gate

**Files:**
- Modify: `docs/architecture.md`
- Modify: `docs/product.md`

- [ ] **Step 1: Update the docs**

State the qualified plugin key, the four execution profiles, the closed capability list, the consent binding, and that no plugin code runs in this phase.

- [ ] **Step 2: Run the gate**

```bash
cd src/web
npm run gate
echo "exit=$?"
```

Expected: `exit=0`.

- [ ] **Step 3: Commit**

```bash
git add docs/architecture.md docs/product.md
git commit -m "docs: describe the extension ABI

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```
