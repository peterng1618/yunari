import { mkdtemp, rm } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { Readable, Writable } from "node:stream";
import { strToU8, zipSync } from "fflate";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createConsentStore } from "../extensions/consent-store";
import { createPluginInstaller } from "../extensions/install";
import { createExtensionService } from "../extensions/service";
import {
  createExtensionRoutes,
  MAX_EXTENSION_INSTALL_BYTES,
} from "./extension-routes";

interface Answered {
  readonly status: number;
  readonly text: string;
  readonly json: () => unknown;
}

function call(
  handle: ReturnType<typeof createExtensionRoutes>,
  method: string,
  urlPath: string,
  options: {
    readonly body?: Uint8Array | string;
    readonly remoteAddress?: string;
    readonly headers?: Record<string, string>;
  } = {},
): Promise<Answered> {
  return new Promise((resolve) => {
    const { body } = options;
    const request = new Readable({
      read() {
        if (body !== undefined) this.push(Buffer.from(body));
        this.push(null);
      },
    }) as unknown as http.IncomingMessage;

    request.method = method;
    request.url = urlPath;
    request.headers = {
      host: "127.0.0.1:5173",
      ...(options.headers ?? {}),
    };
    if (body !== undefined && request.headers["content-length"] === undefined)
      request.headers["content-length"] = String(
        typeof body === "string" ? Buffer.byteLength(body) : body.byteLength,
      );
    (request as { socket: { remoteAddress: string } }).socket = {
      remoteAddress: options.remoteAddress ?? "127.0.0.1",
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
      const text = Buffer.concat(chunks).toString("utf8");
      resolve({
        status: statusCode,
        text,
        json: () => JSON.parse(text),
      });
      return response;
    }) as unknown as typeof response.end;

    void handle(request, response, new URL(urlPath, "http://host.invalid"));
  });
}

