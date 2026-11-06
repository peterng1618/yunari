import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type {
  InstalledPlugin,
  PluginInstaller,
  PluginManifest,
} from "@yunari/extension-api";
import type { SampleEntry } from "@yunari/renderer-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  SensorDescriptor,
  SensorProvider,
} from "../providers/provider.js";
import type { ConsentStore } from "./consent-store.js";
import { createProviderOrderStore, orderProviders } from "./provider-order.js";
import { createPluginProviders, PluginSensorProvider } from "./providers.js";
import type {
  HostApiDispatcher,
  PluginSupervisor,
} from "./runtime/supervisor.js";
import { createExtensionService, type ExtensionService } from "./service.js";

const supervisorMocks = vi.hoisted(() => {
  interface FakeSupervisor {
    alive: boolean;
    starts: number;
    stops: number;
    options?: { readonly onCrash?: (reason: string) => void };
    requests: { readonly method: string; readonly params: unknown }[];
    startMode: "resolve" | "reject";
    answer: (method: string, params: unknown) => unknown;
    start(): Promise<void>;
    request(method: string, params: unknown): Promise<unknown>;
    stop(): Promise<void>;
  }

  const created: FakeSupervisor[] = [];
  let next: (() => Partial<FakeSupervisor>) | undefined;

  function make(): FakeSupervisor {
    const supervisor: FakeSupervisor = {
      alive: true,
      starts: 0,
      stops: 0,
      requests: [],
      startMode: "resolve",
      answer: () => undefined,
      async start() {
        supervisor.starts += 1;
        if (supervisor.startMode === "reject") {
          supervisor.options?.onCrash?.("plugin did not start");
          throw new Error("plugin did not start");
        }
      },
      async request(method, params) {
        supervisor.requests.push({ method, params });
        return supervisor.answer(method, params);
      },
      async stop() {
        supervisor.stops += 1;
        supervisor.alive = false;
      },
    };

    const configured = next?.();
    if (configured !== undefined) Object.assign(supervisor, configured);
    created.push(supervisor);
    return supervisor;
  }

  return {
    created,
    make,
    setNext(factory: (() => Partial<FakeSupervisor>) | undefined) {
      next = factory;
    },
    reset() {
      created.length = 0;
      next = undefined;
    },
  };
});

vi.mock("./runtime/supervisor.js", () => ({
  createPluginSupervisor: (options: {
    readonly onCrash?: (reason: string) => void;
  }) => {
    const supervisor = supervisorMocks.make();
    supervisor.options = options;
    return supervisor;
  },
}));

const NOW = Date.parse("2026-01-01T00:00:10Z");
const CONTRIBUTION = { id: "acme", label: "Acme" };

function manifest(overrides: Partial<PluginManifest> = {}): PluginManifest {
  return {
    manifestVersion: 1,
    id: "acme-sensors",
    name: "Acme Sensors",
    version: "1.0.0",
    description: "Reads the room's sensors.",
    engines: { yunari: ">=0.1.0" },
    pluginApi: 1,
    execution: "trusted-worker",
    capabilities: ["sensor:provide"],
    contributes: { sensorProviders: [CONTRIBUTION] },
    main: "main.js",
    ...overrides,
  };
}

function plugin(overrides: Partial<PluginManifest> = {}): InstalledPlugin {
  const value = manifest(overrides);
  return {
    key: `local/${value.id}`,
    publisher: "local",
    manifest: value,
    directory: path.join("plugins", value.id),
    contentHash: "a".repeat(64),
  };
}

function descriptor(semanticKey = "cpu.load"): SensorDescriptor {
  return {
    sensorId: `acme:${semanticKey}`,
    semanticKey,
    label: semanticKey,
    tier: "baseline",
  };
}

function okEntry(semanticKey: string, value: number): SampleEntry {
  return {
    semanticKey,
    sample: {
      sensorId: `acme:${semanticKey}`,
      timestamp: new Date(NOW).toISOString(),
      status: "ok",
      value,
    },
  };
}

/** A supervisor that answers every request from one function. */
function supervisorAnswering(
  answer: (method: string, params: unknown) => unknown,
): PluginSupervisor & { readonly requests: unknown[] } {
  const requests: { readonly method: string; readonly params: unknown }[] = [];
  return {
    alive: true,
    requests,
    start: () => Promise.resolve(),
    request<T>(method: string, params: unknown): Promise<T> {
      requests.push({ method, params });
      return Promise.resolve(answer(method, params) as T);
    },
    stop: () => Promise.resolve(),
  };
}

