# USB Panel Drivers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Admit reviewed panel-family plugins that drive USB, HID, and serial panels only through host-mediated transfers, with hardware consent and per-display failure isolation.

**Architecture:** A `DeviceBroker` in the host owns every native handle and exposes opaque tokens. A plugin family row implements the existing `PanelFamily` contract; its `PanelDevice` sends `panel.*` requests to the worker and the worker's `usb.*`/`hid.*`/`serial.*` calls come back to the broker. The static `PANEL_FAMILIES` table becomes a registry with built-in rows first.

**Tech Stack:** TypeScript, Node `usb`, `node-hid`, `serialport` (all installed), the Plan 4 fork runtime, Vitest with fake backends. No new runtime dependency.

**Spec:** `docs/superpowers/specs/2026-11-06-extension-platform-design.md`

**Prerequisite:** `2026-11-06-extension-core.md`, `2026-11-06-executable-extensions.md`, and `2026-11-06-store-distribution.md`.

## Global Constraints

- A panel family plugin runs only as `trusted-worker` and is store-reviewed before publish.
- The host owns every device handle. No handle crosses the worker boundary; transfer bytes travel as buffers.
- A plugin may open only the vendor/product ids or serial paths declared in its `panelFamilies` contribution and allowed by its hardware consent.
- Hardware consent names every device id. A missing or broader allowlist refuses install or load.
- A driver crash or timeout stops only that display's runner. The kill list unloads the plugin.
- Built-in families keep precedence. A plugin cannot replace a built-in row.
- Node cannot fully sandbox a native USB stack. Host mediation, review, consent, and revocation are the controls.
- Run every npm command from `src/web/`. `npm run gate` must exit 0 without network access.

## Review Focus

- A plugin requests a vendor/product id or serial path it did not declare: the broker refuses before opening, and no handle is created.
- A transfer to an unopened token, a token from another plugin, or a token after close: refused, and the error names the state rather than a device path.
- A panel family reports geometry that disagrees with its manifest: the manifest's declared geometry is used for preview and runner cadence; the device cannot silently change it.
- A driver crashes or hangs mid-frame: only that display's runner stops; the other panels and the built-in families keep running.
- A killed or consent-stale hardware plugin: its family is absent from the registry and its display is disconnected, not driven by a stale worker.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/web/packages/extension-api/src/device.ts` | Device allowlists, transfer request/result shapes, hardware consent identities. |
| `src/web/packages/extension-api/src/manifest.ts` | `panelFamilies` device validation and capability requirements. |
| `src/web/packages/host/src/extensions/runtime/device-broker.ts` | Host handle table, allowlist checks, backpressure, close. |
| `src/web/packages/host/src/extensions/runtime/usb-backend.ts` | `usb` and `node-hid` backend. |
| `src/web/packages/host/src/extensions/runtime/serial-backend.ts` | `serialport` backend. |
| `src/web/packages/host/src/panels/panel-families.ts` | `PanelFamilyRegistry`; built-ins first; `forDevice`, `attachedAll`. |
| `src/web/packages/host/src/panels/plugin-panel-family.ts` | `PanelFamily` row from a plugin contribution. |
| `src/web/packages/host/src/panels/plugin-panel-device.ts` | `PanelDevice` over `panel.*` requests. |
| `src/web/packages/host/src/panels/panel-manager.ts` | Reads the registry from options instead of the module table. |
| `src/web/packages/host/src/server/displays-routes.ts` | Family lookup through the registry. |
| `src/web/packages/host/src/server/panel-preview-route.ts` | Family lookup through the registry. |
| `src/web/packages/host/src/server/themes-routes.ts` | Family lookup through the registry. |

---

### Task 1: Record the panel-driver reuse decision

**Files:**
- Create: `docs/decisions/0116-usb-panel-drivers.md`

**Interfaces:**
- Consumes: the spec's `USB panel drivers` section and the existing panel driver evidence in `docs/hardware/`.
- Produces: exact `Paths:` claims for the broker and family registry.

- [ ] **Step 1: Write the decision note**

Header:

```markdown
# 0116 — USB panel drivers