function pluginBytes(): Uint8Array {
  const manifest = {
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
  return zipSync(
    {
      "yunari-plugin.json": strToU8(JSON.stringify(manifest)),
      "main.js": strToU8("export default {};"),
    },
    { level: 0 },
  );
}

function providerPluginBytes(): Uint8Array {
  const manifest = {
    manifestVersion: 1,
    id: "acme-sensors",
    name: "Acme Sensors",
    version: "1.0.0",
    description: "Reads the room's sensors.",
    engines: { yunari: ">=0.1.0" },
    pluginApi: 1,
    execution: "trusted-worker",
    capabilities: ["sensor:provide"],
    contributes: { sensorProviders: [{ id: "acme", label: "Acme" }] },
    main: "main.js",
  };
  return zipSync(
    {
      "yunari-plugin.json": strToU8(JSON.stringify(manifest)),
      "main.js": strToU8("export default {};"),
    },
    { level: 0 },
  );
}

/** The order store the routes read and write, in memory. */
function orderStore(): {
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

describe("extension routes", () => {
  let dir: string;
  let handle: ReturnType<typeof createExtensionRoutes>;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), "yunari-routes-"));
    handle = createExtensionRoutes({
      extensions: createExtensionService({
        installer: createPluginInstaller(path.join(dir, "extensions")),
        consent: createConsentStore(dir),
        now: () => "2026-11-06T00:00:00Z",
        providerOrder: orderStore(),
      }),
    });
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("refuses a non-loopback caller on every extension route", async () => {
    const routes = [
      ["GET", "/api/extensions", undefined],
      ["POST", "/api/extensions/install", pluginBytes()],
      ["POST", "/api/extensions/local/acme-sensors/consent", "{}"],
      ["DELETE", "/api/extensions/local/acme-sensors", undefined],
      ["GET", "/api/extensions/provider-order", undefined],
      [
        "PUT",
        "/api/extensions/provider-order",
        JSON.stringify({ version: 1, pluginOrder: [] }),
      ],
    ] as const;

    for (const [method, path, body] of routes) {
      const answer = await call(handle, method, path, {
        remoteAddress: "192.168.1.10",
        ...(body === undefined ? {} : { body }),
      });
      expect(answer.status, `${method} ${path}`).toBe(403);
    }
  });

  it("refuses a foreign origin on every extension route", async () => {
    const routes = [
      ["GET", "/api/extensions", undefined],
      ["POST", "/api/extensions/install", pluginBytes()],
      ["POST", "/api/extensions/local/acme-sensors/consent", "{}"],
      ["DELETE", "/api/extensions/local/acme-sensors", undefined],
      ["GET", "/api/extensions/provider-order", undefined],
      [
        "PUT",
        "/api/extensions/provider-order",
        JSON.stringify({ version: 1, pluginOrder: [] }),
      ],
    ] as const;

    for (const [method, path, body] of routes) {
      const answer = await call(handle, method, path, {
        headers: { origin: "https://evil.example" },
        ...(body === undefined ? {} : { body }),
      });
      expect(answer.status, `${method} ${path}`).toBe(403);
    }
  });

  it("installs, lists, approves and removes one plugin", async () => {
    // JSON escapes Windows backslashes, so the directory must be looked for in
    // the wire form a browser would actually receive.
    const escapedDir = JSON.stringify(dir).slice(1, -1);

    const installed = await call(handle, "POST", "/api/extensions/install", {
      body: pluginBytes(),
      headers: { "content-type": "application/zip" },
    });
    expect(installed.status).toBe(200);
    expect(installed.json()).toEqual({
      ok: true,
      plugin: expect.objectContaining({
        key: "local/acme-sensors",
        consent: "missing",
        name: "Acme Sensors",
        version: "1.0.0",
      }),
    });
    expect(installed.text).not.toContain(escapedDir);
    expect(installed.text).not.toContain("directory");

    const listed = await call(handle, "GET", "/api/extensions");
    const listing = listed.json() as {
      extensions: { key: string; fingerprint: string; consent: string }[];
    };
    expect(listing.extensions).toHaveLength(1);
    expect(listing.extensions[0]).toMatchObject({
      key: "local/acme-sensors",
      consent: "missing",
    });
    expect(listed.text).not.toContain(escapedDir);
    expect(listed.text).not.toContain("directory");

    const consented = await call(
      handle,
      "POST",
      "/api/extensions/local/acme-sensors/consent",
      {
        body: JSON.stringify({
          fingerprint: listing.extensions[0]?.fingerprint,
        }),
      },
    );
    expect(consented.status).toBe(200);
    expect(consented.json()).toEqual({ ok: true });

    const after = await call(handle, "GET", "/api/extensions");
    expect(after.json()).toEqual({
      extensions: [
        expect.objectContaining({
          key: "local/acme-sensors",
          consent: "granted",
        }),
      ],
    });

    const removed = await call(
      handle,
      "DELETE",
      "/api/extensions/local/acme-sensors",
    );
    expect(removed.status).toBe(200);
    expect(
      await call(handle, "GET", "/api/extensions").then((a) => a.json()),
    ).toEqual({ extensions: [] });
  });

  it("answers 413 before reading an oversize install body", async () => {
    const answer = await call(handle, "POST", "/api/extensions/install", {
      body: new Uint8Array([0]),
      headers: {
        "content-length": String(MAX_EXTENSION_INSTALL_BYTES + 1),
      },
    });
    expect(answer.status).toBe(413);
  });

  it("refuses a malformed consent body", async () => {
    const malformed = await call(
      handle,
      "POST",
      "/api/extensions/local/acme-sensors/consent",
      { body: "not json" },
    );
    expect(malformed.status).toBe(400);

    const nonString = await call(
      handle,
      "POST",
      "/api/extensions/local/acme-sensors/consent",
      { body: JSON.stringify({ fingerprint: 5 }) },
    );
    expect(nonString.status).toBe(400);
  });

  it("does not forward the installer's message to the browser", async () => {
    const answer = await call(handle, "POST", "/api/extensions/install", {
      body: new Uint8Array([1, 2, 3]),
    });
    expect(answer.status).toBe(400);
    expect(answer.json()).toEqual({
      ok: false,
      message: "That plugin could not be installed.",
    });
  });

  it("answers 500 when the installed key is absent from the listing", async () => {
    const real = createExtensionService({
      installer: createPluginInstaller(path.join(dir, "extensions")),
      consent: createConsentStore(dir),
      now: () => "2026-11-06T00:00:00Z",
      providerOrder: orderStore(),
    });
    const broken = { ...real, list: async () => [] };
    const route = createExtensionRoutes({ extensions: broken });

    const answer = await call(route, "POST", "/api/extensions/install", {
      body: pluginBytes(),
    });
    expect(answer.status).toBe(500);
    expect(answer.json()).toEqual({
      ok: false,
      message: "That plugin could not be installed.",
    });
  });

  it("answers 503 when the host manages no extensions", async () => {
    const disabled = createExtensionRoutes({ extensions: undefined });
    expect((await call(disabled, "GET", "/api/extensions")).status).toBe(503);
  });

  it("reads and writes the provider order", async () => {
    const installed = await call(handle, "POST", "/api/extensions/install", {
      body: providerPluginBytes(),
    });
    expect(installed.status).toBe(200);

    const empty = await call(handle, "GET", "/api/extensions/provider-order");
    expect(empty.status).toBe(200);
    expect(empty.json()).toEqual({ version: 1, pluginOrder: [] });

    const written = await call(
      handle,
      "PUT",
      "/api/extensions/provider-order",
      {
        body: JSON.stringify({
          version: 1,
          pluginOrder: ["local/acme-sensors"],
        }),
      },
    );
    expect(written.status).toBe(200);
    expect(written.json()).toEqual({ ok: true });

    const read = await call(handle, "GET", "/api/extensions/provider-order");
    expect(read.json()).toEqual({
      version: 1,
      pluginOrder: ["local/acme-sensors"],
    });
  });

  it("refuses a provider order naming an uninstalled plugin", async () => {
    const answer = await call(handle, "PUT", "/api/extensions/provider-order", {
      body: JSON.stringify({ version: 1, pluginOrder: ["local/gone"] }),
    });

    expect(answer.status).toBe(400);
    expect(answer.json()).toEqual({
      ok: false,
      message: 'No installed extension provides the provider "local/gone".',
    });
  });

  it("refuses an unreadable provider-order body", async () => {
    const malformed = await call(
      handle,
      "PUT",
      "/api/extensions/provider-order",
      { body: "not json" },
    );
    expect(malformed.status).toBe(400);

    const oversize = await call(
      handle,
      "PUT",
      "/api/extensions/provider-order",
      {
        body: "x",
        headers: { "content-length": String(64 * 1024 + 1) },
      },
    );
    expect(oversize.status).toBe(413);
  });
});