function providerWith(
  supervisor: PluginSupervisor,
  contribution = CONTRIBUTION,
): PluginSensorProvider {
  return new PluginSensorProvider({
    plugin: plugin(),
    supervisor,
    contribution,
  });
}

function memoryConsent(): ConsentStore {
  return {
    read: () => Promise.resolve({ version: 1, plugins: {} }),
    grant: () => Promise.reject(new Error("unused")),
    revoke: () => Promise.reject(new Error("unused")),
  };
}

function fakeInstaller(plugins: readonly InstalledPlugin[]): PluginInstaller {
  return {
    list: () => Promise.resolve(plugins),
    read: (key) => Promise.resolve(plugins.find((p) => p.key === key)),
    install: () => Promise.resolve({ ok: false }),
    remove: () => Promise.resolve(),
  };
}

function memoryOrder(): {
  read(): Promise<{ version: 1; pluginOrder: readonly string[] }>;
  write(order: { version: 1; pluginOrder: readonly string[] }): Promise<void>;
} {
  let value: { version: 1; pluginOrder: readonly string[] } = {
    version: 1,
    pluginOrder: [],
  };
  return {
    read: () => Promise.resolve(value),
    write: (order) => {
      value = order;
      return Promise.resolve();
    },
  };
}

function fakeExtensions(
  overrides: Partial<ExtensionService> = {},
): ExtensionService {
  return {
    list: () => Promise.resolve([]),
    install: () => Promise.resolve({ ok: false }),
    grantConsent: () => Promise.resolve({ ok: false }),
    remove: () => Promise.resolve(),
    mayLoad: () => Promise.resolve(true),
    installedPlugin: () => Promise.resolve(undefined),
    readProviderOrder: () => Promise.resolve({ version: 1, pluginOrder: [] }),
    writeProviderOrder: () => Promise.resolve({ ok: true }),
    consentRecord: () => Promise.resolve(undefined),
    ...overrides,
  };
}

function consentOf(target: InstalledPlugin) {
  return {
    pluginKey: target.key,
    version: target.manifest.version,
    fingerprint: "yc1-test",
    grantedAt: "2026-11-06T00:00:00Z",
  };
}

const hostApi: HostApiDispatcher = { call: () => Promise.resolve(undefined) };

