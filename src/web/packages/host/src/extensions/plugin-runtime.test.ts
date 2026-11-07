import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type {
  DeviceAllowlist,
  InstalledExtension,
  InstalledPlugin,
  PluginInstaller,
  PluginManifest,
} from "@yunari/extension-api";
import { strToU8, zipSync } from "fflate";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AssetSource } from "../assets/source.js";
import { createPanelFamilyRegistry } from "../panels/panel-families.js";
import { PluginPanelRows } from "../panels/plugin-panel-rows.js";
import type { SensorProvider } from "../providers/provider.js";
import { ProviderRegistry } from "../providers/registry.js";
import { createConsentStore } from "./consent-store.js";
import { createPluginInstaller } from "./install.js";
import { createPluginRuntime } from "./plugin-runtime.js";
import type { DeviceBroker } from "./runtime/device-broker.js";
import type { HostApiDispatcher } from "./runtime/supervisor.js";
import { createExtensionService, type ExtensionService } from "./service.js";

const supervisorMocks = vi.hoisted(() => {
  interface FakeSupervisor {
    alive: boolean;
    starts: number;
    stops: number;
    start(): Promise<void>;
    request<T>(method: string, params: unknown): Promise<T>;
    stop(): Promise<void>;
  }

  const created: FakeSupervisor[] = [];

  function make(): FakeSupervisor {
    const supervisor: FakeSupervisor = {
      alive: true,
      starts: 0,
      stops: 0,
      async start() {
        supervisor.starts += 1;
      },
      request<T>(): Promise<T> {
        return Promise.resolve(undefined as T);
      },
      async stop() {
        supervisor.stops += 1;
        supervisor.alive = false;
      },
    };
    created.push(supervisor);
    return supervisor;
  }

  return {
    created,
    make,
    reset() {
      created.length = 0;
    },
  };
});

vi.mock("./runtime/supervisor.js", () => ({
  createPluginSupervisor: () => supervisorMocks.make(),
}));

const PLUGIN_KEY = "local/acme";
const VENDOR_ID = 0x1234;
const PRODUCT_ID = 0x5678;
const CODE_SOURCE_ID = "acme-code";
const DECLARATIVE_SOURCE_ID = "acme-declared";

function panelFamilyEntry() {
  return {
    id: "acme-panel",
    label: "Acme Panel",
    vendorId: VENDOR_ID,
    productId: PRODUCT_ID,
    geometry: { width: 480, height: 1920 },
    support: {
      maker: "Acme",
      hardwareRevision: "1",
      supportedFirmware: ["1.0"],
      updatedAt: "2026-11-07",
    },
    commands: [],
    transports: ["usb" as const],
  };
}

function manifest(): PluginManifest {
  return {
    manifestVersion: 1,
    id: "acme",
    name: "Acme",
    version: "1.0.0",
    description: "Reads the room and serves its artwork.",
    engines: { yunari: ">=0.1.0" },
    pluginApi: 1,
    execution: "trusted-worker",
    capabilities: [
      "sensor:provide",
      "asset:provide",
      "panel:drive",
      "usb:device",
    ],
    contributes: {
      sensorProviders: [{ id: "acme-sensors", label: "Acme Sensors" }],
      assetSources: [
        {
          id: CODE_SOURCE_ID,
          label: "Acme Code",
          category: "image",
          body: "grid",
          entry: "code",
        },
        {
          id: DECLARATIVE_SOURCE_ID,
          label: "Acme Declared",
          category: "image",
          body: "grid",
          host: "api.acme.test",
          request: {
            url: "https://api.acme.test/search?q={query}&page={page}",
            pageParam: "page",
            firstPage: 1,
            totalPath: "/total",
          },
          result: {
            itemsPath: "/items",
            id: "/id",
            name: "/name",
            preview: "/thumb",
            sourceUrl: "/sourceUrl",
          },
        },
      ],
      panelFamilies: [panelFamilyEntry()],
    },
    main: "main.js",
  };
}

function plugin(): InstalledPlugin {
  const value = manifest();
  return {
    key: PLUGIN_KEY,
    publisher: "local",
    manifest: value,
    directory: "plugins/acme",
    contentHash: "a".repeat(64),
  };
}

function extension(consent: InstalledExtension["consent"]): InstalledExtension {
  const value = manifest();
  return {
    key: PLUGIN_KEY,
    name: value.name,
    publisher: "local",
    version: value.version,
    execution: value.execution,
    capabilities: value.capabilities,
    contributions: value.contributes,
    devices: [],
    consent,
    fingerprint: "a".repeat(64),
  };
}

function builtinProvider(): SensorProvider {
  return {
    id: "builtin",
    label: "Builtin",
    describe: () => Promise.resolve([]),
    sample: () => Promise.resolve([]),
    health: () => ({ available: true }),
  };
}

