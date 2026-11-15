import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { Readable, Writable } from "node:stream";
import {
  EDITOR_THEME_TOKENS,
  writeEditorThemePackage,
} from "@yunari/theme-package";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
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
function callFrom(remoteAddress: string): Promise<{
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
    request.url = "/api/editor-themes";
    request.headers = { host: "127.0.0.1:5173" };
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
