import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { Readable, Writable } from "node:stream";
import {
  EDITOR_THEME_TOKENS,
  writeEditorThemePackage,
} from "@yunari/theme-package";
import { strToU8, zipSync } from "fflate";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ExtensionService } from "../extensions/service.js";
import type { PublishedStore } from "../serve/published.js";
import {
  type CatalogueOriginsStore,
  createCatalogueOriginsStore,
} from "../settings/catalogue-origins.js";
import type { ThemeStore } from "../themes/store.js";
import type { HostServerOptions } from "./options.js";
import { createThemeWrites } from "./theme-writes.js";

let running: http.Server | undefined;
let directory: string;
let origins: CatalogueOriginsStore;

/** A real editor theme package, so the listing reads the name the same way an
 *  installed copy would be read. */
function editorThemeBytes(name: string): Uint8Array {
  const written = writeEditorThemePackage({
    name,
    tokens: Object.fromEntries(
      EDITOR_THEME_TOKENS.map((token) => [token, "#101010"]),
    ),
  });
  if (!written.ok) throw new Error(written.message);
  return written.bytes;
}

function handler(): ReturnType<typeof createThemeWrites> {
  return createThemeWrites({
    options: {
      editorThemesDirectory: path.join(directory, "editor-themes"),
    } as unknown as HostServerOptions,
    themeStore: {} as ThemeStore,
    catalogueOrigins: origins,
    thumbnails: undefined,
    themeMedia: undefined,
    fetcher: undefined,
    largeBody: {
      run: async <T>(work: () => Promise<T>): Promise<T> => work(),
    },
    published: {} as PublishedStore,
    now: () => 0,
    storeOrigin: undefined,
    storeSession: undefined,
  });
}

async function start(): Promise<string> {
  const handle = handler();
  const server = http.createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    void handle(request, response, url).then((handled) => {
      if (handled) return;
      response.writeHead(404);
      response.end();
    });
  });
  running = server;

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  return `http://127.0.0.1:${address.port}`;
}

/** One GET from a caller whose address the socket names, which a real loopback
 *  server cannot be asked to lie about. */
function callFrom(
  remoteAddress: string,
  path = "/api/editor-themes",
  headers: Readonly<Record<string, string>> = {},
): Promise<{
  readonly status: number;
  readonly text: string;
}> {
  return new Promise((resolve) => {
    const request = new Readable({
      read() {
        this.push(null);
      },
    }) as unknown as http.IncomingMessage;

    request.method = "GET";
    request.url = path;
    request.headers = { host: "127.0.0.1:5173", ...headers };
    (request as { socket: { remoteAddress: string } }).socket = {
      remoteAddress,
    };

    const chunks: Buffer[] = [];
    let statusCode = 200;
    const response = new Writable({
      write(chunk, _encoding, callback) {
        chunks.push(Buffer.from(chunk));
        callback();
      },
    }) as unknown as http.ServerResponse;

    response.writeHead = ((status: number) => {
      statusCode = status;
      return response;
    }) as unknown as typeof response.writeHead;
    response.end = ((data?: unknown) => {
      if (data) chunks.push(Buffer.from(data as string | Uint8Array));
      resolve({
        status: statusCode,
        text: Buffer.concat(chunks).toString("utf8"),
      });
      return response;
    }) as unknown as typeof response.end;

    void handler()(request, response, new URL(request.url, "http://127.0.0.1"));
  });
}

beforeEach(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), "yunari-editor-themes-"));
  origins = createCatalogueOriginsStore(path.join(directory, "settings"));
});