function builtinSource(): AssetSource {
  return {
    id: "builtin-source",
    label: "Builtin",
    category: "image",
    body: "grid",
    requires: undefined,
    configurable: true,
    search: () => Promise.resolve({ results: [], totalPages: undefined }),
    bytesOf: () => Promise.resolve(undefined),
  };
}

function fakeBroker(): DeviceBroker & {
  readonly closeAll: ReturnType<typeof vi.fn>;
} {
  return {
    list: () => Promise.resolve([]),
    open: () => Promise.reject(new Error("unused")),
    call: () => Promise.reject(new Error("unused")),
    close: () => Promise.resolve(),
    closeAll: vi.fn(() => Promise.resolve()),
    closeScope: () => Promise.resolve(),
  };
}

const hostApi: HostApiDispatcher = { call: () => Promise.resolve(undefined) };

/**
 * The same wiring `main.ts` builds: one provider registry, one panel-family
 * registry, one allowlist map the broker reads, and the live runtime over them.
 */
function wiring() {
  const target = plugin();
  let granted = false;
  let orderCalls = 0;

  const installer: PluginInstaller = {
    list: () => Promise.resolve([target]),
    read: () => Promise.resolve(target),
    preview: () => Promise.resolve({ ok: false }),
    install: () => Promise.resolve({ ok: false }),
    remove: () => Promise.resolve(),
  };

  const extensions: ExtensionService = {
    list: () => Promise.resolve([extension(granted ? "granted" : "missing")]),
    install: () => Promise.resolve({ ok: false }),
    grantConsent: () => Promise.resolve({ ok: true }),
    remove: () => Promise.resolve(),
    mayLoad: () => Promise.resolve(granted),
    installedPlugin: () => Promise.resolve(target),
    consentRecord: () =>
      Promise.resolve(
        granted
          ? {
              pluginKey: PLUGIN_KEY,
              version: target.manifest.version,
              fingerprint: "a".repeat(64),
              grantedAt: "2026-11-07T00:00:00Z",
            }
          : undefined,
      ),
    readProviderOrder: () => {
      orderCalls += 1;
      return Promise.resolve({ version: 1, pluginOrder: [PLUGIN_KEY] });
    },
    writeProviderOrder: () => Promise.resolve({ ok: true }),
  };

  const registry = new ProviderRegistry([builtinProvider()]);
  const panelRegistry = createPanelFamilyRegistry();
  const panelRows = new PluginPanelRows(panelRegistry);
  const allowlists = new Map<string, readonly DeviceAllowlist[]>();
  const broker = fakeBroker();

  const runtime = createPluginRuntime({
    installer,
    extensions,
    hostApi,
    builtinProviders: [builtinProvider()],
    registry,
    builtinAssetSources: [builtinSource()],
    panelRows,
    broker,
    allowlists,
  });

  return {
    runtime,
    registry,
    panelRegistry,
    allowlists,
    broker,
    orderCalls: () => orderCalls,
    grant(next: boolean) {
      granted = next;
    },
  };
}

beforeEach(() => {
  supervisorMocks.reset();
});

describe("createPluginRuntime", () => {
  it("starts a newly consented plugin's worker and publishes its contributions", async () => {
    const host = wiring();

    await host.runtime.reconcile();
    expect(supervisorMocks.created).toHaveLength(0);
    expect(host.runtime.assetSources().map((source) => source.id)).toEqual([
      "builtin-source",
    ]);
    expect(host.allowlists.size).toBe(0);

    host.grant(true);
    await host.runtime.reconcile();

    expect(supervisorMocks.created).toHaveLength(1);
    expect(supervisorMocks.created[0]?.starts).toBe(1);

    // One provider, after the host's own, read from the same registry a poll
    // uses.
    expect(host.runtime.providers().map((provider) => provider.id)).toEqual([
      "builtin",
      "acme-sensors",
    ]);
    expect(host.runtime.providers()[1]?.pluginKey).toBe(PLUGIN_KEY);

    // Both a code row and a declarative row, and the one collision rule
    // leaves the built-in first.
    expect(host.runtime.assetSources().map((source) => source.id)).toEqual([
      "builtin-source",
      CODE_SOURCE_ID,
      DECLARATIVE_SOURCE_ID,
    ]);

    // The panel family is live in the registry the panel manager reads, and
    // the device it declares is in the broker's allowlist.
    expect(host.panelRegistry.forDevice(VENDOR_ID, PRODUCT_ID)).toBeDefined();
    expect(host.allowlists.get(PLUGIN_KEY)).toEqual([
      { transport: "usb", vendorId: VENDOR_ID, productId: PRODUCT_ID },
    ]);

    // The order store is read for the run that added the provider.
    expect(host.orderCalls()).toBeGreaterThanOrEqual(2);
  });

  it("does not fork a second worker when the grant repeats", async () => {
    const host = wiring();
    host.grant(true);

    await host.runtime.reconcile();
    await host.runtime.reconcile();

    expect(supervisorMocks.created).toHaveLength(1);
    expect(supervisorMocks.created[0]?.starts).toBe(1);
    expect(host.runtime.providers()).toHaveLength(2);
  });

  it("stops a revoked plugin's worker and removes every contribution", async () => {
    const host = wiring();
    host.grant(true);
    await host.runtime.reconcile();
    expect(host.runtime.providers()).toHaveLength(2);

    host.grant(false);
    await host.runtime.reconcile();

    expect(supervisorMocks.created[0]?.stops).toBe(1);
    expect(host.runtime.supervisors.size).toBe(0);
    expect(host.runtime.providers().map((provider) => provider.id)).toEqual([
      "builtin",
    ]);
    expect(host.runtime.assetSources().map((source) => source.id)).toEqual([
      "builtin-source",
    ]);
    expect(host.panelRegistry.forDevice(VENDOR_ID, PRODUCT_ID)).toBeUndefined();
    expect(host.allowlists.size).toBe(0);
    expect(host.broker.closeAll).toHaveBeenCalledWith(PLUGIN_KEY);
  });
});

