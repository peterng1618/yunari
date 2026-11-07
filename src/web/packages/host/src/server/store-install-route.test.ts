import type http from "node:http";
import { Readable, Writable } from "node:stream";
import type { InstallResult } from "@yunari/extension-api";
import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import type { ExtensionService } from "../extensions/service.js";
import type { PublishedStore } from "../serve/published.js";
import type { ThemeStore } from "../themes/store.js";
import type { HostServerOptions } from "./options.js";
import { createThemeWrites } from "./theme-writes.js";

const ORIGIN = "https://store.test";
const CATALOGUE_ID = "6041df49-9c61-4d51-a184-716890560bdb";

interface Answered {
  readonly status: number;
  readonly text: string;
  readonly json: () => unknown;
}

function call(
  handle: ReturnType<typeof createThemeWrites>,
  body: string,
): Promise<Answered> {
  return new Promise((resolve) => {
    const request = new Readable({
      read() {
        this.push(Buffer.from(body));
        this.push(null);
      },
    }) as unknown as http.IncomingMessage;

    request.method = "POST";
    request.url = "/api/store/install";
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
      resolve({ status: statusCode, text, json: () => JSON.parse(text) });
      return response;
    }) as unknown as typeof response.end;

    void handle(
      request,
      response,
      new URL("/api/store/install", "http://host"),
    );
  });
}

function pluginPackage(): Uint8Array {
  return zipSync(
    {
      "yunari-plugin.json": strToU8(
        JSON.stringify({
          manifestVersion: 1,
          id: "acme-sensors",
          name: "Acme Sensors",
          version: "1.1.0",
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

async function digestOf(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    bytes as unknown as BufferSource,
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function extensionsService(
  install: ExtensionService["install"],
): ExtensionService {
  return {
    list: async () => [],
    install,
    grantConsent: async () => ({ ok: false }),
    remove: async () => undefined,
    mayLoad: async () => false,
    installedPlugin: async () => undefined,
    consentRecord: async () => undefined,
    readProviderOrder: async () => ({ version: 1, pluginOrder: [] }),
    writeProviderOrder: async () => ({ ok: true }),
  };
}

async function routeWith(install: ExtensionService["install"]): Promise<{
  readonly handle: ReturnType<typeof createThemeWrites>;
  readonly bytes: Uint8Array;
}> {
  const bytes = pluginPackage();
  return {
    bytes,
    handle: createThemeWrites({
      options: {
        extensions: extensionsService(install),
      } as unknown as HostServerOptions,
      themeStore: {} as ThemeStore,
      themeOrigins: undefined,
      thumbnails: undefined,
      themeMedia: undefined,
      fetcher: (async () =>
        new Response(bytes as unknown as BodyInit)) as unknown as typeof fetch,
      largeBody: {
        run: async <T>(work: () => Promise<T>): Promise<T> => work(),
      },
      published: {} as PublishedStore,
      now: () => 0,
      storeOrigin: ORIGIN,
      storeSession: undefined,
    }),
  };
}

async function bodyOf(
  bytes: Uint8Array,
  overrides: Readonly<Record<string, unknown>> = {},
): Promise<string> {
  return JSON.stringify({
    packageUrl: `${ORIGIN}/catalogue/${CATALOGUE_ID}/1.1.0.zip`,
    catalogueId: CATALOGUE_ID,
    kind: "plugin",
    version: "1.1.0",
    sha256: await digestOf(bytes),
    bytes: bytes.byteLength,
    publisher: "acme",
    ...overrides,
  });
}

describe("the catalogue install route", () => {
  it("answers a held plugin update with 409 and the held facts", async () => {
    const held: NonNullable<InstallResult["held"]> = {
      key: "local/acme-sensors",
      name: "Acme Sensors",
      publisher: "local",
      reasons: ["capability:sensor:provide"],
    };
    const { handle, bytes } = await routeWith(async () => ({
      ok: false,
      held,
    }));

    const answer = await call(handle, await bodyOf(bytes));

    expect(answer.status).toBe(409);
    expect(answer.json()).toEqual({ ok: false, held });
  });

  it("passes the approval press through and installs on it", async () => {
    const calls: unknown[] = [];
    const { handle, bytes } = await routeWith(async (_bytes, options) => {
      calls.push(options);
      return {
        ok: true,
        plugin: {
          key: "local/acme-sensors",
          publisher: "local",
          manifest: {
            manifestVersion: 1,
            id: "acme-sensors",
            name: "Acme Sensors",
            version: "1.1.0",
            description: "Reads the room's sensors.",
            engines: { yunari: ">=0.1.0" },
            pluginApi: 1,
            execution: "trusted-worker",
            capabilities: ["sensor:provide"],
            contributes: {},
            main: "main.js",
          },
          directory: "/nowhere",
          contentHash: "hash",
        },
      };
    });

    const answer = await call(
      handle,
      await bodyOf(bytes, { approveUpdate: true }),
    );

    expect(answer.status).toBe(200);
    expect(calls).toEqual([{ approveUpdate: true }]);
  });
});