afterEach(async () => {
  const server = running;
  running = undefined;
  if (server !== undefined) {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  await rm(directory, { recursive: true, force: true });
});

describe("the editor theme listing", () => {
  const catalogueId = "8f14e45f-ceea-4d67-b1a2-000000000003";

  it("lists an installed theme with the catalogue origin it has", async () => {
    const themes = path.join(directory, "editor-themes");
    await mkdir(themes, { recursive: true });
    await writeFile(
      path.join(themes, `${catalogueId}.yunari-theme`),
      editorThemeBytes("Graphite"),
    );
    // Only a `.yunari-theme` file is an installed theme; a stray file is not
    // one the install wrote.
    await writeFile(path.join(themes, "notes.txt"), "hello", "utf8");

    const origin = {
      kind: "editor-theme",
      catalogueId,
      version: "1.0.0",
      installedAt: "2026-11-16T00:00:00.000Z",
    } as const;
    await origins.write("editor-theme", catalogueId, origin);

    const base = await start();
    const listed = await fetch(`${base}/api/editor-themes`);

    expect(listed.status).toBe(200);
    expect(await listed.json()).toEqual([
      { id: catalogueId, name: "Graphite", origin },
    ]);
  });

  it("omits the origin for a theme this host did not take from the catalogue", async () => {
    const themes = path.join(directory, "editor-themes");
    await mkdir(themes, { recursive: true });
    await writeFile(
      path.join(themes, `${catalogueId}.yunari-theme`),
      editorThemeBytes("Graphite"),
    );

    const base = await start();
    const listed = (await (
      await fetch(`${base}/api/editor-themes`)
    ).json()) as Record<string, unknown>[];

    expect(listed).toEqual([{ id: catalogueId, name: "Graphite" }]);
    expect(listed[0]).not.toHaveProperty("origin");
  });

  it("lists nothing when no theme is installed", async () => {
    const base = await start();

    expect(await (await fetch(`${base}/api/editor-themes`)).json()).toEqual([]);
  });

  it("refuses a non-loopback caller", async () => {
    const answer = await callFrom("192.168.1.10");

    expect(answer.status).toBe(403);
    expect(answer.text).toBe("Editor themes are available on this PC only.");
  });
});

describe("the store origin register", () => {
  const theme = {
    kind: "dashboard-theme",
    catalogueId: "8f14e45f-ceea-4d67-b1a2-000000000003",
    version: "1.0.0",
    installedAt: "2026-10-01T00:00:00.000Z",
    collections: ["11111111-1111-4111-8111-111111111111"],
  } as const;
  const plugin = {
    kind: "plugin",
    catalogueId: "55555555-5555-4555-8555-555555555555",
    version: "2.0.0",
    installedAt: "2026-10-02T00:00:00.000Z",
  } as const;

  it("answers every record the register holds", async () => {
    await origins.write("dashboard-theme", "living-room", theme);
    await origins.write("plugin", "acme/sensors", plugin);

    const base = await start();
    const listed = await fetch(`${base}/api/store/origins`);

    expect(listed.status).toBe(200);
    expect(await listed.json()).toEqual({
      origins: expect.arrayContaining([theme, plugin]),
    });
  });

  it("answers an empty register rather than refusing", async () => {
    const base = await start();

    expect(await (await fetch(`${base}/api/store/origins`)).json()).toEqual({
      origins: [],
    });
  });

  it("refuses a non-loopback caller", async () => {
    const answer = await callFrom("192.168.1.10", "/api/store/origins");

    expect(answer.status).toBe(403);
    expect(answer.text).toBe("Store origins are loopback only.");
  });

  it("refuses a page from another origin", async () => {
    const answer = await callFrom("127.0.0.1", "/api/store/origins", {
      origin: "https://elsewhere.test",
    });

    expect(answer.status).toBe(403);
    expect(answer.text).toBe("That request is from another origin.");
  });

  it("answers no write", async () => {
    const base = await start();
    const answer = await fetch(`${base}/api/store/origins`, { method: "POST" });

    expect(answer.status).toBe(405);
  });
});

describe("the collection plan route", () => {
  const origin = "https://store.test";
  const collectionId = "11111111-1111-4111-8111-111111111111";
  const pluginId = "55555555-5555-4555-8555-555555555555";

  function pluginBytes(): Uint8Array {
    return zipSync(
      {
        "yunari-plugin.json": strToU8(
          JSON.stringify({
            manifestVersion: 1,
            id: "acme-sensors",
            name: "Acme Sensors",
            version: "1.0.0",
            description: "Reads the room's sensors.",
            engines: { yunari: ">=0.1.0" },
            pluginApi: 1,
            execution: "trusted-worker",
            capabilities: ["sensor:provide"],
            contributes: {},
            main: "main.js",
          }),
        ),
        "main.js": strToU8("export default {};"),
      },
      { level: 0 },
    );
  }

  function extensionService(calls: string[]): ExtensionService {
    return {
      list: async () => [],
      install: async () => {
        calls.push("install");
        return { ok: false, message: "not called" };
      },
      grantConsent: async () => ({ ok: false }),
      remove: async () => undefined,
      mayLoad: async () => false,
      installedPlugin: async () => undefined,
      consentRecord: async () => undefined,
      readProviderOrder: async () => ({ version: 1, pluginOrder: [] }),
      writeProviderOrder: async () => ({ ok: true }),
    };
  }

  function post(
    handle: ReturnType<typeof createThemeWrites>,
    body: string,
  ): Promise<{ readonly status: number; readonly json: () => unknown }> {
    return new Promise((resolve) => {
      const request = new Readable({
        read() {
          this.push(Buffer.from(body));
          this.push(null);
        },
      }) as unknown as http.IncomingMessage;

      request.method = "POST";
      request.url = "/api/store/collection/plan";
      request.headers = {
        host: "127.0.0.1:5173",
        "content-length": String(Buffer.byteLength(body)),
      };
      (request as { socket: { remoteAddress: string } }).socket = {
        remoteAddress: "127.0.0.1",
      };

      const chunks: Buffer[] = [];
      let statusCode = 200;
      const response = new Writable({
        write(chunk: Buffer, _encoding, callback) {
          chunks.push(Buffer.from(chunk));
          callback();
        },
      }) as unknown as http.ServerResponse;
      response.writeHead = ((status: number) => {
        statusCode = status;
        return response;
      }) as unknown as typeof response.writeHead;
      response.end = ((data?: unknown) => {
        if (data) chunks.push(Buffer.from(data as string | Uint8Array));
        const text = Buffer.concat(chunks).toString("utf8");
        resolve({ status: statusCode, json: () => JSON.parse(text) });
        return response;
      }) as unknown as typeof response.end;

      void handle(request, response, new URL(request.url, "http://host"));
    });
  }

  it("returns verified members with consent and writes nothing", async () => {
    const plugin = pluginBytes();
    const collection = strToU8(
      JSON.stringify({
        format: "yunari-collection-package",
        version: 1,
        name: "Ops Pack",
        description: "",
        includes: [{ id: pluginId }],
      }),
    );
    const digest = (bytes: Uint8Array) =>
      crypto.subtle.digest("SHA-256", bytes as unknown as BufferSource);
    const hex = (buffer: ArrayBuffer) =>
      [...new Uint8Array(buffer)]
        .map((byte) => byte.toString(16).padStart(2, "0"))
        .join("");
    const item = strToU8(
      JSON.stringify({
        kind: "plugin",
        name: "Acme Sensors",
        version: "1.0.0",
        createdAt: "2026-11-01T00:00:00Z",
        updatedAt: "2026-11-02T00:00:00Z",
        downloads: 0,
        favorites: 0,
        packageUrl: `${origin}/catalogue/${pluginId}/1.0.0.zip`,
        thumbnail: "catalogue/thumb.png",
        members: [],
        sha256: hex(await digest(plugin)),
        bytes: plugin.byteLength,
        publisher: "acme",
      }),
    );
    const routes = new Map<string, Uint8Array>([
      [`${origin}/catalogue/${collectionId}/1.0.0.zip`, collection],
      [`${origin}/catalogue/${pluginId}/item.json`, item],
      [`${origin}/catalogue/${pluginId}/1.0.0.zip`, plugin],
    ]);
    const calls: string[] = [];
    const handle = createThemeWrites({
      options: {
        extensions: extensionService(calls),
      } as unknown as HostServerOptions,
      themeStore: {} as ThemeStore,
      catalogueOrigins: origins,
      thumbnails: undefined,
      themeMedia: undefined,
      fetcher: (async (input: RequestInfo | URL) => {
        const body = routes.get(String(input));
        return body === undefined
          ? new Response("Not found", { status: 404 })
          : new Response(body as unknown as BodyInit);
      }) as unknown as typeof fetch,
      largeBody: {
        run: async <T>(work: () => Promise<T>): Promise<T> => work(),
      },
      published: {} as PublishedStore,
      now: () => 0,
      storeOrigin: origin,
      storeSession: undefined,
    });

    const answer = await post(
      handle,
      JSON.stringify({
        packageUrl: `${origin}/catalogue/${collectionId}/1.0.0.zip`,
        catalogueId: collectionId,
        kind: "collection",
        version: "1.0.0",
        sha256: hex(await digest(collection)),
        bytes: collection.byteLength,
        publisher: "acme",
      }),
    );

    expect(answer.status).toBe(200);
    expect(answer.json()).toMatchObject({
      ok: true,
      plan: {
        members: [
          {
            id: pluginId,
            kind: "plugin",
            consent: {
              key: "local/acme-sensors",
              capabilities: ["sensor:provide"],
              devices: [],
            },
          },
        ],
        missing: [],
      },
    });
    expect(calls).toEqual([]);
    await expect(
      readFile(path.join(directory, "settings", "catalogue-origins.json")),
    ).rejects.toThrow();
  });
});