describe("the extension service's change event", () => {
  let dir: string | undefined;

  afterEach(async () => {
    if (dir !== undefined) await rm(dir, { recursive: true, force: true });
    dir = undefined;
  });

  it("grants and revokes a real install through onChange", async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), "yunari-plugin-runtime-"));
    const installer = createPluginInstaller(path.join(dir, "extensions"));
    const consent = createConsentStore(dir);
    let runtime: ReturnType<typeof createPluginRuntime> | undefined;

    // The same join `main.ts` runs: the service reports a change and the live
    // runtime reconciles.
    const service = createExtensionService({
      installer,
      consent,
      now: () => "2026-11-07T00:00:00Z",
      providerOrder: {
        read: () => Promise.resolve({ version: 1, pluginOrder: [] }),
        write: () => Promise.resolve(),
      },
      onChange: async () => {
        await runtime?.reconcile();
      },
    });

    const panelRegistry = createPanelFamilyRegistry();
    const allowlists = new Map<string, readonly DeviceAllowlist[]>();
    const broker = fakeBroker();
    runtime = createPluginRuntime({
      installer,
      extensions: service,
      hostApi,
      builtinProviders: [builtinProvider()],
      registry: new ProviderRegistry([builtinProvider()]),
      builtinAssetSources: [builtinSource()],
      panelRows: new PluginPanelRows(panelRegistry),
      broker,
      allowlists,
    });

    const installed = await service.install(
      zipSync(
        {
          "yunari-plugin.json": strToU8(JSON.stringify(manifest())),
          "main.js": strToU8("export default {};"),
        },
        { level: 0 },
      ),
    );
    expect(installed).toMatchObject({ ok: true });

    // Installed but not consented: no worker, no rows.
    expect(supervisorMocks.created).toHaveLength(0);
    expect(runtime.assetSources().map((source) => source.id)).toEqual([
      "builtin-source",
    ]);

    const [listed] = await service.list();
    if (listed === undefined) throw new Error("no extension listed");
    expect(await service.grantConsent(listed.key, listed.fingerprint)).toEqual({
      ok: true,
    });

    expect(supervisorMocks.created).toHaveLength(1);
    expect(runtime.providers().map((provider) => provider.id)).toEqual([
      "builtin",
      "acme-sensors",
    ]);
    expect(runtime.assetSources().map((source) => source.id)).toEqual([
      "builtin-source",
      CODE_SOURCE_ID,
      DECLARATIVE_SOURCE_ID,
    ]);
    expect(panelRegistry.forDevice(VENDOR_ID, PRODUCT_ID)).toBeDefined();
    expect(allowlists.get(PLUGIN_KEY)).toEqual([
      { transport: "usb", vendorId: VENDOR_ID, productId: PRODUCT_ID },
    ]);

    // A reload that throws after the grant landed must not fail the request;
    // the contribution lists are rebuilt by the next reconcile.
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const failing = vi
      .spyOn(installer, "list")
      .mockRejectedValueOnce(new Error("reload failed"));
    try {
      await expect(
        service.grantConsent(listed.key, listed.fingerprint),
      ).resolves.toEqual({ ok: true });
    } finally {
      failing.mockRestore();
      consoleError.mockRestore();
    }

    await service.remove(listed.key);

    expect(supervisorMocks.created[0]?.stops).toBe(1);
    expect(runtime.supervisors.size).toBe(0);
    expect(runtime.providers().map((provider) => provider.id)).toEqual([
      "builtin",
    ]);
    expect(runtime.assetSources().map((source) => source.id)).toEqual([
      "builtin-source",
    ]);
    expect(panelRegistry.forDevice(VENDOR_ID, PRODUCT_ID)).toBeUndefined();
    expect(allowlists.size).toBe(0);
    expect(broker.closeAll).toHaveBeenCalledWith(PLUGIN_KEY);
  });
});