- **Date:** 2026-11-06
- **Status:** accepted
- **Paths:** `src/web/packages/extension-api/src/device.ts`
  `src/web/packages/extension-api/src/manifest.ts`
  `src/web/packages/host/src/extensions/runtime/device-broker.ts`
  `src/web/packages/host/src/extensions/runtime/usb-backend.ts`
  `src/web/packages/host/src/extensions/runtime/serial-backend.ts`
  `src/web/packages/host/src/panels/panel-families.ts`
  `src/web/packages/host/src/panels/plugin-panel-family.ts`
  `src/web/packages/host/src/panels/plugin-panel-device.ts`
  `src/web/packages/host/src/panels/panel-manager.ts`
  `src/web/packages/host/src/server/displays-routes.ts`
  `src/web/packages/host/src/server/panel-preview-route.ts`
  `src/web/packages/host/src/server/themes-routes.ts`
```

Rungs: `PanelFamily`, `PanelDevice`, `PanelRunner`, and the three built-in drivers are the owners; `usb`, `node-hid`, and `serialport` are installed; native handles are process-wide and cannot be sandboxed in Node; Orca's host-mediated device API is the public prior art; the probe is a fake backend returning one frame through an opaque token. Decision: broker handles in the host, adapt panel families to the existing port.

- [ ] **Step 2: Verify the hook accepts the claims**

```bash
echo '{"tool_input":{"file_path":"src/web/packages/host/src/extensions/runtime/device-broker.ts"}}' | node scripts/reuse-gate.mjs
echo "exit=$?"
```

Expected: `exit=0`.

- [ ] **Step 3: Commit**

```bash
git add docs/decisions/0116-usb-panel-drivers.md
git commit -m "docs(decisions): authorise host-mediated panel drivers

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 2: Declare device allowlists and hardware consent

**Files:**
- Create: `src/web/packages/extension-api/src/device.ts`
- Modify: `src/web/packages/extension-api/src/manifest.ts`
- Modify: `src/web/packages/extension-api/src/consent.ts`
- Modify: `src/web/packages/extension-api/src/index.ts`
- Modify: `src/web/packages/host/src/panels/panel-device.ts`
- Test: `src/web/packages/extension-api/src/device.test.ts`
- Test: `src/web/packages/extension-api/src/manifest.test.ts`

**Interfaces:**
- Produces:

```ts
export type DeviceAllowlist =
  | {
      readonly transport: "usb" | "hid";
      readonly vendorId: number;
      readonly productId: number;
      readonly interfaceNumber?: number;
    }
  | {
      readonly transport: "serial";
      readonly path: string;
      readonly vendorId?: number;
      readonly productId?: number;
    };

export function deviceAllowlistOf(manifest: PluginManifest): readonly DeviceAllowlist[];
export function deviceIdentity(device: DeviceAllowlist): string;
// "usb:1cbe:a092", "hid:1e71:3008", "serial:COM3"

/** Canonical panel command union; `PanelControlCommand` in the host aliases it. */
export type PanelCommand =
  | { readonly kind: "brightness"; readonly level: number }
  | { readonly kind: "screen"; readonly on: boolean }
  | {
      readonly kind: "panel-settings";
      readonly startMode: 0 | 1 | 2;
      readonly flip: boolean;
      readonly sleepDelay: number;
    }
  | { readonly kind: "restart" }
  | { readonly kind: "status" }
  | { readonly kind: "hello" };

export interface PanelPresentParams {
  readonly format: "jpeg" | "png";
  readonly bytes: Uint8Array;
}
export interface PanelOpenParams {
  readonly width: number;
  readonly height: number;
  readonly renderMode?: string;
}
export interface PanelCommandParams {
  readonly command: PanelCommand;
}
```

Rules: a `panelFamilies` contribution requires `panel:drive`, `trusted-worker`, and at least one of `usb:device` or `serial:device`. Its `vendorId` and `productId` are integers `0..65535`; `commands` is a subset of `PanelCommand["kind"]` (`brightness`, `screen`, `panel-settings`, `restart`, `status`, `hello`); `renderModes` is a deduplicated string list of at most 8. `panel-device.ts` replaces its local union with `export type PanelControlCommand = PanelCommand`; there is one union, not two. Device allowlists are the union of every family's ids and every explicit serial path. A duplicate `deviceIdentity` is one consent row. `ConsentBinding.devices` is sorted from these identities.

- [ ] **Step 1: Write the failing tests**

```ts
it("requires panel:drive for a panel family", () => {
  const manifest = { ...validManifest(), capabilities: ["usb:device"], contributes: { panelFamilies: [family()] } };
  expect(readPluginManifest(manifest)).toEqual({
    ok: false,
    reason: 'The panelFamilies contribution requires the "panel:drive" capability.',
  });
});

it("builds stable device identities", () => {
  expect(deviceAllowlistOf(manifestWithFamily()).map(deviceIdentity)).toEqual(["usb:1cbe:a092"]);
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run packages/extension-api/src/device.test.ts packages/extension-api/src/manifest.test.ts
```

