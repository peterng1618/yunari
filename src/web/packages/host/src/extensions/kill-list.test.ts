import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type {
  InstalledPlugin,
  PluginInstaller,
  PluginManifest,
} from "@yunari/extension-api";
import { afterEach, describe, expect, it } from "vitest";
import { createConsentStore } from "./consent-store.js";
import {
  createKillListStore,
  type KillList,
  type KillListStore,
  readKillList,
} from "./kill-list.js";
import { createExtensionService } from "./service.js";

const GENERATED_AT = "2026-11-06T00:00:00Z";
const KEY = "acme/acme-sensors";

function document(plugins: Record<string, unknown>): unknown {
  return { version: 1, generatedAt: GENERATED_AT, plugins };
}

describe("readKillList", () => {
  it("ignores unknown fields", () => {
    expect(
      readKillList({
        version: 1,
        generatedAt: GENERATED_AT,
        plugins: { [KEY]: { advisory: "https://example.test", note: "old" } },
        future: true,
      }),
    ).toEqual({
      version: 1,
      generatedAt: GENERATED_AT,
      plugins: { [KEY]: { advisory: "https://example.test" } },
    });
  });

  it("drops an entry whose advisory link is not safe to follow", () => {
    expect(
      readKillList(
        document({
          [KEY]: { advisory: "javascript:alert(1)" },
          "acme/other": {},
        }),
      ).plugins,
    ).toEqual({ "acme/other": {} });
  });

  it("throws for a document that is not a kill list", () => {
    expect(() => readKillList({ version: 2, plugins: {} })).toThrow();
    expect(() => readKillList(null)).toThrow();
  });
});

const temporary: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporary.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

describe("createKillListStore", () => {
  it("caches the fetched list and keeps it when a later fetch fails", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "yunari-kill-"));
    temporary.push(directory);
    let body: unknown = document({ [KEY]: {} });
    let fail = false;
    const store = createKillListStore({
      directory,
      origin: "https://store.test",
      fetch: (async () => {
        if (fail) throw new Error("offline");
        return Response.json(body);
      }) as typeof fetch,
      now: () => "2026-11-07T00:00:00Z",
    });

    expect(await store.isKilled(KEY)).toBe(false);
    await store.refresh();
    expect(await store.isKilled(KEY)).toBe(true);

    fail = true;
    body = document({ "acme/other": {} });
    await store.refresh();
    // The cached list still names the plugin the failed fetch would have
    // replaced.
    expect(await store.isKilled(KEY)).toBe(true);
    expect(await store.isKilled("acme/other")).toBe(false);

    expect(
      JSON.parse(
        await readFile(path.join(directory, "kill-list.json"), "utf8"),
      ),
    ).toEqual(document({ [KEY]: {} }));
  });

  it("keeps a cached list whose fetch fails to parse", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "yunari-kill-"));
    temporary.push(directory);
    const store = createKillListStore({
      directory,
      origin: "https://store.test",
      fetch: (async () => new Response("not json")) as typeof fetch,
      now: () => GENERATED_AT,
    });
    await store.refresh();
    expect(await store.load()).toEqual({
      version: 1,
      generatedAt: GENERATED_AT,
      plugins: {},
    });
  });

  it("kills nothing without a cache or an origin", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "yunari-kill-"));
    temporary.push(directory);
    const store = createKillListStore({
      directory,
      origin: undefined,
      fetch: (async () =>
        Response.json(document({ [KEY]: {} }))) as typeof fetch,
      now: () => GENERATED_AT,
    });
    await store.refresh();
    expect(await store.isKilled(KEY)).toBe(false);
    await writeFile(path.join(directory, "kill-list.json"), "{}");
    expect(await store.isKilled(KEY)).toBe(false);
  });
});

function manifest(): PluginManifest {
  return {
    manifestVersion: 1,
    id: "acme-sensors",
    name: "Acme Sensors",
    version: "1.0.0",
    description: "Reads the room's sensors.",
    engines: { yunari: ">=0.1.0" },
    pluginApi: 1,
    execution: "trusted-worker",
    capabilities: [],
    contributes: {},
    main: "main.js",
  };
}

function plantedPlugin(): InstalledPlugin {
  return {
    key: KEY,
    publisher: "acme",
    manifest: manifest(),
    directory: "/nowhere",
    contentHash: "hash",
  };
}

function installerOf(plugin: InstalledPlugin): PluginInstaller {
  return {
    list: async () => [plugin],
    read: async (key) => (key === plugin.key ? plugin : undefined),
    install: async () => ({ ok: false, message: "not used" }),
    remove: async () => undefined,
  };
}

function fixedKillList(killed: KillList): KillListStore {
  return {
    load: async () => killed,
    isKilled: async (key) => Object.hasOwn(killed.plugins, key),
    refresh: async () => undefined,
  };
}

describe("a killed plugin", () => {
  it("does not load even with its consent granted", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "yunari-kill-"));
    temporary.push(directory);
    const consent = createConsentStore(directory);
    const lists: KillList[] = [
      { version: 1, generatedAt: GENERATED_AT, plugins: {} },
      { version: 1, generatedAt: GENERATED_AT, plugins: { [KEY]: {} } },
    ];
    const services = lists.map((list) =>
      createExtensionService({
        installer: installerOf(plantedPlugin()),
        consent,
        killList: fixedKillList(list),
        now: () => GENERATED_AT,
        providerOrder: {
          read: async () => ({ version: 1, pluginOrder: [] }),
          write: async () => undefined,
        },
      }),
    );

    const [listed] = await services[0]!.list();
    if (listed === undefined) throw new Error("no extension listed");
    expect(await services[0]!.grantConsent(KEY, listed.fingerprint)).toEqual({
      ok: true,
    });

    expect(await services[0]!.mayLoad(KEY)).toBe(true);
    expect(await services[1]!.mayLoad(KEY)).toBe(false);
  });
});