describe("PluginSensorProvider", () => {
  it("names the contribution id and label and keeps the plugin key", () => {
    const provider = providerWith(supervisorAnswering(() => []));

    expect(provider.id).toBe("acme");
    expect(provider.label).toBe("Acme");
    expect(provider.pluginKey).toBe("local/acme-sensors");
  });

  it("drops a malformed descriptor and records its reason", async () => {
    const provider = providerWith(
      supervisorAnswering(() => [
        descriptor("cpu.load"),
        {
          sensorId: "",
          semanticKey: "gpu.temp",
          label: "GPU",
          tier: "extended",
        },
      ]),
    );

    expect(await provider.describe()).toEqual([descriptor("cpu.load")]);
    expect(provider.health().message).toContain("unreadable");
  });

  it("refuses a unitKind the vocabulary does not declare", async () => {
    const provider = providerWith(
      supervisorAnswering(() => [
        descriptor("cpu.load"),
        { ...descriptor("gpu.temp"), unitKind: "smell" },
      ]),
    );

    expect(await provider.describe()).toEqual([descriptor("cpu.load")]);
  });

  it("drops a descriptor for a key the vocabulary does not declare", async () => {
    const provider = providerWith(
      supervisorAnswering(() => [
        descriptor("cpu.load"),
        descriptor("not.a.real.key"),
      ]),
    );

    expect(await provider.describe()).toEqual([descriptor("cpu.load")]);
    expect(provider.health().message).toContain("unreadable");
  });

  it("accepts a text reading the vocabulary declares", async () => {
    const supervisor = supervisorAnswering((method) =>
      method === "describe"
        ? [descriptor("gpu.name")]
        : [
            {
              semanticKey: "gpu.name",
              sample: {
                sensorId: "acme:gpu.name",
                timestamp: new Date(NOW).toISOString(),
                status: "ok",
                textValue: "Radeon RX 6800",
              },
            },
          ],
    );
    const provider = providerWith(supervisor);
    await provider.describe();

    const [entry] = await provider.sample(["gpu.name"], NOW);

    expect(entry?.sample).toMatchObject({
      status: "ok",
      textValue: "Radeon RX 6800",
    });
  });

  it("refuses an ok reading whose field does not match the key's kind", async () => {
    const supervisor = supervisorAnswering((method) =>
      method === "describe"
        ? [descriptor("gpu.name")]
        : [okEntry("gpu.name", 42)],
    );
    const provider = providerWith(supervisor);
    await provider.describe();

    const [entry] = await provider.sample(["gpu.name"], NOW);

    expect(entry?.sample.status).toBe("unavailable");
    expect(entry?.sample.value).toBeUndefined();
    expect(entry?.sample.message).toBeTruthy();
    expect(provider.health().available).toBe(false);
  });

  it("passes only the requested keys and the context in one params object", async () => {
    const supervisor = supervisorAnswering((method) =>
      method === "describe"
        ? [descriptor("cpu.load"), descriptor("gpu.temp")]
        : [okEntry("cpu.load", 10)],
    );
    const provider = providerWith(supervisor);
    await provider.describe();

    const entries = await provider.sample(["cpu.load", "weather.temp"], NOW, {
      language: "de",
    });

    expect(supervisor.requests.at(-1)).toEqual({
      method: "sample",
      params: {
        semanticKeys: ["cpu.load"],
        nowMs: NOW,
        context: { language: "de" },
      },
    });
    expect(entries).toEqual([okEntry("cpu.load", 10)]);
  });

  it("refuses NaN instead of writing zero", async () => {
    const supervisor = supervisorAnswering((method) =>
      method === "describe"
        ? [descriptor("cpu.load")]
        : [
            {
              semanticKey: "cpu.load",
              sample: {
                sensorId: "acme:cpu.load",
                timestamp: new Date(NOW).toISOString(),
                status: "ok",
                value: Number.NaN,
              },
            },
          ],
    );
    const provider = providerWith(supervisor);
    await provider.describe();

    const entries = await provider.sample(["cpu.load"], NOW);

    expect(entries).toHaveLength(1);
    expect(entries[0]?.sample.status).toBe("unavailable");
    expect(entries[0]?.sample.value).toBeUndefined();
    expect(entries[0]?.sample.message).toBeTruthy();
  });

  it("turns a reading with no finite value into unavailable", async () => {
    const supervisor = supervisorAnswering((method) =>
      method === "describe"
        ? [descriptor("cpu.load")]
        : [
            {
              semanticKey: "cpu.load",
              sample: {
                sensorId: "acme:cpu.load",
                timestamp: new Date(NOW).toISOString(),
                status: "ok",
                value: "10",
              },
            },
          ],
    );
    const provider = providerWith(supervisor);
    await provider.describe();

    const [entry] = await provider.sample(["cpu.load"], NOW);

    expect(entry?.sample.status).toBe("unavailable");
    expect(entry?.sample.value).toBeUndefined();
  });

  it("answers a requested key the plugin omitted with a stated reason", async () => {
    const supervisor = supervisorAnswering((method) =>
      method === "describe" ? [descriptor("cpu.load")] : [],
    );
    const provider = providerWith(supervisor);
    await provider.describe();

    const [entry] = await provider.sample(["cpu.load"], NOW);

    expect(["missing", "unavailable"]).toContain(entry?.sample.status);
    expect(entry?.sample.message).toBeTruthy();
    expect(entry?.sample.value).toBeUndefined();
  });

  it("reads health from the cache without sending a request", async () => {
    const supervisor = supervisorAnswering((method) =>
      method === "describe" ? [descriptor("cpu.load")] : [],
    );
    const provider = providerWith(supervisor);

    provider.health();
    provider.health();

    expect(supervisor.requests).toEqual([]);
  });

  it("updates the cached health and rejects when the supervisor fails", async () => {
    const provider = providerWith({
      alive: true,
      start: () => Promise.resolve(),
      request: () => Promise.reject(new Error("plugin crashed at 10.0.0.5:80")),
      stop: () => Promise.resolve(),
    });

    await expect(provider.sample(["cpu.load"], NOW)).rejects.toThrow();
    expect(provider.health().available).toBe(false);
    expect(provider.health().message).not.toContain("10.0.0.5");
  });
});