Expected: FAIL because device declarations do not exist.

- [ ] **Step 3: Implement device declarations**

A serial path is a Windows `COM<number>` or a POSIX absolute path, no `..`; a family that declares serial must also declare `serial:device`. Keep the device list in the consent binding so a new id forces re-consent.

- [ ] **Step 4: Run the extension-api suite**

```bash
npx vitest run packages/extension-api/src
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/web/packages/extension-api/src/device.ts src/web/packages/extension-api/src/manifest.ts src/web/packages/extension-api/src/consent.ts src/web/packages/extension-api/src/index.ts src/web/packages/host/src/panels/panel-device.ts
git commit -m "feat(extension-api): declare panel devices and consent

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 3: Broker native device handles

**Files:**
- Create: `src/web/packages/host/src/extensions/runtime/device-broker.ts`
- Create: `src/web/packages/host/src/extensions/runtime/usb-backend.ts`
- Create: `src/web/packages/host/src/extensions/runtime/serial-backend.ts`
- Test: `src/web/packages/host/src/extensions/runtime/device-broker.test.ts`

**Interfaces:**
- Produces:

```ts
export interface DeviceDescriptor {
  readonly transport: "usb" | "hid" | "serial";
  readonly vendorId: number;
  readonly productId: number;
  readonly path: string;
  readonly serial: string | undefined;
  readonly product: string | undefined;
}

export interface DeviceHandle {
  open(): Promise<void>;
  bulkTransferOut(endpoint: number, bytes: Uint8Array): Promise<void>;
  controlTransferOut(request: { requestType: number; request: number; value: number; index: number; bytes: Uint8Array }): Promise<void>;
  interruptTransferIn(endpoint: number, length: number): Promise<Uint8Array>;
  hidWrite(bytes: Uint8Array): Promise<void>;
  hidRead(length: number): Promise<Uint8Array>;
  serialWrite(bytes: Uint8Array): Promise<void>;
  serialRead(timeoutMs: number): Promise<Uint8Array>;
  serialDrain(): Promise<Uint8Array>;
  close(): Promise<void>;
}

export interface DeviceBackend {
  list(): Promise<readonly DeviceDescriptor[]>;
  open(device: DeviceDescriptor): Promise<DeviceHandle>;
}

export interface DeviceBroker {
  list(pluginKey: string): Promise<readonly DeviceDescriptor[]>;
  open(pluginKey: string, selector: { readonly transport: "usb" | "hid" | "serial"; readonly vendorId: number; readonly productId: number; readonly path?: string; readonly interfaceNumber?: number }): Promise<string>;
  call(pluginKey: string, token: string, method: string, params: unknown): Promise<unknown>;
  close(pluginKey: string, token: string): Promise<void>;
  closeAll(pluginKey: string): Promise<void>;
}

export function createDeviceBroker(options: {
  readonly allowlists: (pluginKey: string) => readonly DeviceAllowlist[];
  readonly backend: DeviceBackend;
  readonly maxInFlightPerPlugin?: number;
  readonly maxTransferBytes?: number;
}): DeviceBroker;
```

Rules: `open` matches a declared allowlist entry exactly, opens the descriptor, stores `{ pluginKey, handle }` under an opaque `crypto.randomUUID()` token, and returns the token. `call` refuses a token owned by another plugin and refuses a closed token. `maxInFlightPerPlugin` defaults to 4; `maxTransferBytes` defaults to 1 MiB, and a larger `bytes`/`length` is refused before the backend sees it. `closeAll` runs on uninstall, kill, and host shutdown.

- [ ] **Step 1: Write the failing tests**

```ts
it("refuses an undeclared device before opening", async () => {
  const backend = fakeBackend();
  const broker = createDeviceBroker({ allowlists: () => [{ transport: "usb", vendorId: 0x1cbe, productId: 0xa092 }], backend });
  await expect(broker.open("acme/panel", { transport: "usb", vendorId: 0x1cbe, productId: 0xffff })).rejects.toThrow("not declared");
  expect(backend.opened).toEqual([]);
});

it("refuses another plugin's token", async () => {
  const token = await broker.open("acme/panel", declaredSelector());
  await expect(broker.call("other/panel", token, "usb.bulkTransferOut", { endpoint: 1, bytes: new Uint8Array() })).rejects.toThrow("not this plugin");
});

