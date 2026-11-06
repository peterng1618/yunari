import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { InstalledPlugin, PluginManifest } from "@yunari/extension-api";
import type { StoreItemKind } from "@yunari/renderer-core";
import {
  EDITOR_THEME_TOKENS,
  writeEditorThemePackage,
} from "@yunari/theme-package";
import { strToU8, zipSync } from "fflate";
import { afterEach, describe, expect, it } from "vitest";
import type { WidgetPackStore } from "../packs/widget-packs.js";
import type { ThemeOriginsStore } from "../settings/theme-origins.js";
import type { ThemeStore } from "../themes/store.js";
import {
  type CatalogueInstallRequest,
  type CatalogueInstallStores,
  installCatalogueItem,
} from "./install.js";

const ORIGIN = "https://store.test";
const WIDGET_PACK_BYTES = zipSync(
  {
    "widget.json": strToU8(
      JSON.stringify({
        schemaVersion: "2.0.0",
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

function widgetStore(
  install: WidgetPackStore["install"],
): WidgetPackStore {
  return {
    list: async () => [],
    read: async () => undefined,
    install,
    remove: async () => undefined,
  };
}

function stores(overrides: Partial<CatalogueInstallStores> = {}): CatalogueInstallStores {
  return {
    theme: {
      store: {} as ThemeStore,
      origins: {} as ThemeOriginsStore,
    },
    widgetPacks: widgetStore(async () => ({
      ok: true,
      pack: { id: "starter", name: "Starter Cards", version: undefined, units: [] },
    })),
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
      { fetch: fetchBytes(WIDGET_PACK_BYTES), stores: stores(), storeOrigin: ORIGIN },
    );

    expect(result).toMatchObject({ ok: false, stage: "integrity" });
  });

  it("refuses a download whose size differs", async () => {
    const result = await installCatalogueItem(
      request("widget-pack", {
        sha256: await digestOf(WIDGET_PACK_BYTES),
        bytes: WIDGET_PACK_BYTES.byteLength + 1,
      }),
      { fetch: fetchBytes(WIDGET_PACK_BYTES), stores: stores(), storeOrigin: ORIGIN },
    );

    expect(result).toMatchObject({ ok: false, stage: "integrity" });
  });

  it("hands a verified widget pack to the widget store", async () => {
    const result = await installCatalogueItem(
      request("widget-pack", { sha256: await digestOf(WIDGET_PACK_BYTES) }),
      { fetch: fetchBytes(WIDGET_PACK_BYTES), stores: stores(), storeOrigin: ORIGIN },
    );

    expect(result).toEqual({ ok: true, id: "starter", consentRequired: false });
  });

  it("refuses an address outside the configured store origin", async () => {
    const result = await installCatalogueItem(
      request("widget-pack", {
        packageUrl: `https://evil.example/catalogue/x/1.0.0.zip`,
        sha256: await digestOf(WIDGET_PACK_BYTES),
      }),
      { fetch: fetchBytes(WIDGET_PACK_BYTES), stores: stores(), storeOrigin: ORIGIN },
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

    expect(result).toMatchObject({ ok: true, id: request("editor-theme").catalogueId });
    expect(
      new Uint8Array(
        await readFile(
          path.join(directory, `${request("editor-theme").catalogueId}.yunari-theme`),
        ),
      ),
    ).toEqual(bytes);
  });
});