describe("orderProviders", () => {
  function tagged(
    id: string,
    pluginKey?: string,
  ): SensorProvider & { readonly pluginKey?: string } {
    return {
      id,
      label: id,
      ...(pluginKey === undefined ? {} : { pluginKey }),
      describe: () => Promise.resolve([]),
      sample: () => Promise.resolve([]),
      health: () => ({ available: true }),
    };
  }

  it("keeps built-ins first and orders plugin rows by the stored keys", () => {
    const builtins = [tagged("os"), tagged("lhm")];
    const plugins = [
      tagged("acme", "local/acme"),
      tagged("beta", "local/beta"),
    ];

    const ordered = orderProviders(builtins, plugins, {
      version: 1,
      pluginOrder: ["local/beta", "local/acme"],
    });

    expect(ordered.map((provider) => provider.id)).toEqual([
      "os",
      "lhm",
      "beta",
      "acme",
    ]);
  });

  it("puts unknown and unlisted plugin keys last in input order", () => {
    const plugins = [
      tagged("unknown", "local/unknown"),
      tagged("acme", "local/acme"),
      tagged("untagged"),
    ];

    const ordered = orderProviders([], plugins, {
      version: 1,
      pluginOrder: ["local/acme"],
    });

    expect(ordered.map((provider) => provider.id)).toEqual([
      "acme",
      "unknown",
      "untagged",
    ]);
  });

  it("ignores an order key no plugin carries and keeps input order", () => {
    const plugins = [
      tagged("alpha", "local/alpha"),
      tagged("beta", "local/beta"),
    ];

    const ordered = orderProviders([], plugins, {
      version: 1,
      pluginOrder: ["local/gone"],
    });

    expect(ordered.map((provider) => provider.id)).toEqual(["alpha", "beta"]);
  });
});

describe("provider order store", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), "yunari-provider-order-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("reads an empty order and stores what it is given", async () => {
    const store = createProviderOrderStore(
      path.join(dir, "provider-order.json"),
    );

    expect(await store.read()).toEqual({ version: 1, pluginOrder: [] });

    await store.write({
      version: 1,
      pluginOrder: ["local/beta", "local/acme"],
    });
    expect(await store.read()).toEqual({
      version: 1,
      pluginOrder: ["local/beta", "local/acme"],
    });
  });

  it("ignores a file it did not write", async () => {
    const file = path.join(dir, "provider-order.json");
    await writeFile(file, JSON.stringify({ version: 2, pluginOrder: [] }));

    expect(await createProviderOrderStore(file).read()).toEqual({
      version: 1,
      pluginOrder: [],
    });
  });
});

describe("extension service provider order", () => {
  function serviceWith(
    plugins: readonly InstalledPlugin[],
    order = memoryOrder(),
  ): ExtensionService {
    return createExtensionService({
      installer: fakeInstaller(plugins),
      consent: memoryConsent(),
      now: () => "2026-11-06T00:00:00Z",
      providerOrder: order,
    });
  }

  it("refuses a provider order naming an uninstalled plugin", async () => {
    const service = serviceWith([plugin()]);

    expect(
      await service.writeProviderOrder({
        version: 1,
        pluginOrder: ["local/gone"],
      }),
    ).toEqual({
      ok: false,
      message: 'No installed extension provides the provider "local/gone".',
    });
  });

  it("accepts and stores the keys of installed provider plugins", async () => {
    const order = memoryOrder();
    const service = serviceWith([plugin()], order);

    expect(
      await service.writeProviderOrder({
        version: 1,
        pluginOrder: ["local/acme-sensors"],
      }),
    ).toEqual({ ok: true });
    expect(await service.readProviderOrder()).toEqual({
      version: 1,
      pluginOrder: ["local/acme-sensors"],
    });
  });

  it("refuses a plugin with no sensor providers as an order key", async () => {
    const service = serviceWith([plugin({ contributes: {} })]);

    expect(
      await service.writeProviderOrder({
        version: 1,
        pluginOrder: ["local/acme-sensors"],
      }),
    ).toEqual({
      ok: false,
      message:
        'No installed extension provides the provider "local/acme-sensors".',
    });
  });
});