it("refuses a transfer above the cap", async () => {
  const token = await broker.open("acme/panel", declaredSelector());
  await expect(broker.call("acme/panel", token, "usb.bulkTransferOut", { endpoint: 1, bytes: new Uint8Array(1024 * 1024 + 1) })).rejects.toThrow("too large");
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run packages/host/src/extensions/runtime/device-broker.test.ts
```

Expected: FAIL because the broker does not exist.

- [ ] **Step 3: Implement the broker and backends**

`usb-backend.ts` wraps `usb` and `node-hid`; `serial-backend.ts` wraps `serialport`. Keep each backend behind `DeviceHandle`, so tests use a fake and no real device is opened. A backend failure closes the handle and removes the token before rethrowing.

- [ ] **Step 4: Run the broker test**

```bash
npx vitest run packages/host/src/extensions/runtime/device-broker.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/web/packages/host/src/extensions/runtime/device-broker.ts src/web/packages/host/src/extensions/runtime/usb-backend.ts src/web/packages/host/src/extensions/runtime/serial-backend.ts
git commit -m "feat(host): broker panel device handles

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 4: Make the panel family table a registry

**Files:**
- Modify: `src/web/packages/host/src/panels/panel-families.ts`
- Modify: `src/web/packages/host/src/panels/panel-manager.ts`
- Modify: `src/web/packages/host/src/server/options.ts`
- Modify: `src/web/packages/host/src/server.ts`
- Modify: `src/web/packages/host/src/server/displays-routes.ts`
- Modify: `src/web/packages/host/src/server/panel-preview-route.ts`
- Modify: `src/web/packages/host/src/server/themes-routes.ts`
- Modify: `src/web/packages/host/src/main.ts`
- Test: `src/web/packages/host/src/panels/panel-families.test.ts`
- Test: `src/web/packages/host/src/panels/panel-manager.test.ts`

**Interfaces:**
- Produces:

```ts
export interface PanelFamilyContribution {
  readonly id: string;
  readonly label: string;
  readonly vendorId: number;
  readonly productId: number;
  readonly geometry: { readonly width: number; readonly height: number };
  readonly support: PanelSupport;
  readonly commands: readonly PanelControlCommand["kind"][];
  readonly renderModes?: readonly string[];
}

export class PanelFamilyRegistry {
  constructor(families: readonly PanelFamily[]);
  all(): readonly PanelFamily[];
  forDevice(vendorId: number, productId: number): PanelFamily | undefined;
  attached(): Promise<readonly PanelHint[]>;
  withBuiltinsFirst(plugins: readonly PanelFamily[]): PanelFamilyRegistry;
}
export const BUILTIN_PANEL_FAMILIES: readonly PanelFamily[];
export function createPanelFamilyRegistry(plugins?: readonly PanelFamily[]): PanelFamilyRegistry;

export interface PanelManagerOptions {
  readonly families: PanelFamilyRegistry;
  // existing fields unchanged
}
```

Rules: `createPanelFamilyRegistry` returns built-ins plus plugin rows, built-ins first. A plugin row whose vendor/product pair matches a built-in is refused, and the built-in wins. `attached()` de-duplicates by `vendorId:productId:serial` as before. `HostServerOptions` gains `panelFamilies?: PanelFamilyRegistry`; `createHostServer` defaults to `createPanelFamilyRegistry()`. `main.ts` passes the registry with plugin rows. `panel-manager` uses `options.families.forDevice` and `options.families.attached`.

- [ ] **Step 1: Write the failing tests**

```ts
it("keeps built-ins first and refuses a shadowing plugin", () => {
  const registry = createPanelFamilyRegistry([pluginFamily({ vendorId: 0x1cbe, productId: 0xa092 })]);
  expect(registry.all()[0]).toBe(BUILTIN_PANEL_FAMILIES[0]);
  expect(registry.forDevice(0x1cbe, 0xa092)?.id).toBe("lianli-9-2");
});

it("attaches a plugin-only family", async () => {
  const registry = createPanelFamilyRegistry([pluginFamily({ vendorId: 0x1234, productId: 0x5678 })]);
  expect(await registry.attached()).toContainEqual(expect.objectContaining({ vendorId: 0x1234, productId: 0x5678 }));
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run packages/host/src/panels/panel-families.test.ts packages/host/src/panels/panel-manager.test.ts
```

Expected: FAIL because the registry does not exist and the manager still imports the module table.

- [ ] **Step 3: Implement the registry and thread it**

Replace every `familyFor(...)` call with `families.forDevice(...)`. Keep the exported `PANEL_FAMILIES` only as `BUILTIN_PANEL_FAMILIES` if a migration needs it; otherwise delete it. Update tests that mocked `./panel-families.js` to inject a registry through `PanelManagerOptions`.

- [ ] **Step 4: Run the panel suites**

```bash
npx vitest run packages/host/src/panels
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/web/packages/host/src/panels src/web/packages/host/src/server src/web/packages/host/src/main.ts
git commit -m "feat(host): register panel families

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 5: Adapt a plugin family to `PanelFamily` and `PanelDevice`

**Files:**
- Create: `src/web/packages/host/src/panels/plugin-panel-family.ts`
- Create: `src/web/packages/host/src/panels/plugin-panel-device.ts`
- Modify: `src/web/packages/host/src/extensions/runtime/host-api.ts`
- Modify: `src/web/packages/extension-api/src/protocol.ts`
- Test: `src/web/packages/host/src/panels/plugin-panel-family.test.ts`
- Test: `src/web/packages/host/src/panels/plugin-panel-device.test.ts`

**Interfaces:**
- Produces:

```ts
export function pluginPanelFamily(options: {
  readonly plugin: InstalledPlugin;
  readonly contribution: PanelFamilyContribution;
  readonly supervisor: PluginSupervisor;
  readonly broker: DeviceBroker;
  readonly cacheDir: string | undefined;
}): PanelFamily;

export interface PluginPanelDeviceOptions {
  readonly plugin: InstalledPlugin;
  readonly contribution: PanelFamilyContribution;
  readonly supervisor: PluginSupervisor;
  readonly broker: DeviceBroker;
}

export class PluginPanelDevice implements PanelDevice {
  readonly geometry: PanelGeometry;
  readonly frameIntervalMs?: number;
  readonly stillFormat?: "jpeg" | "png";
  readonly controls?: PanelControls;
  readonly video?: PanelVideo;
  constructor(options: PluginPanelDeviceOptions);
  open(): Promise<void>;
  present(still: Uint8Array): Promise<void>;
  close(): Promise<void>;
}
```

The host-to-plugin methods `panel.attached`, `panel.open`, `panel.present`, `panel.command`, and `panel.close` are added to `HostMethod`. The plugin-to-host methods `usb.open`, `usb.close`, `usb.bulkTransfer`, `usb.controlTransfer`, `usb.interruptTransfer`, `hid.read`, `hid.write`, `serial.read`, `serial.write`, and `serial.drain` are added to `PluginMethod` and the host API table. Every one requires its device capability and is dispatched by `DeviceBroker`.

Rules: `attached()` calls the plugin's `panel.attached` (a host method) or lists the broker's declared devices; use the manifest's geometry for the row. `open` sends `panel.open` with the declared geometry and optional render mode; the device's `open` sends `panel.open`, and `present` sends `panel.present` with `{ format, bytes }`. `controls.run` sends `panel.command`. `close` sends `panel.close`, then `broker.closeAll(pluginKey)`. A worker failure throws with the redacted reason and leaves the broker token cleanup to `close`.

- [ ] **Step 1: Write the failing tests**

```ts
it("sends bytes and no device handle to the worker", async () => {
  const supervisor = fakeSupervisor();
  const device = new PluginPanelDevice({ plugin, supervisor, broker, contribution: familyContribution() });
  await device.open();
  await device.present(new Uint8Array([1, 2, 3]));
  expect(supervisor.calls).toEqual([
    ["panel.open", { width: 480, height: 1920, renderMode: undefined }],
    ["panel.present", { format: "jpeg", bytes: new Uint8Array([1, 2, 3]) }],
  ]);
  expect(JSON.stringify(supervisor.calls)).not.toContain("token");
});

it("stops only this display when the worker dies", async () => {
  const device = new PluginPanelDevice({ plugin, supervisor: dyingSupervisor(), broker, contribution: familyContribution() });
  await expect(device.present(new Uint8Array([1]))).rejects.toThrow("stopped answering");
  expect(broker.closeAll).toHaveBeenCalledWith("acme/panel");
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run packages/host/src/panels/plugin-panel-family.test.ts packages/host/src/panels/plugin-panel-device.test.ts
```

Expected: FAIL because the adapters do not exist.

- [ ] **Step 3: Implement the adapters and host methods**

Use `supervisor.request` with `panel.attached`, `panel.open`, `panel.present`, `panel.command`, and `panel.close`. Validate the manifest geometry once at family construction and refuse a zero or negative dimension. The broker token stays in a private field of `PluginPanelDevice`; it is never included in a message.

- [ ] **Step 4: Run the adapter tests**

```bash
npx vitest run packages/host/src/panels/plugin-panel-family.test.ts packages/host/src/panels/plugin-panel-device.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/web/packages/host/src/panels/plugin-panel-family.ts src/web/packages/host/src/panels/plugin-panel-device.ts src/web/packages/host/src/extensions/runtime/host-api.ts src/web/packages/extension-api/src/protocol.ts
git commit -m "feat(host): adapt plugin panel families

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 6: Require hardware consent and exercise a fake family end to end

**Files:**
- Modify: `src/web/packages/host/src/extensions/service.ts`
- Modify: `src/web/packages/host/src/extensions/runtime/supervisor.ts`
- Modify: `src/web/packages/host/src/main.ts`
- Test: `src/web/packages/host/src/extensions/service.test.ts`
- Test: `src/web/packages/host/src/panels/fake-panel-family.test.ts`

**Interfaces:**
- `ExtensionService.mayLoad` returns false when a hardware plugin's consent record does not include every device identity. The consent route's response lists `{ devices: readonly string[] }`; the editor consent surface names them.
- A fake family test wiring:

```ts
const backend = fakeDeviceBackend({ responses: { "usb.bulkTransferOut": [] } });
const broker = createDeviceBroker({ allowlists: () => [USB_ALLOWLIST], backend });
const plugin = installedPlugin(hardwareManifest());
const family = pluginPanelFamily({ plugin, contribution: hardwarePanelContribution(), supervisor: fakeSupervisor(), broker });
const device = await family.open();
await device.present(FAKE_JPEG);
expect(backend.transfers).toEqual([expect.objectContaining({ endpoint: 0x02, bytes: FAKE_JPEG })]);
expect(family.geometry).toEqual({ width: 480, height: 1920 });
```

Rules: installing a hardware plugin without a consent record leaves it installed but unloadable. Granting the exact fingerprint loads it. Adding a second device id to a later version changes the fingerprint and holds the update. A kill-list entry removes the family and closes every token.

- [ ] **Step 1: Write the failing tests**

```ts
it("does not load a hardware plugin without hardware consent", async () => {
  await service.install(hardwarePluginBytes());
  expect(await service.mayLoad("local/acme-panel")).toBe(false);
  await service.grantConsent("local/acme-panel", await fingerprintOf(hardwarePluginBytes()));
  expect(await service.mayLoad("local/acme-panel")).toBe(true);
});

it("drives a fake device only through host-mediated transfers", async () => {
  // the fake family test above
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run packages/host/src/extensions/service.test.ts packages/host/src/panels/fake-panel-family.test.ts
```

Expected: FAIL because hardware consent and the fake family are not enforced.

- [ ] **Step 3: Implement the consent check and fake test**

`service.ts` builds the consent binding with `deviceAllowlistOf(manifest)` and requires an exact match before `mayLoad` is true. The fake backend is test-only and lives under `src/web/packages/host/src/panels/` beside the other panel fixtures. No real USB device is opened.

- [ ] **Step 4: Run the consent and fake-family suites**

```bash
npx vitest run packages/host/src/extensions/service.test.ts packages/host/src/panels/fake-panel-family.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/web/packages/host/src/extensions/service.ts src/web/packages/host/src/extensions/runtime/supervisor.ts src/web/packages/host/src/main.ts src/web/packages/host/src/panels/fake-panel-family.test.ts
git commit -m "feat: require hardware consent for panel plugins

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 7: Document panel drivers and run the gate

**Files:**
- Modify: `docs/hardware/README.md`
- Modify: `docs/architecture.md`
- Modify: `docs/operations.md`

- [ ] **Step 1: Update the docs**

State the broker, the declared ids, hardware consent, the review gate, per-display isolation, and the limitation that Node cannot fully sandbox a native USB stack.

- [ ] **Step 2: Run the gate**

```bash
cd src/web
npm run gate
echo "exit=$?"
```

Expected: `exit=0`.

- [ ] **Step 3: Commit**

```bash
git add docs/hardware/README.md docs/architecture.md docs/operations.md
git commit -m "docs: describe host-mediated panel drivers

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```
