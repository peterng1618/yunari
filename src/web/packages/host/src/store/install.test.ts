import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { InstalledPlugin, PluginManifest } from "@yunari/extension-api";
import type { CatalogueOrigin, StoreItemKind } from "@yunari/renderer-core";
import {
  EDITOR_THEME_TOKENS,
  MAX_ARCHIVE_BYTES,
  writeEditorThemePackage,
} from "@yunari/theme-package";
import { strToU8, zipSync } from "fflate";
import { afterEach, describe, expect, it } from "vitest";
import type { ExtensionService } from "../extensions/service.js";
import type { WidgetPackStore } from "../packs/widget-packs.js";
import {
  createPathPresetStore,
  type PathPresetStore,
} from "../presets/path-presets.js";
import {
  type CatalogueOriginsStore,
  catalogueOriginKey,
} from "../settings/catalogue-origins.js";
import type { ThemeStore } from "../themes/store.js";
import {
  type CatalogueInstallRequest,
  type CatalogueInstallStores,
  installCatalogueItem,
  planCollection,
} from "./install.js";

const ORIGIN = "https://store.test";
const WIDGET_PACK_BYTES = zipSync(
  {
    "manifest.json": strToU8(
      JSON.stringify({
        format: "yunari-widget-package",
        version: 1,
        widget: "widget.json",
      }),
    ),
    "widget.json": strToU8(
      JSON.stringify({
        schemaVersion: "3.0.0",
        fabricVersion: "7.4.0",
        id: "starter",
        metadata: { themeLanguage: "en", name: "Starter Cards" },
        globals: {},
        scene: { version: "7.4.0", objects: [] },
      }),
    ),
  },
  { level: 0 },
);

const temporary: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporary.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

function widgetStore(install: WidgetPackStore["install"]): WidgetPackStore {
  return {
    list: async () => [],
    read: async () => undefined,
    install,
    remove: async () => undefined,
  };
}

function stores(
  overrides: Partial<CatalogueInstallStores> = {},
): CatalogueInstallStores {
  return {
    theme: {
      store: {} as ThemeStore,
      origins: {} as CatalogueOriginsStore,
    },
    widgetPacks: widgetStore(async () => ({
      ok: true,
      pack: {
        id: "starter",
        name: "Starter Cards",
        version: undefined,
        units: [],
      },
    })),
    ...overrides,
  };
}

function extensionService(
  overrides: Partial<ExtensionService> = {},
): ExtensionService {
  return {
    list: async () => [],
    install: async () => ({ ok: false, message: "not used" }),
    grantConsent: async () => ({ ok: false }),
    remove: async () => undefined,
    mayLoad: async () => false,
    installedPlugin: async () => undefined,
    consentRecord: async () => undefined,
    readProviderOrder: async () => ({ version: 1, pluginOrder: [] }),
    writeProviderOrder: async () => ({ ok: true }),
    ...overrides,
  };
}

function request(
  kind: StoreItemKind,
  overrides: Partial<CatalogueInstallRequest> = {},
): CatalogueInstallRequest {
  return {
    packageUrl: `${ORIGIN}/catalogue/6041df49-9c61-4d51-a184-716890560bdb/1.0.0.zip`,
    catalogueId: "6041df49-9c61-4d51-a184-716890560bdb",
    kind,
    version: "1.0.0",
    sha256: "00",
    bytes: WIDGET_PACK_BYTES.byteLength,
    publisher: "acme",
    ...overrides,
  };
}

function fetchBytes(bytes: Uint8Array): typeof fetch {
  return (async () =>
    new Response(bytes as unknown as BodyInit)) as unknown as typeof fetch;
}

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

function pluginPackage(): Uint8Array {
  return zipSync(
    {
      "yunari-plugin.json": strToU8(JSON.stringify(manifest())),
      "main.js": strToU8("export default {};"),
    },
    { level: 0 },
  );
}

