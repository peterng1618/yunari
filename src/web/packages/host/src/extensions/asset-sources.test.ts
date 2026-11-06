import path from "node:path";
import type {
  InstalledPlugin,
  PluginInstaller,
  PluginManifest,
} from "@yunari/extension-api";
import type { AssetResult } from "@yunari/renderer-core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AssetSource, SourceContext } from "../assets/source.js";
import { createAssetSources } from "../assets/sources.js";
import {
  type CodeAssetSourceContribution,
  createPluginAssetSources,
  PluginAssetSource,
} from "./asset-sources.js";
import { startPluginSupervisors } from "./providers.js";
import type {
  HostApiDispatcher,
  PluginSupervisor,
} from "./runtime/supervisor.js";
import type { ExtensionService } from "./service.js";

const supervisorMocks = vi.hoisted(() => {
  interface FakeSupervisor {
    alive: boolean;
    starts: number;
    stops: number;
    startMode: "resolve" | "reject";
    start(): Promise<void>;
    request<T>(method: string, params: unknown): Promise<T>;
    stop(): Promise<void>;
  }

  const created: FakeSupervisor[] = [];
  let next: "reject" | undefined;

  function make(): FakeSupervisor {
    const supervisor: FakeSupervisor = {
      alive: true,
      starts: 0,
      stops: 0,
      startMode: "resolve",
      async start() {
        supervisor.starts += 1;
        if (supervisor.startMode === "reject") {
          throw new Error("plugin did not start");
        }
      },
      request<T>(): Promise<T> {
        return Promise.resolve(undefined as T);
      },
      async stop() {
        supervisor.stops += 1;
        supervisor.alive = false;
      },
    };
    if (next === "reject") {
      supervisor.startMode = "reject";
      next = undefined;
    }
    created.push(supervisor);
    return supervisor;
  }

  return {
    created,
    make,
    rejectNext() {
      next = "reject";
    },
    reset() {
      created.length = 0;
      next = undefined;
    },
  };
});

vi.mock("./runtime/supervisor.js", () => ({
  createPluginSupervisor: () => supervisorMocks.make(),
}));

function codeContribution(
  overrides: Partial<CodeAssetSourceContribution> = {},
): CodeAssetSourceContribution {
  return {
    id: "plugin-source",
    label: "Plugin Source",
    category: "image",
    body: "grid",
    entry: "code",
    ...overrides,
  };
}