describe("createPluginProviders", () => {
  beforeEach(() => {
    supervisorMocks.reset();
  });

  afterEach(() => {
    supervisorMocks.reset();
  });

  it("starts one supervisor per loadable plugin and contributes its providers", async () => {
    const acme = plugin();
    const beta = plugin({
      id: "beta-sensors",
      contributes: { sensorProviders: [{ id: "beta", label: "Beta" }] },
    });
    const extensions = fakeExtensions({
      consentRecord: (key) =>
        Promise.resolve(
          key === acme.key
            ? consentOf(acme)
            : key === beta.key
              ? consentOf(beta)
              : undefined,
        ),
    });

    const runtime = await createPluginProviders({
      installer: fakeInstaller([acme, beta]),
      extensions,
      hostApi,
    });

    expect(supervisorMocks.created).toHaveLength(2);
    expect(supervisorMocks.created.map((s) => s.starts)).toEqual([1, 1]);
    expect(runtime.providers.map((provider) => provider.id)).toEqual([
      "acme",
      "beta",
    ]);
  });

  it("uses a shared supervisor map instead of starting its own", async () => {
    const acme = plugin();
    const shared: PluginSupervisor = {
      alive: true,
      start: () => Promise.resolve(),
      request: <T>() => Promise.resolve(undefined as T),
      stop: () => Promise.resolve(),
    };

    const runtime = await createPluginProviders({
      installer: fakeInstaller([acme]),
      extensions: fakeExtensions({
        consentRecord: () => Promise.resolve(consentOf(acme)),
      }),
      hostApi,
      supervisors: new Map([[acme.key, shared]]),
    });

    expect(supervisorMocks.created).toEqual([]);
    expect(runtime.providers.map((provider) => provider.id)).toEqual(["acme"]);
  });

  it("skips plugins that are not trusted workers or contribute no providers", async () => {
    const data = plugin({ id: "data-only", execution: "data" });
    const nothing = plugin({ id: "nothing", contributes: {} });

    const runtime = await createPluginProviders({
      installer: fakeInstaller([data, nothing]),
      // Both would be loadable and consented, so only the provider-plugin
      // predicate keeps them out.
      extensions: fakeExtensions({
        consentRecord: (key) =>
          Promise.resolve(
            key === data.key
              ? consentOf(data)
              : key === nothing.key
                ? consentOf(nothing)
                : undefined,
          ),
      }),
      hostApi,
    });

    expect(supervisorMocks.created).toEqual([]);
    expect(runtime.providers).toEqual([]);
  });

  it("skips a plugin that may not load", async () => {
    const acme = plugin();
    const runtime = await createPluginProviders({
      installer: fakeInstaller([acme]),
      extensions: fakeExtensions({
        mayLoad: () => Promise.resolve(false),
        consentRecord: () => Promise.resolve(consentOf(acme)),
      }),
      hostApi,
    });

    expect(supervisorMocks.created).toEqual([]);
    expect(runtime.providers).toEqual([]);
  });

  it("makes one provider for a plugin with several contributions", async () => {
    const acme = plugin({
      contributes: {
        sensorProviders: [
          { id: "acme", label: "Acme" },
          { id: "acme-two", label: "Acme Two" },
        ],
      },
    });

    const runtime = await createPluginProviders({
      installer: fakeInstaller([acme]),
      extensions: fakeExtensions({
        consentRecord: () => Promise.resolve(consentOf(acme)),
      }),
      hostApi,
    });

    expect(supervisorMocks.created).toHaveLength(1);
    expect(runtime.providers).toHaveLength(1);
    expect(runtime.providers.map((provider) => provider.id)).toEqual(["acme"]);
  });

  it("reports a failed start and keeps every other plugin", async () => {
    const first = plugin();
    const second = plugin({
      id: "beta-sensors",
      contributes: { sensorProviders: [{ id: "beta", label: "Beta" }] },
    });
    let calls = 0;
    supervisorMocks.setNext(() =>
      ++calls === 1 ? { startMode: "reject" } : {},
    );
    const onFailure = vi.fn();

    const runtime = await createPluginProviders({
      installer: fakeInstaller([first, second]),
      extensions: fakeExtensions({
        consentRecord: (key) =>
          Promise.resolve(
            key === first.key
              ? consentOf(first)
              : key === second.key
                ? consentOf(second)
                : undefined,
          ),
      }),
      hostApi,
      onFailure,
    });

    expect(onFailure).toHaveBeenCalledTimes(1);
    expect(onFailure).toHaveBeenCalledWith(first.key, "plugin did not start");
    expect(runtime.providers.map((provider) => provider.id)).toEqual(["beta"]);
  });

  it("reports a crash and stops every started supervisor exactly once", async () => {
    const acme = plugin();
    const onFailure = vi.fn();
    const onCrash = vi.fn();
    const runtime = await createPluginProviders({
      installer: fakeInstaller([acme]),
      extensions: fakeExtensions({
        consentRecord: () => Promise.resolve(consentOf(acme)),
      }),
      hostApi,
      onFailure,
      onCrash,
    });

    supervisorMocks.created[0]?.options?.onCrash?.("plugin crashed");
    expect(onFailure).toHaveBeenCalledWith(acme.key, "plugin crashed");
    // The host closes the crashed worker's devices; the worker cannot.
    expect(onCrash).toHaveBeenCalledWith(acme.key);

    await runtime.stop();
    await runtime.stop();

    expect(supervisorMocks.created).toHaveLength(1);
    expect(supervisorMocks.created[0]?.stops).toBe(1);
  });
});