async function digestOf(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    bytes as unknown as BufferSource,
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

describe("installCatalogueItem", () => {
  it("refuses a download whose digest differs", async () => {
    const result = await installCatalogueItem(
      request("widget-pack", { sha256: "00" }),
      {
        fetch: fetchBytes(WIDGET_PACK_BYTES),
        stores: stores(),
        storeOrigin: ORIGIN,
      },
    );

    expect(result).toMatchObject({ ok: false, stage: "integrity" });
  });

  it("refuses a download whose size differs", async () => {
    const result = await installCatalogueItem(
      request("widget-pack", {
        sha256: await digestOf(WIDGET_PACK_BYTES),
        bytes: WIDGET_PACK_BYTES.byteLength + 1,
      }),
      {
        fetch: fetchBytes(WIDGET_PACK_BYTES),
        stores: stores(),
        storeOrigin: ORIGIN,
      },
    );

    expect(result).toMatchObject({ ok: false, stage: "integrity" });
  });

  it("hands a verified widget pack to the widget store", async () => {
    const result = await installCatalogueItem(
      request("widget-pack", { sha256: await digestOf(WIDGET_PACK_BYTES) }),
      {
        fetch: fetchBytes(WIDGET_PACK_BYTES),
        stores: stores(),
        storeOrigin: ORIGIN,
      },
    );

    expect(result).toEqual({ ok: true, id: "starter", consentRequired: false });
  });

  it("refuses an address outside the configured store origin", async () => {
    const result = await installCatalogueItem(
      request("widget-pack", {
        packageUrl: `https://evil.example/catalogue/x/1.0.0.zip`,
        sha256: await digestOf(WIDGET_PACK_BYTES),
      }),
      {
        fetch: fetchBytes(WIDGET_PACK_BYTES),
        stores: stores(),
        storeOrigin: ORIGIN,
      },
    );

    expect(result).toMatchObject({ ok: false, stage: "address" });
  });

  it("takes a plugin's consent need from its package, not the request", async () => {
    const bytes = pluginPackage();
    const plugin: InstalledPlugin = {
      key: "acme/acme-sensors",
      publisher: "acme",
      manifest: manifest(),
      directory: "/nowhere",
      contentHash: "hash",
    };
    const result = await installCatalogueItem(
      request("plugin", {
        sha256: await digestOf(bytes),
        bytes: bytes.byteLength,
        executionProfile: "data",
      }),
      {
        fetch: fetchBytes(bytes),
        storeOrigin: ORIGIN,
        stores: stores({
          extensions: {
            list: async () => [],
            install: async () => ({ ok: true, plugin }),
            grantConsent: async () => ({ ok: true }),
            remove: async () => undefined,
            mayLoad: async () => false,
            installedPlugin: async () => undefined,
            consentRecord: async () => undefined,
            readProviderOrder: async () => ({ version: 1, pluginOrder: [] }),
            writeProviderOrder: async () => ({ ok: true }),
          },
        }),
      },
    );

    expect(result).toEqual({
      ok: true,
      id: "acme/acme-sensors",
      consentRequired: true,
    });
  });

  it("carries a held update out as the review stage", async () => {
    const bytes = pluginPackage();
    const held = {
      key: "local/acme-sensors",
      name: "Acme Sensors",
      publisher: "local",
      reasons: ["capability:sensor:provide"],
    };
    const result = await installCatalogueItem(
      request("plugin", {
        sha256: await digestOf(bytes),
        bytes: bytes.byteLength,
      }),
      {
        fetch: fetchBytes(bytes),
        storeOrigin: ORIGIN,
        stores: stores({
          extensions: extensionService({
            install: async () => ({ ok: false, held }),
          }),
        }),
      },
    );

    expect(result).toEqual({
      ok: false,
      stage: "review",
      message: expect.any(String),
      held,
    });
  });

  it("passes the approval press through to the plugin installer", async () => {
    const bytes = pluginPackage();
    const calls: unknown[] = [];
    const result = await installCatalogueItem(
      request("plugin", {
        sha256: await digestOf(bytes),
        bytes: bytes.byteLength,
        approveUpdate: true,
      }),
      {
        fetch: fetchBytes(bytes),
        storeOrigin: ORIGIN,
        stores: stores({
          extensions: extensionService({
            install: async (_bytes, options) => {
              calls.push(options);
              return {
                ok: true,
                plugin: {
                  key: "local/acme-sensors",
                  publisher: "local",
                  manifest: manifest(),
                  directory: "/nowhere",
                  contentHash: "hash",
                },
              };
            },
          }),
        }),
      },
    );

    expect(result).toMatchObject({ ok: true, id: "local/acme-sensors" });
    expect(calls).toEqual([{ approveUpdate: true }]);
  });

  it("writes an editor theme package where the import control reads it", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "yunari-editor-"));
    temporary.push(directory);
    const written = writeEditorThemePackage({
      name: "Paper",
      tokens: Object.fromEntries(
        EDITOR_THEME_TOKENS.map((token) => [token, "#123456"]),
      ),
    });
    if (!written.ok) throw new Error(written.message);
    const bytes = written.bytes;

    const result = await installCatalogueItem(
      request("editor-theme", {
        sha256: await digestOf(bytes),
        bytes: bytes.byteLength,
      }),
      {
        fetch: fetchBytes(bytes),
        storeOrigin: ORIGIN,
        stores: stores({ editorThemesDirectory: directory }),
      },
    );

    expect(result).toMatchObject({
      ok: true,
      id: request("editor-theme").catalogueId,
    });
    expect(
      new Uint8Array(
        await readFile(
          path.join(
            directory,
            `${request("editor-theme").catalogueId}.yunari-theme`,
          ),
        ),
      ),
    ).toEqual(bytes);
  });
});

/** A collection's members are listings, so every test serves `item.json`
 *  beside the package it describes. */
const COLLECTION_ID = "11111111-1111-4111-8111-111111111111";
const WIDGET_A_ID = "33333333-3333-4333-8333-333333333333";
const WIDGET_B_ID = "44444444-4444-4444-8444-444444444444";
const PLUGIN_ID = "55555555-5555-4555-8555-555555555555";
const PLUGIN_B_ID = "66666666-6666-4666-8666-666666666666";