function manifest(overrides: Partial<PluginManifest> = {}): PluginManifest {
  return {
    manifestVersion: 1,
    id: "acme-assets",
    name: "Acme Assets",
    version: "1.0.0",
    description: "Serves the room's artwork.",
    engines: { yunari: ">=0.1.0" },
    pluginApi: 1,
    execution: "trusted-worker",
    capabilities: ["asset:provide"],
    contributes: { assetSources: [codeContribution()] },
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

function result(id: string): AssetResult {
  return {
    id,
    name: id,
    kind: "image",
    preview: "https://example.test/preview.png",
    subtitle: undefined,
    licence: "unknown",
    sourceUrl: "https://example.test",
  };
}

function context(): SourceContext {
  return {
    credential: () => undefined,
    signal: new AbortController().signal,
    fetch: globalThis.fetch,
  };
}

function supervisorAnswering(
  answer: (method: string, params: unknown) => unknown,
): PluginSupervisor & {
  readonly requests: { readonly method: string; readonly params: unknown }[];
} {
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

function sourceWith(
  supervisor: PluginSupervisor,
  contribution = codeContribution(),
): PluginAssetSource {
  return new PluginAssetSource({
    plugin: plugin(),
    supervisor,
    contribution,
  });
}

function builtin(id: string): AssetSource {
  return {
    id,
    label: id,
    category: "image",
    body: "grid",
    requires: undefined,
    configurable: true,
    search: async () => ({ results: [], totalPages: undefined }),
    bytesOf: async () => undefined,
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

function fakeExtensions(
  overrides: Partial<ExtensionService> = {},
): ExtensionService {
  return {
    list: () => Promise.resolve([]),
    install: () => Promise.resolve({ ok: false }),
    grantConsent: () => Promise.resolve({ ok: false }),
    remove: () => Promise.resolve(),
    mayLoad: () => Promise.resolve(true),
    readProviderOrder: () => Promise.resolve({ version: 1, pluginOrder: [] }),
    writeProviderOrder: () => Promise.resolve({ ok: true }),
    consentRecord: (key) => {
      const target = installed.find((entry) => entry.key === key);
      if (target === undefined) return Promise.resolve(undefined);
      return Promise.resolve({
        pluginKey: target.key,
        version: target.manifest.version,
        fingerprint: "yc1-test",
        grantedAt: "2026-11-06T00:00:00Z",
      });
    },
    ...overrides,
  };
}

let installed: readonly InstalledPlugin[] = [];

const hostApi: HostApiDispatcher = { call: () => Promise.resolve(undefined) };

describe("PluginAssetSource", () => {
  it("prefixes plugin result ids and keeps the page shape", async () => {
    const source = new PluginAssetSource({
      plugin: plugin(),
      supervisor: supervisorAnswering(() => ({
        results: [result("a")],
        totalPages: 2,
      })),
      contribution: codeContribution(),
    });

    expect(await source.search("x", 1, context())).toEqual({
      results: [expect.objectContaining({ id: "plugin-source:a" })],
      totalPages: 2,
    });
  });

  it("leaves an id that already names its source alone", async () => {
    const source = sourceWith(
      supervisorAnswering(() => ({
        results: [result("plugin-source:a")],
        totalPages: 1,
      })),
    );

    expect(
      (await source.search("x", 1, context())).results.map((entry) => entry.id),
    ).toEqual(["plugin-source:a"]);
  });

  it("asks with one JSON params object naming the contribution", async () => {
    const supervisor = supervisorAnswering(() => ({
      results: [result("a")],
      totalPages: 1,
    }));
    const source = sourceWith(supervisor);

    await source.search("moon", 3, context());

    expect(supervisor.requests).toEqual([
      {
        method: "asset.search",
        params: { query: "moon", page: 3, source: "plugin-source" },
      },
    ]);
  });

  it("refuses a malformed page with a stated message", async () => {
    const source = sourceWith(
      supervisorAnswering(() => ({
        results: [{ id: "a", kind: "image" }],
        totalPages: 1,
      })),
    );

    await expect(source.search("x", 1, context())).rejects.toThrow(
      /unreadable asset result/i,
    );
  });

  it("never requires a host credential and is not configurable", () => {
    const source = sourceWith(supervisorAnswering(() => undefined));

    expect(source.requires).toBeUndefined();
    expect(source.configurable).toBe(false);
  });

  it("asks for bytes with the contribution and decodes the answer", async () => {
    const supervisor = supervisorAnswering(() => ({
      bytes: Buffer.from("hello").toString("base64"),
      contentType: "image/png",
      filename: "art.png",
    }));
    const source = sourceWith(supervisor);

    const bytes = await source.bytesOf("a", context());

    expect(supervisor.requests).toEqual([
      {
        method: "asset.bytes",
        params: { id: "a", source: "plugin-source" },
      },
    ]);
    expect(new TextDecoder().decode(bytes?.bytes)).toBe("hello");
    expect(bytes?.contentType).toBe("image/png");
    expect(bytes?.filename).toBe("art.png");
  });

  it("answers undefined rather than throwing for an invalid bytes answer", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const source = sourceWith(
      supervisorAnswering(() => ({
        bytes: "aGVsbG8=",
        contentType: "image/png",
        filename: "../../etc/passwd",
      })),
    );

    await expect(source.bytesOf("a", context())).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("answers undefined for a content type with a control character", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const source = sourceWith(
      supervisorAnswering(() => ({
        bytes: "aGVsbG8=",
        contentType: "text/plain\r\nX-Evil: yes",
        filename: "art.png",
      })),
    );

    await expect(source.bytesOf("a", context())).resolves.toBeUndefined();
    warn.mockRestore();
  });

  it("answers undefined for bytes that are not base64", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const source = sourceWith(
      supervisorAnswering(() => ({
        bytes: "not base64!",
        contentType: "image/png",
        filename: "art.png",
      })),
    );

    await expect(source.bytesOf("a", context())).resolves.toBeUndefined();
    warn.mockRestore();
  });
});

describe("createAssetSources", () => {
  it("refuses a plugin source whose id shadows a built-in", () => {
    const pluginSource = sourceWith(
      supervisorAnswering(() => undefined),
      codeContribution({ id: "unsplash" }),
    );

    expect(() =>
      createAssetSources([builtin("unsplash")], [pluginSource]),
    ).toThrow('"unsplash" is already an asset source');
  });

  it("refuses two plugins sharing one id", () => {
    const first = sourceWith(supervisorAnswering(() => undefined));
    const second = sourceWith(supervisorAnswering(() => undefined));

    expect(() => createAssetSources([], [first, second])).toThrow(
      '"plugin-source" is already an asset source',
    );
  });

  it("keeps the built-ins first and appends the plugins", () => {
    const pluginSource = sourceWith(supervisorAnswering(() => undefined));

    expect(
      createAssetSources([builtin("lucide")], [pluginSource]).map(
        (source) => source.id,
      ),
    ).toEqual(["lucide", "plugin-source"]);
  });
});

describe("createPluginAssetSources", () => {
  beforeEach(() => {
    supervisorMocks.reset();
  });

  it("builds one adapter per code contribution from the shared supervisor", async () => {
    installed = [plugin()];
    const supervisor = supervisorAnswering(() => undefined);

    const sources = await createPluginAssetSources({
      installer: fakeInstaller(installed),
      supervisors: new Map([[installed[0]?.key ?? "", supervisor]]),
    });

    expect(sources.map((source) => source.id)).toEqual(["plugin-source"]);
  });

  it("refuses a body the editor does not draw", async () => {
    installed = [
      plugin({
        contributes: {
          assetSources: [codeContribution({ body: "custom-ui" })],
        },
      }),
    ];
    const onFailure = vi.fn();

    const sources = await createPluginAssetSources({
      installer: fakeInstaller(installed),
      supervisors: new Map([
        [installed[0]?.key ?? "", supervisorAnswering(() => undefined)],
      ]),
      onFailure,
    });

    expect(sources).toEqual([]);
    expect(onFailure).toHaveBeenCalledWith(
      installed[0]?.key,
      expect.stringMatching(/body/),
    );
  });

  it("refuses a contribution that asks for a host credential", async () => {
    installed = [
      plugin({
        contributes: {
          assetSources: [codeContribution({ requires: "unsplash" })],
        },
      }),
    ];
    const onFailure = vi.fn();

    const sources = await createPluginAssetSources({
      installer: fakeInstaller(installed),
      supervisors: new Map([
        [installed[0]?.key ?? "", supervisorAnswering(() => undefined)],
      ]),
      onFailure,
    });

    expect(sources).toEqual([]);
    expect(onFailure).toHaveBeenCalledWith(
      installed[0]?.key,
      expect.stringMatching(/credential/),
    );
  });

  it("refuses a font-picker contribution whose rows need font cuts", async () => {
    installed = [
      plugin({
        contributes: {
          assetSources: [codeContribution({ body: "font-picker" })],
        },
      }),
    ];
    const onFailure = vi.fn();

    const sources = await createPluginAssetSources({
      installer: fakeInstaller(installed),
      supervisors: new Map([
        [installed[0]?.key ?? "", supervisorAnswering(() => undefined)],
      ]),
      onFailure,
    });

    expect(sources).toEqual([]);
    expect(onFailure).toHaveBeenCalledWith(
      installed[0]?.key,
      expect.stringMatching(/font-picker/),
    );
  });

  it("adapts any string entry, the rule the manifest itself uses", async () => {
    installed = [
      plugin({
        contributes: {
          assetSources: [codeContribution({ entry: "source.js" })],
        },
      }),
    ];

    const sources = await createPluginAssetSources({
      installer: fakeInstaller(installed),
      supervisors: new Map([
        [installed[0]?.key ?? "", supervisorAnswering(() => undefined)],
      ]),
    });

    expect(sources.map((source) => source.id)).toEqual(["plugin-source"]);
  });

  it("skips a plugin whose worker did not start", async () => {
    installed = [plugin()];

    const sources = await createPluginAssetSources({
      installer: fakeInstaller(installed),
      supervisors: new Map(),
    });

    expect(sources).toEqual([]);
  });
});

describe("startPluginSupervisors", () => {
  beforeEach(() => {
    supervisorMocks.reset();
  });

  it("starts one worker for a plugin contributing providers and code sources", async () => {
    installed = [
      plugin({
        contributes: {
          sensorProviders: [{ id: "acme", label: "Acme" }],
          assetSources: [codeContribution()],
        },
      }),
    ];

    const runtime = await startPluginSupervisors({
      installer: fakeInstaller(installed),
      extensions: fakeExtensions(),
      hostApi,
    });

    expect(supervisorMocks.created).toHaveLength(1);
    expect(runtime.supervisors.get(installed[0]?.key ?? "")).toBeDefined();
  });

  it("starts a worker for any string entry, not only the literal code", async () => {
    installed = [
      plugin({
        contributes: {
          assetSources: [codeContribution({ entry: "source.js" })],
        },
      }),
    ];

    const runtime = await startPluginSupervisors({
      installer: fakeInstaller(installed),
      extensions: fakeExtensions(),
      hostApi,
    });

    expect(supervisorMocks.created).toHaveLength(1);
    expect(runtime.supervisors.get(installed[0]?.key ?? "")).toBeDefined();
  });

  it("starts nothing for a plugin that contributes no code", async () => {
    installed = [plugin({ id: "data-only", execution: "data" })];

    const runtime = await startPluginSupervisors({
      installer: fakeInstaller(installed),
      extensions: fakeExtensions(),
      hostApi,
    });

    expect(supervisorMocks.created).toEqual([]);
    expect(runtime.supervisors.size).toBe(0);
  });

  it("isolates a plugin that fails to start", async () => {
    const first = plugin();
    const second = plugin({
      id: "beta-assets",
      contributes: { assetSources: [codeContribution({ id: "beta-source" })] },
    });
    installed = [first, second];
    supervisorMocks.rejectNext();
    const onFailure = vi.fn();

    const runtime = await startPluginSupervisors({
      installer: fakeInstaller(installed),
      extensions: fakeExtensions(),
      hostApi,
      onFailure,
    });

    expect(onFailure).toHaveBeenCalledWith(first.key, "plugin did not start");
    expect(runtime.supervisors.has(first.key)).toBe(false);
    expect(runtime.supervisors.has(second.key)).toBe(true);
  });

  it("stops every started worker exactly once", async () => {
    installed = [plugin()];

    const runtime = await startPluginSupervisors({
      installer: fakeInstaller(installed),
      extensions: fakeExtensions(),
      hostApi,
    });

    await runtime.stop();
    await runtime.stop();

    expect(supervisorMocks.created[0]?.stops).toBe(1);
  });
});