const WIDGET_B_BYTES = zipSync(
  {
    "manifest.json": strToU8(
      JSON.stringify({
        format: "yunari-widget-package",
        version: 1,
        widget: "widget.json",
      }),
    ),
    "widget.json": strToU8(
      JSON.stringify({
        schemaVersion: "3.0.0",
        fabricVersion: "7.4.0",
        id: "extra",
        metadata: { themeLanguage: "en", name: "Extra Cards" },
        globals: {},
        scene: { version: "7.4.0", objects: [] },
      }),
    ),
  },
  { level: 0 },
);

function panelManifest(): PluginManifest {
  return {
    ...manifest(),
    capabilities: ["panel:drive", "usb:device"],
    contributes: {
      panelFamilies: [
        {
          id: "acme-panel",
          label: "Acme Panel",
          vendorId: 0x0a12,
          productId: 1,
          geometry: { width: 320, height: 320 },
          support: {
            maker: "Acme",
            hardwareRevision: "rev-a",
            supportedFirmware: ["1.0.0"],
            updatedAt: "2026-11-06",
          },
          commands: ["hello"],
          transports: ["usb"],
        },
      ],
    },
  };
}

function panelPackage(): Uint8Array {
  return zipSync(
    {
      "yunari-plugin.json": strToU8(JSON.stringify(panelManifest())),
      "main.js": strToU8("export default {};"),
    },
    { level: 0 },
  );
}

function collectionBytes(
  includes: readonly { readonly id: string; readonly optional?: boolean }[],
): Uint8Array {
  return strToU8(
    JSON.stringify({
      format: "yunari-collection-package",
      version: 1,
      name: "Ops Pack",
      description: "A set for one screen.",
      includes,
    }),
  );
}

function itemUrl(id: string): string {
  return `${ORIGIN}/catalogue/${id}/item.json`;
}

function packageUrl(id: string): string {
  return `${ORIGIN}/catalogue/${id}/1.0.0.zip`;
}

async function itemJson(input: {
  readonly id: string;
  readonly kind: StoreItemKind;
  readonly name: string;
  readonly bytes: Uint8Array;
  readonly sha256?: string;
  readonly size?: number;
}): Promise<Uint8Array> {
  return strToU8(
    JSON.stringify({
      kind: input.kind,
      name: input.name,
      version: "1.0.0",
      createdAt: "2026-11-01T00:00:00Z",
      updatedAt: "2026-11-02T00:00:00Z",
      downloads: 0,
      favorites: 0,
      packageUrl: packageUrl(input.id),
      thumbnail: "catalogue/thumb.png",
      members: [],
      sha256: input.sha256 ?? (await digestOf(input.bytes)),
      bytes: input.size ?? input.bytes.byteLength,
      publisher: "acme",
    }),
  );
}

function storeFetch(
  routes: ReadonlyMap<string, Uint8Array | number | Response>,
): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const body = routes.get(String(input));
    if (body === undefined) return new Response("Not found", { status: 404 });
    if (body instanceof Response) return body;
    if (typeof body === "number")
      return new Response("Refused", { status: body });
    return new Response(body as unknown as BodyInit);
  }) as unknown as typeof fetch;
}

function memoryOrigins(
  initial: Readonly<Record<string, CatalogueOrigin>> = {},
): CatalogueOriginsStore & {
  readonly rows: () => Record<string, CatalogueOrigin>;
} {
  let rows: Record<string, CatalogueOrigin> = { ...initial };
  return {
    read: async () => ({ ...rows }),
    write: async (kind, installedId, origin) => {
      rows = { ...rows, [catalogueOriginKey(kind, installedId)]: origin };
    },
    remove: async (kind, installedId) => {
      const { [catalogueOriginKey(kind, installedId)]: _gone, ...rest } = rows;
      rows = rest;
    },
    rows: () => ({ ...rows }),
  };
}

async function collectionRequest(
  bytes: Uint8Array,
  overrides: Partial<CatalogueInstallRequest> = {},
): Promise<CatalogueInstallRequest> {
  return {
    packageUrl: packageUrl(COLLECTION_ID),
    catalogueId: COLLECTION_ID,
    kind: "collection",
    version: "1.0.0",
    sha256: await digestOf(bytes),
    bytes: bytes.byteLength,
    publisher: "acme",
    ...overrides,
  };
}

/** One widget pack the test can count, answering its own id. */
function countingWidgetStore(
  id: string,
  calls: string[],
  outcome: "ok" | "fail" = "ok",
): WidgetPackStore {
  return widgetStore(async () => {
    calls.push(id);
    if (outcome === "fail") return { ok: false, message: "disk full" };
    return {
      ok: true,
      pack: { id, name: id, version: undefined, units: [] },
    };
  });
}

describe("collection install and plan", () => {
  it("refuses the collection and writes nothing when one member is unpublished", async () => {
    const bytes = collectionBytes([{ id: WIDGET_A_ID }, { id: WIDGET_B_ID }]);
    const calls: string[] = [];
    const routes = new Map<string, Uint8Array | number>([
      [packageUrl(COLLECTION_ID), bytes],
      [
        itemUrl(WIDGET_A_ID),
        await itemJson({
          id: WIDGET_A_ID,
          kind: "widget-pack",
          name: "A",
          bytes: WIDGET_PACK_BYTES,
        }),
      ],
      [packageUrl(WIDGET_A_ID), WIDGET_PACK_BYTES],
      [itemUrl(WIDGET_B_ID), 404],
    ]);

    const result = await installCatalogueItem(await collectionRequest(bytes), {
      fetch: storeFetch(routes),
      stores: stores({
        widgetPacks: countingWidgetStore("starter", calls),
      }),
      storeOrigin: ORIGIN,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain(WIDGET_B_ID);
    expect(calls).toEqual([]);
  });

  it("refuses the collection and writes nothing when a member's hash does not match", async () => {
    const bytes = collectionBytes([{ id: WIDGET_A_ID }]);
    const calls: string[] = [];
    const routes = new Map<string, Uint8Array | number>([
      [packageUrl(COLLECTION_ID), bytes],
      [
        itemUrl(WIDGET_A_ID),
        await itemJson({
          id: WIDGET_A_ID,
          kind: "widget-pack",
          name: "A",
          bytes: WIDGET_PACK_BYTES,
          sha256: "00",
        }),
      ],
      [packageUrl(WIDGET_A_ID), WIDGET_PACK_BYTES],
    ]);

    const result = await installCatalogueItem(await collectionRequest(bytes), {
      fetch: storeFetch(routes),
      stores: stores({
        widgetPacks: countingWidgetStore("starter", calls),
      }),
      storeOrigin: ORIGIN,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain(WIDGET_A_ID);
    expect(calls).toEqual([]);
  });

  it("refuses a paint-inconsistent path preset pack before writing any member", async () => {
    const preset = strToU8(
      JSON.stringify({
        format: "yunari-path-preset-pack",
        version: 1,
        id: "bad",
        name: "Bad Shapes",
        presets: [
          {
            id: "bad",
            label: "Bad",
            // A closed path draws a fill; the pack declares a stroke.
            data: "M 0 0 L 10 0 L 10 10 Z",
            paint: "stroke",
          },
        ],
      }),
    );
    const bytes = collectionBytes([
      { id: WIDGET_A_ID },
      { id: "66666666-6666-4666-8666-666666666666" },
    ]);
    const calls: string[] = [];
    const routes = new Map<string, Uint8Array | number>([
      [packageUrl(COLLECTION_ID), bytes],
      [
        itemUrl(WIDGET_A_ID),
        await itemJson({
          id: WIDGET_A_ID,
          kind: "widget-pack",
          name: "A",
          bytes: WIDGET_PACK_BYTES,
        }),
      ],
      [packageUrl(WIDGET_A_ID), WIDGET_PACK_BYTES],
      [
        itemUrl("66666666-6666-4666-8666-666666666666"),
        await itemJson({
          id: "66666666-6666-4666-8666-666666666666",
          kind: "path-preset-pack",
          name: "Bad Shapes",
          bytes: preset,
        }),
      ],
      [packageUrl("66666666-6666-4666-8666-666666666666"), preset],
    ]);

    const result = await installCatalogueItem(await collectionRequest(bytes), {
      fetch: storeFetch(routes),
      stores: stores({
        widgetPacks: countingWidgetStore("starter", calls),
        pathPresets: {} as PathPresetStore,
      }),
      storeOrigin: ORIGIN,
    });

    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.message).toContain("66666666-6666-4666-8666-666666666666");
    expect(calls).toEqual([]);
  });

  it("installs only the chosen optional members", async () => {
    const bytes = collectionBytes([
      { id: WIDGET_A_ID },
      { id: WIDGET_B_ID, optional: true },
    ]);
    const calls: string[] = [];
    const routes = new Map<string, Uint8Array | number>([
      [packageUrl(COLLECTION_ID), bytes],
      [
        itemUrl(WIDGET_A_ID),
        await itemJson({
          id: WIDGET_A_ID,
          kind: "widget-pack",
          name: "A",
          bytes: WIDGET_PACK_BYTES,
        }),
      ],
      [packageUrl(WIDGET_A_ID), WIDGET_PACK_BYTES],
    ]);

    const result = await installCatalogueItem(
      await collectionRequest(bytes, { items: [WIDGET_A_ID] }),
      {
        fetch: storeFetch(routes),
        stores: stores({
          widgetPacks: countingWidgetStore("starter", calls),
        }),
        storeOrigin: ORIGIN,
      },
    );

    expect(result).toMatchObject({
      ok: true,
      members: [{ id: WIDGET_A_ID, ok: true }],
    });
    expect(calls).toEqual(["starter"]);
  });

  it("refuses an omitted required member and names it", async () => {
    const bytes = collectionBytes([
      { id: WIDGET_A_ID },
      { id: WIDGET_B_ID, optional: true },
    ]);
    const calls: string[] = [];
    const routes = new Map<string, Uint8Array | number>([
      [packageUrl(COLLECTION_ID), bytes],
    ]);

    const result = await installCatalogueItem(
      await collectionRequest(bytes, { items: [WIDGET_B_ID] }),
      {
        fetch: storeFetch(routes),
        stores: stores({
          widgetPacks: countingWidgetStore("starter", calls),
        }),
        storeOrigin: ORIGIN,
      },
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain(WIDGET_A_ID);
    expect(calls).toEqual([]);
  });

  it("reports installed and failed members when a later write fails", async () => {
    const bytes = collectionBytes([{ id: WIDGET_A_ID }, { id: WIDGET_B_ID }]);
    const calls: string[] = [];
    let attempt = 0;
    const widgetPacks = widgetStore(async () => {
      attempt += 1;
      if (attempt === 2) return { ok: false, message: "disk full" };
      calls.push("starter");
      return {
        ok: true,
        pack: { id: "starter", name: "A", version: undefined, units: [] },
      };
    });
    const routes = new Map<string, Uint8Array | number>([
      [packageUrl(COLLECTION_ID), bytes],
      [
        itemUrl(WIDGET_A_ID),
        await itemJson({
          id: WIDGET_A_ID,
          kind: "widget-pack",
          name: "A",
          bytes: WIDGET_PACK_BYTES,
        }),
      ],
      [packageUrl(WIDGET_A_ID), WIDGET_PACK_BYTES],
      [
        itemUrl(WIDGET_B_ID),
        await itemJson({
          id: WIDGET_B_ID,
          kind: "widget-pack",
          name: "B",
          bytes: WIDGET_B_BYTES,
        }),
      ],
      [packageUrl(WIDGET_B_ID), WIDGET_B_BYTES],
    ]);

    const result = await installCatalogueItem(await collectionRequest(bytes), {
      fetch: storeFetch(routes),
      stores: stores({ widgetPacks }),
      storeOrigin: ORIGIN,
    });

    expect(result).toMatchObject({
      ok: false,
      members: [
        { id: WIDGET_A_ID, ok: true },
        { id: WIDGET_B_ID, ok: false, reason: "disk full" },
      ],
    });
    expect(calls).toEqual(["starter"]);
  });

  it("skips an already installed member on retry", async () => {
    const bytes = collectionBytes([{ id: WIDGET_A_ID }]);
    const calls: string[] = [];
    const origins = memoryOrigins();
    const routes = new Map<string, Uint8Array | number>([
      [packageUrl(COLLECTION_ID), bytes],
      [
        itemUrl(WIDGET_A_ID),
        await itemJson({
          id: WIDGET_A_ID,
          kind: "widget-pack",
          name: "A",
          bytes: WIDGET_PACK_BYTES,
        }),
      ],
      [packageUrl(WIDGET_A_ID), WIDGET_PACK_BYTES],
    ]);
    const options = {
      fetch: storeFetch(routes),
      stores: stores({ widgetPacks: countingWidgetStore("starter", calls) }),
      storeOrigin: ORIGIN,
      origins,
    };

    const first = await installCatalogueItem(
      await collectionRequest(bytes),
      options,
    );
    // The member's listing and package are gone from the store: the retry is
    // decided from the origin row alone and must still succeed.
    const second = await installCatalogueItem(await collectionRequest(bytes), {
      ...options,
      fetch: storeFetch(new Map([[packageUrl(COLLECTION_ID), bytes]])),
    });

    expect(first).toMatchObject({
      ok: true,
      members: [{ id: WIDGET_A_ID, ok: true }],
    });
    expect(second).toMatchObject({
      ok: true,
      members: [{ id: WIDGET_A_ID, ok: true, reason: "Already installed." }],
    });
    expect(calls).toEqual(["starter"]);
  });

  it("skips a member recorded at another version than the collection's", async () => {
    const bytes = collectionBytes([{ id: WIDGET_A_ID }]);
    const calls: string[] = [];
    // The row holds the member listing's version; the collection request
    // carries its own. The two are unrelated, and presence alone decides.
    const origins = memoryOrigins({
      [catalogueOriginKey("widget-pack", "starter")]: {
        kind: "widget-pack",
        catalogueId: WIDGET_A_ID,
        version: "9.9.9",
        installedAt: "2026-11-01T00:00:00.000Z",
      },
    });
    // The member's listing and package are not served at all: a fetched
    // member would abort this install.
    const routes = new Map<string, Uint8Array | number>([
      [packageUrl(COLLECTION_ID), bytes],
    ]);

    const result = await installCatalogueItem(await collectionRequest(bytes), {
      fetch: storeFetch(routes),
      stores: stores({ widgetPacks: countingWidgetStore("starter", calls) }),
      storeOrigin: ORIGIN,
      origins,
    });

    expect(result).toMatchObject({
      ok: true,
      members: [{ id: WIDGET_A_ID, ok: true, reason: "Already installed." }],
    });
    expect(calls).toEqual([]);
  });

  it("merges a collection into the memberships a copy already records", async () => {
    const bytes = collectionBytes([{ id: WIDGET_A_ID }]);
    const calls: string[] = [];
    const origins = memoryOrigins({
      [catalogueOriginKey("widget-pack", "starter")]: {
        kind: "widget-pack",
        catalogueId: WIDGET_A_ID,
        version: "0.9.0",
        installedAt: "2026-11-01T00:00:00.000Z",
        collections: ["77777777-7777-4777-8777-777777777777"],
      },
    });
    const routes = new Map<string, Uint8Array | number>([
      [packageUrl(COLLECTION_ID), bytes],
      [
        itemUrl(WIDGET_A_ID),
        await itemJson({
          id: WIDGET_A_ID,
          kind: "widget-pack",
          name: "A",
          bytes: WIDGET_PACK_BYTES,
        }),
      ],
      [packageUrl(WIDGET_A_ID), WIDGET_PACK_BYTES],
    ]);

    const result = await installCatalogueItem(await collectionRequest(bytes), {
      fetch: storeFetch(routes),
      stores: stores({ widgetPacks: countingWidgetStore("starter", calls) }),
      storeOrigin: ORIGIN,
      origins,
    });

    expect(result).toMatchObject({ ok: true });
    expect(
      origins.rows()[catalogueOriginKey("widget-pack", "starter")]?.collections,
    ).toEqual(["77777777-7777-4777-8777-777777777777", COLLECTION_ID].sort());
  });

  it("carries a held member update out as the review stage", async () => {
    const pluginBytes = panelPackage();
    const bytes = collectionBytes([{ id: PLUGIN_ID }]);
    const held = {
      key: "local/acme-sensors",
      name: "Acme Sensors",
      publisher: "local",
      reasons: ["capability:sensor:provide"],
    };
    const routes = new Map<string, Uint8Array | number>([
      [packageUrl(COLLECTION_ID), bytes],
      [
        itemUrl(PLUGIN_ID),
        await itemJson({
          id: PLUGIN_ID,
          kind: "plugin",
          name: "Acme Panel",
          bytes: pluginBytes,
        }),
      ],
      [packageUrl(PLUGIN_ID), pluginBytes],
    ]);

    const result = await installCatalogueItem(await collectionRequest(bytes), {
      fetch: storeFetch(routes),
      stores: stores({
        extensions: extensionService({
          install: async () => ({ ok: false, held }),
        }),
      }),
      storeOrigin: ORIGIN,
    });

    expect(result).toMatchObject({ ok: false, stage: "review", held });
  });

  it("plans each code member's capabilities and devices without writing", async () => {
    const pluginBytes = panelPackage();
    const bytes = collectionBytes([{ id: PLUGIN_ID }]);
    const calls: string[] = [];
    const origins = memoryOrigins();
    const routes = new Map<string, Uint8Array | number>([
      [packageUrl(COLLECTION_ID), bytes],
      [
        itemUrl(PLUGIN_ID),
        await itemJson({
          id: PLUGIN_ID,
          kind: "plugin",
          name: "Acme Panel",
          bytes: pluginBytes,
        }),
      ],
      [packageUrl(PLUGIN_ID), pluginBytes],
    ]);

    const planned = await planCollection(await collectionRequest(bytes), {
      fetch: storeFetch(routes),
      stores: stores({
        extensions: extensionService({
          install: async () => {
            calls.push("install");
            return { ok: false, message: "not called" };
          },
        }),
      }),
      storeOrigin: ORIGIN,
      origins,
    });

    expect(planned).toMatchObject({
      ok: true,
      plan: {
        members: [
          {
            id: PLUGIN_ID,
            kind: "plugin",
            optional: false,
            consent: {
              key: "local/acme-sensors",
              name: "Acme Sensors",
              capabilities: ["panel:drive", "usb:device"],
              devices: ["usb:0a12:0001"],
            },
          },
        ],
        missing: [],
        totalBytes: pluginBytes.byteLength,
      },
    });
    expect(calls).toEqual([]);
    expect(origins.rows()).toEqual({});
  });

  it("forwarding a collection's approval press reaches the held member's installer", async () => {
    const pluginBytes = panelPackage();
    const bytes = collectionBytes([{ id: PLUGIN_ID }]);
    const held = {
      key: "local/acme-sensors",
      name: "Acme Sensors",
      publisher: "local",
      reasons: ["capability:sensor:provide"],
    };
    const calls: unknown[] = [];
    const routes = new Map<string, Uint8Array | number>([
      [packageUrl(COLLECTION_ID), bytes],
      [
        itemUrl(PLUGIN_ID),
        await itemJson({
          id: PLUGIN_ID,
          kind: "plugin",
          name: "Acme Panel",
          bytes: pluginBytes,
        }),
      ],
      [packageUrl(PLUGIN_ID), pluginBytes],
    ]);
    const options = {
      fetch: storeFetch(routes),
      stores: stores({
        extensions: extensionService({
          install: async (_bytes, installOptions) => {
            calls.push(installOptions);
            if (installOptions?.approveUpdate !== true)
              return { ok: false, held };
            return {
              ok: true,
              plugin: {
                key: "local/acme-sensors",
                publisher: "local",
                manifest: panelManifest(),
                directory: "/nowhere",
                contentHash: "hash",
              },
            };
          },
        }),
      }),
      storeOrigin: ORIGIN,
    };

    const first = await installCatalogueItem(
      await collectionRequest(bytes),
      options,
    );
    expect(first).toMatchObject({
      ok: false,
      stage: "review",
      held,
      memberId: PLUGIN_ID,
      members: [{ id: PLUGIN_ID, ok: false }],
    });

    // The browser's approval names the held member; without it the member
    // would be held forever.
    const second = await installCatalogueItem(
      await collectionRequest(bytes, { approveMember: PLUGIN_ID }),
      options,
    );
    expect(second).toMatchObject({
      ok: true,
      members: [{ id: PLUGIN_ID, ok: true }],
    });
    expect(calls).toEqual([{ approveUpdate: false }, { approveUpdate: true }]);
  });

  it("approves only the held member and leaves a second grown member held", async () => {
    const pluginBytes = panelPackage();
    const bytes = collectionBytes([{ id: PLUGIN_ID }, { id: PLUGIN_B_ID }]);
    const heldA = {
      key: "local/plugin-a",
      name: "Plugin A",
      publisher: "local",
      reasons: ["capability:sensor:provide"],
    };
    const heldB = {
      key: "local/plugin-b",
      name: "Plugin B",
      publisher: "local",
      reasons: ["capability:usb:device"],
    };
    const installs: boolean[] = [];
    const routes = new Map<string, Uint8Array | number>([
      [packageUrl(COLLECTION_ID), bytes],
      [
        itemUrl(PLUGIN_ID),
        await itemJson({
          id: PLUGIN_ID,
          kind: "plugin",
          name: "Acme Panel",
          bytes: pluginBytes,
        }),
      ],
      [packageUrl(PLUGIN_ID), pluginBytes],
      [
        itemUrl(PLUGIN_B_ID),
        await itemJson({
          id: PLUGIN_B_ID,
          kind: "plugin",
          name: "Acme Panel B",
          bytes: pluginBytes,
        }),
      ],
      [packageUrl(PLUGIN_B_ID), pluginBytes],
    ]);
    const origins = memoryOrigins();
    const options = {
      fetch: storeFetch(routes),
      stores: stores({
        extensions: extensionService({
          install: async (_bytes, installOptions) => {
            const approve = installOptions?.approveUpdate === true;
            installs.push(approve);
            const which = installs.length <= 2 ? "a" : "b";
            if (!approve) {
              return { ok: false, held: which === "a" ? heldA : heldB };
            }
            return {
              ok: true,
              plugin: {
                key: `local/plugin-${which}`,
                publisher: "local",
                manifest: panelManifest(),
                directory: `/nowhere/${which}`,
                contentHash: "hash",
              },
            };
          },
        }),
      }),
      storeOrigin: ORIGIN,
      origins,
    };

    // A holds; B was never attempted, so its growth was never written.
    const first = await installCatalogueItem(
      await collectionRequest(bytes),
      options,
    );
    expect(first).toMatchObject({
      ok: false,
      stage: "review",
      held: heldA,
      memberId: PLUGIN_ID,
      members: [
        { id: PLUGIN_ID, ok: false },
        {
          id: PLUGIN_B_ID,
          ok: false,
          reason: "Not attempted after an earlier member failed.",
        },
      ],
    });
    expect(origins.rows()).toEqual({});

    // Approving A writes A and re-presents B's own notice; B's install never
    // ran with the approval flag.
    const second = await installCatalogueItem(
      await collectionRequest(bytes, { approveMember: PLUGIN_ID }),
      options,
    );
    expect(second).toMatchObject({
      ok: false,
      stage: "review",
      held: heldB,
      memberId: PLUGIN_B_ID,
      members: [
        { id: PLUGIN_ID, ok: true },
        { id: PLUGIN_B_ID, ok: false },
      ],
    });
    expect(
      origins.rows()[catalogueOriginKey("plugin", "local/plugin-a")]
        ?.catalogueId,
    ).toBe(PLUGIN_ID);
    expect(
      origins.rows()[catalogueOriginKey("plugin", "local/plugin-b")],
    ).toBeUndefined();

    // B is approved by its own id, and only then is its growth written.
    const third = await installCatalogueItem(
      await collectionRequest(bytes, { approveMember: PLUGIN_B_ID }),
      options,
    );
    expect(third).toMatchObject({
      ok: true,
      members: [
        { id: PLUGIN_ID, ok: true, reason: "Already installed." },
        { id: PLUGIN_B_ID, ok: true },
      ],
    });
    expect(installs).toEqual([false, true, false, true]);
  });

  it("refuses an approval that names a member this press does not install", async () => {
    const bytes = collectionBytes([
      { id: WIDGET_A_ID },
      { id: WIDGET_B_ID, optional: true },
    ]);
    const routes = new Map<string, Uint8Array | number>([
      [packageUrl(COLLECTION_ID), bytes],
    ]);

    const result = await installCatalogueItem(
      await collectionRequest(bytes, {
        items: [WIDGET_A_ID],
        approveMember: WIDGET_B_ID,
      }),
      {
        fetch: storeFetch(routes),
        stores: stores(),
        storeOrigin: ORIGIN,
      },
    );

    expect(result).toMatchObject({ ok: false, stage: "package" });
  });

  it("reports a plugin member whose installer throws, keeping earlier members", async () => {
    const pluginBytes = panelPackage();
    const bytes = collectionBytes([{ id: WIDGET_A_ID }, { id: PLUGIN_ID }]);
    const calls: string[] = [];
    const routes = new Map<string, Uint8Array | number>([
      [packageUrl(COLLECTION_ID), bytes],
      [
        itemUrl(WIDGET_A_ID),
        await itemJson({
          id: WIDGET_A_ID,
          kind: "widget-pack",
          name: "A",
          bytes: WIDGET_PACK_BYTES,
        }),
      ],
      [packageUrl(WIDGET_A_ID), WIDGET_PACK_BYTES],
      [
        itemUrl(PLUGIN_ID),
        await itemJson({
          id: PLUGIN_ID,
          kind: "plugin",
          name: "Acme Panel",
          bytes: pluginBytes,
        }),
      ],
      [packageUrl(PLUGIN_ID), pluginBytes],
    ]);

    const result = await installCatalogueItem(await collectionRequest(bytes), {
      fetch: storeFetch(routes),
      stores: stores({
        widgetPacks: countingWidgetStore("starter", calls),
        extensions: extensionService({
          install: async () => {
            throw new Error("the extensions directory is read-only");
          },
        }),
      }),
      storeOrigin: ORIGIN,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain(PLUGIN_ID);
    expect(result).toMatchObject({
      ok: false,
      members: [
        { id: WIDGET_A_ID, ok: true },
        {
          id: PLUGIN_ID,
          ok: false,
          reason: "the extensions directory is read-only",
        },
      ],
    });
    expect(calls).toEqual(["starter"]);
  });

  it("plans an installed member the store no longer serves without blocking", async () => {
    const bytes = collectionBytes([{ id: WIDGET_A_ID }]);
    // The member was installed, then unpublished: the register still names it,
    // and the install would skip it before fetching anything.
    const origins = memoryOrigins({
      [catalogueOriginKey("widget-pack", "starter")]: {
        kind: "widget-pack",
        catalogueId: WIDGET_A_ID,
        version: "1.0.0",
        installedAt: "2026-11-01T00:00:00.000Z",
      },
    });
    const routes = new Map<string, Uint8Array | number>([
      [packageUrl(COLLECTION_ID), bytes],
      [itemUrl(WIDGET_A_ID), 404],
    ]);

    const planned = await planCollection(await collectionRequest(bytes), {
      fetch: storeFetch(routes),
      stores: stores(),
      storeOrigin: ORIGIN,
      origins,
    });

    expect(planned).toMatchObject({
      ok: true,
      plan: {
        missing: [],
        members: [
          {
            id: WIDGET_A_ID,
            kind: "widget-pack",
            installedVersion: "1.0.0",
          },
        ],
      },
    });
  });

  it("refuses a second listing whose package reuses an installed pack id", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "yunari-presets-"));
    temporary.push(directory);
    const presets = createPathPresetStore(directory, []);
    const pack = strToU8(
      JSON.stringify({
        format: "yunari-path-preset-pack",
        version: 1,
        id: "shared",
        name: "Shared Shapes",
        presets: [
          {
            id: "star",
            label: "Star",
            data: "M 0 0 L 10 0 L 5 10 Z",
            paint: "fill",
          },
        ],
      }),
    );
    const first = "8f14e45f-ceea-4d67-b1a2-000000000021";
    const second = "8f14e45f-ceea-4d67-b1a2-000000000022";
    const origins = memoryOrigins();

    const all = await digestOf(pack);
    const firstResult = await installCatalogueItem(
      {
        packageUrl: `${ORIGIN}/catalogue/${first}/1.0.0.zip`,
        catalogueId: first,
        kind: "path-preset-pack",
        version: "1.0.0",
        sha256: all,
        bytes: pack.byteLength,
        publisher: "acme",
      },
      {
        fetch: fetchBytes(pack),
        stores: stores({ pathPresets: presets }),
        storeOrigin: ORIGIN,
        origins,
      },
    );
    expect(firstResult).toMatchObject({ ok: true, id: "shared" });

    const secondResult = await installCatalogueItem(
      {
        packageUrl: `${ORIGIN}/catalogue/${second}/1.0.0.zip`,
        catalogueId: second,
        kind: "path-preset-pack",
        version: "1.0.0",
        sha256: all,
        bytes: pack.byteLength,
        publisher: "acme",
      },
      {
        fetch: fetchBytes(pack),
        stores: stores({ pathPresets: presets }),
        storeOrigin: ORIGIN,
        origins,
      },
    );
    expect(secondResult.ok).toBe(false);
    if (!secondResult.ok) expect(secondResult.message).toContain("shared");
    // The first listing's saved rows are untouched.
    expect((await presets.read()).presets.map((preset) => preset.id)).toEqual([
      "pack:shared:star",
    ]);
  });

  it("refuses an oversized member listing under the package byte cap", async () => {
    const bytes = collectionBytes([{ id: WIDGET_A_ID }]);
    const calls: string[] = [];
    const oversized = new Response("{}", {
      headers: {
        "content-length": String(MAX_ARCHIVE_BYTES + 1),
      },
    });
    const routes = new Map<string, Uint8Array | number | Response>([
      [packageUrl(COLLECTION_ID), bytes],
      [itemUrl(WIDGET_A_ID), oversized],
    ]);

    const result = await installCatalogueItem(await collectionRequest(bytes), {
      fetch: storeFetch(routes),
      stores: stores({
        widgetPacks: countingWidgetStore("starter", calls),
      }),
      storeOrigin: ORIGIN,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain("too large");
    expect(calls).toEqual([]);
  });
});
