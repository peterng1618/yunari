import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import {
  BUILTIN_PATH_PRESETS,
  type WidgetDocument,
  writeWidgetPackage,
} from "@yunari/theme-package";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createWidgetPackStore,
  type WidgetPackStore,
} from "../packs/widget-packs.js";
import {
  createPathPresetStore,
  MAX_PATH_PRESET_PACK_BYTES,
  type PathPresetStore,
} from "../presets/path-presets.js";
import { createLargeBodyGate } from "./http.js";
import { MAX_WIDGET_PACK_BYTES } from "./limits.js";
import { handlePackRoutes } from "./pack-routes.js";

function widgetPackageBytes(): Uint8Array {
  const document: WidgetDocument = {
    schemaVersion: "2.1.0",
    fabricVersion: "7.4.0",
    id: "pack-one",
    metadata: { name: "Pack One", version: "1.0.0", themeLanguage: "en" },
    scene: {
      version: "7.4.0",
      objects: [
        {
          type: "Group",
          id: "card",
          objects: [{ type: "Rect", id: "card-value" }],
          provenance: { widgetId: "card", widgetName: "Card" },
        },
      ],
    },
    bindings: { card: [{ id: "card-binding", semanticKey: "cpu.load" }] },
  };
  const written = writeWidgetPackage({ document, assets: {} });
  if (!written.ok) throw new Error(written.message);
  return written.bytes;
}

let running: http.Server | undefined;
let directory: string;
let store: WidgetPackStore | undefined;
let pathPresets: PathPresetStore | undefined;

function pathPresetPackBytes(): Uint8Array {
  return new TextEncoder().encode(
    JSON.stringify({
      format: "yunari-path-preset-pack",
      version: 1,
      id: "pack-one",
      name: "Pack One",
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
}

async function start(
  withStore = true,
  bundled?: readonly Uint8Array[],
): Promise<string> {
  store = withStore
    ? createWidgetPackStore(directory, bundled === undefined ? {} : { bundled })
    : undefined;
  pathPresets = createPathPresetStore(
    path.join(directory, "presets"),
    BUILTIN_PATH_PRESETS,
  );
  const largeBody = createLargeBodyGate();
  const server = http.createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    void handlePackRoutes({
      request,
      response,
      url,
      store,
      pathPresets,
      largeBody,
    }).then((handled) => {
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

beforeEach(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), "yunari-pack-routes-"));
});

afterEach(async () => {
  const server = running;
  running = undefined;
  store = undefined;
  pathPresets = undefined;
  if (server !== undefined) {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  await rm(directory, { recursive: true, force: true });
});

describe("the widget pack routes", () => {
  it("lists, imports, reads and removes a pack", async () => {
    const base = await start();
    const bytes = widgetPackageBytes();

    const empty = await fetch(`${base}/api/widget-packs`);
    expect(empty.status).toBe(200);
    expect(await empty.json()).toEqual({ packs: [] });

    const imported = await fetch(`${base}/api/widget-packs/import`, {
      method: "POST",
      body: bytes.buffer as ArrayBuffer,
    });
    expect(imported.status).toBe(200);
    expect(await imported.json()).toEqual({
      ok: true,
      pack: {
        id: "pack-one",
        name: "Pack One",
        version: "1.0.0",
        units: [{ id: "card", label: "Card" }],
      },
    });

    const listed = await fetch(`${base}/api/widget-packs`);
    expect(await listed.json()).toEqual({
      packs: [
        {
          id: "pack-one",
          name: "Pack One",
          version: "1.0.0",
          units: [{ id: "card", label: "Card" }],
        },
      ],
    });

    const fetched = await fetch(`${base}/api/widget-packs/pack-one`);
    expect(fetched.status).toBe(200);
    expect(fetched.headers.get("content-type")).toBe("application/zip");
    expect(new Uint8Array(await fetched.arrayBuffer())).toEqual(bytes);

    const removed = await fetch(`${base}/api/widget-packs/pack-one`, {
      method: "DELETE",
    });
    expect(removed.status).toBe(200);
    expect(await removed.json()).toEqual({ ok: true });

    expect(await (await fetch(`${base}/api/widget-packs`)).json()).toEqual({
      packs: [],
    });
    expect((await fetch(`${base}/api/widget-packs/pack-one`)).status).toBe(404);
  });

  it("refuses an invalid package with the reader's message", async () => {
    const base = await start();
    const response = await fetch(`${base}/api/widget-packs/import`, {
      method: "POST",
      body: new Uint8Array([1, 2, 3]),
    });

    expect(response.status).toBe(400);
    expect(await response.text()).toBe(
      "That file is not a readable widget package.",
    );
  });

  it("refuses a body over 64 MiB before reading it as a zip", async () => {
    const base = await start();
    const response = await fetch(`${base}/api/widget-packs/import`, {
      method: "POST",
      body: new Uint8Array(MAX_WIDGET_PACK_BYTES + 1).buffer,
    });

    expect(response.status).toBe(413);
  });

  it("refuses an import from another origin", async () => {
    const base = await start();
    const response = await fetch(`${base}/api/widget-packs/import`, {
      method: "POST",
      headers: { origin: "http://evil.example" },
      body: widgetPackageBytes().buffer as ArrayBuffer,
    });

    expect(response.status).toBe(403);
    expect(await (await fetch(`${base}/api/widget-packs`)).json()).toEqual({
      packs: [],
    });
  });

  it("refuses a non-loopback caller with 403 for both writes", async () => {
    // The real socket is loopback; the module's decision is exercised in
    // isolation by calling the handler with a foreign address. A configured
    // store proves the loopback gate, not the missing-store 404, is what
    // answers.
    store = createWidgetPackStore(directory);

    for (const [method, urlPath] of [
      ["POST", "/api/widget-packs/import"],
      ["DELETE", "/api/widget-packs/pack-one"],
    ] as const) {
      let status = 0;
      const response = {
        writeHead(code: number) {
          status = code;
          return response;
        },
        end() {
          return response;
        },
      };
      const handled = await handlePackRoutes({
        request: {
          method,
          headers: { host: "127.0.0.1:5173" },
          socket: { remoteAddress: "192.168.1.4" },
        } as unknown as http.IncomingMessage,
        response: response as unknown as http.ServerResponse,
        url: new URL(`http://127.0.0.1${urlPath}`),
        store,
      });

      expect(handled).toBe(true);
      expect(status).toBe(403);
    }
  });

  it("refuses a DELETE from another origin", async () => {
    const base = await start();
    const bytes = widgetPackageBytes();
    await fetch(`${base}/api/widget-packs/import`, {
      method: "POST",
      body: bytes.buffer as ArrayBuffer,
    });

    const removed = await fetch(`${base}/api/widget-packs/pack-one`, {
      method: "DELETE",
      headers: { origin: "http://evil.example" },
    });
    expect(removed.status).toBe(403);
    expect((await fetch(`${base}/api/widget-packs/pack-one`)).status).toBe(200);
  });

  it("refuses a malformed, empty or overlong pack id", async () => {
    const base = await start();

    for (const urlPath of [
      "/api/widget-packs/",
      "/api/widget-packs/..%2F",
      "/api/widget-packs/%5C",
      `/api/widget-packs/${"a".repeat(100)}`,
    ]) {
      const response = await fetch(`${base}${urlPath}`, { method: "DELETE" });
      expect(response.status, urlPath).toBe(400);
    }
  });

  it("serves a bundled pack's bytes", async () => {
    const bundled = widgetPackageBytes();
    // The fixture's id is pack-one; it is bundled, not installed.
    const base = await start(true, [bundled]);

    const response = await fetch(`${base}/api/widget-packs/pack-one`);
    expect(response.status).toBe(200);
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(bundled);
  });

  it("does not serve a stored pack whose bytes no longer validate", async () => {
    const base = await start();
    const target = path.join(directory, "pack-one");
    await mkdir(target, { recursive: true });
    await writeFile(
      path.join(target, "package.zip"),
      new Uint8Array([1, 2, 3]),
    );
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      expect((await fetch(`${base}/api/widget-packs/pack-one`)).status).toBe(
        404,
      );
      expect(logged).toHaveBeenCalled();
    } finally {
      logged.mockRestore();
    }
  });

  it("keeps an existing good pack when the replacement is invalid", async () => {
    const base = await start();
    const good = widgetPackageBytes();
    await fetch(`${base}/api/widget-packs/import`, {
      method: "POST",
      body: good.buffer as ArrayBuffer,
    });

    const refused = await fetch(`${base}/api/widget-packs/import`, {
      method: "POST",
      body: new Uint8Array([1, 2, 3]).buffer,
    });
    expect(refused.status).toBe(400);

    const response = await fetch(`${base}/api/widget-packs/pack-one`);
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(good);
  });

  it("answers 404 when the host serves no pack store", async () => {
    const base = await start(false);
    expect((await fetch(`${base}/api/widget-packs`)).status).toBe(404);
  });
});

describe("the path preset routes", () => {
  it("installs a pack, then removes it without touching the user preset", async () => {
    const base = await start();

    const added = await fetch(`${base}/api/path-presets`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ label: "Mine", data: "M 0 0 L 10 0" }),
    });
    expect(added.status).toBe(200);
    const userPreset = (await added.json()) as {
      readonly id: string;
      readonly label: string;
    };
    expect(userPreset.id).toMatch(/^user:/);
    expect(userPreset.label).toBe("Mine");

    const installed = await fetch(`${base}/api/path-presets/packs`, {
      method: "POST",
      body: pathPresetPackBytes().buffer as ArrayBuffer,
    });
    expect(installed.status).toBe(200);
    expect(await installed.json()).toEqual({
      packId: "pack-one",
      presets: [
        {
          id: "pack:pack-one:star",
          label: "Star",
          data: "M 0 0 L 10 0 L 5 10 Z",
          paint: "fill",
        },
      ],
    });

    const listed = await fetch(`${base}/api/path-presets`);
    expect(listed.status).toBe(200);
    const state = (await listed.json()) as {
      readonly presets: readonly { readonly id: string }[];
    };
    expect(state.presets.map((preset) => preset.id)).toContain(userPreset.id);
    expect(state.presets.map((preset) => preset.id)).toContain(
      "pack:pack-one:star",
    );

    const removed = await fetch(`${base}/api/path-presets/packs/pack-one`, {
      method: "DELETE",
    });
    expect(removed.status).toBe(200);
    expect(await removed.json()).toEqual({ ok: true });

    const after = (await (await fetch(`${base}/api/path-presets`)).json()) as {
      readonly presets: readonly { readonly id: string }[];
    };
    expect(after.presets.map((preset) => preset.id)).toContain(userPreset.id);
    expect(after.presets.map((preset) => preset.id)).not.toContain(
      "pack:pack-one:star",
    );
  });

  it("refuses a non-loopback and a foreign-origin write", async () => {
    const base = await start();

    const foreign = await fetch(`${base}/api/path-presets`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "http://evil.example",
      },
      body: JSON.stringify({ label: "Mine", data: "M 0 0 L 10 0" }),
    });
    expect(foreign.status).toBe(403);

    let status = 0;
    const response = {
      writeHead(code: number) {
        status = code;
        return response;
      },
      end() {
        return response;
      },
    };
    const handled = await handlePackRoutes({
      request: {
        method: "POST",
        headers: { host: "127.0.0.1:5173" },
        socket: { remoteAddress: "192.168.1.4" },
      } as unknown as http.IncomingMessage,
      response: response as unknown as http.ServerResponse,
      url: new URL("http://127.0.0.1/api/path-presets"),
      store: undefined,
      pathPresets,
    });
    expect(handled).toBe(true);
    expect(status).toBe(403);
  });

  it("answers a malformed or non-object body with 4xx, never 500", async () => {
    const base = await start();

    const malformed = await fetch(`${base}/api/path-presets`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{not json",
    });
    expect(malformed.status).toBe(400);

    const nonObject = await fetch(`${base}/api/path-presets`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(["not", "an", "object"]),
    });
    expect(nonObject.status).toBe(400);

    const invalid = await fetch(`${base}/api/path-presets`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ label: "", data: "M 0 0 L 10 0" }),
    });
    expect(invalid.status).toBe(400);
    expect(await invalid.text()).toBe("A path preset needs a name.");
  });

  it("refuses a pack over 10 MiB before parsing it", async () => {
    const base = await start();
    const response = await fetch(`${base}/api/path-presets/packs`, {
      method: "POST",
      body: new Uint8Array(MAX_PATH_PRESET_PACK_BYTES + 1).buffer,
    });
    expect(response.status).toBe(413);
  });

  it("migrates browser rows once and refuses one that is not a user id", async () => {
    const base = await start();
    const row = {
      id: "user:mine",
      label: "Mine",
      data: "M 0 0 L 10 0",
      paint: "stroke",
    };

    const migrated = await fetch(`${base}/api/path-presets/migrate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ presets: [row], removedBuiltins: ["arc"] }),
    });
    expect(migrated.status).toBe(200);
    const state = (await migrated.json()) as {
      readonly presets: readonly { readonly id: string }[];
      readonly removedBuiltins: readonly string[];
      readonly migrated: boolean;
    };
    expect(state.migrated).toBe(true);
    expect(state.removedBuiltins).toEqual(["arc"]);
    expect(state.presets.map((preset) => preset.id)).toContain("user:mine");
    expect(state.presets.map((preset) => preset.id)).not.toContain("arc");

    const refused = await fetch(`${base}/api/path-presets/migrate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        presets: [{ ...row, id: "builtin-not-user" }],
        removedBuiltins: [],
      }),
    });
    expect(refused.status).toBe(400);
    expect(await refused.text()).toBe(
      'The migrated id "builtin-not-user" is not a user id.',
    );
  });

  it("removes and restores a built-in", async () => {
    const base = await start();

    const removed = await fetch(
      `${base}/api/path-presets/builtins/arc/remove`,
      { method: "POST" },
    );
    expect(removed.status).toBe(200);
    expect(await removed.json()).toEqual({ ok: true });

    const without = (await (
      await fetch(`${base}/api/path-presets`)
    ).json()) as {
      readonly presets: readonly { readonly id: string }[];
      readonly removedBuiltins: readonly string[];
    };
    expect(without.removedBuiltins).toEqual(["arc"]);
    expect(without.presets.map((preset) => preset.id)).not.toContain("arc");

    const restored = await fetch(`${base}/api/path-presets/builtins/restore`, {
      method: "POST",
    });
    expect(restored.status).toBe(200);

    const back = (await (await fetch(`${base}/api/path-presets`)).json()) as {
      readonly presets: readonly { readonly id: string }[];
      readonly removedBuiltins: readonly string[];
    };
    expect(back.removedBuiltins).toEqual([]);
    expect(back.presets.map((preset) => preset.id)).toContain("arc");
  });

  it("answers a corrupt store file with 500 and no path in the body", async () => {
    const base = await start();
    const storeDirectory = path.join(directory, "presets");
    await mkdir(storeDirectory, { recursive: true });
    await writeFile(
      path.join(storeDirectory, "path-presets.json"),
      "{not json",
    );
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      const response = await fetch(`${base}/api/path-presets`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ label: "Mine", data: "M 0 0 L 10 0" }),
      });
      expect(response.status).toBe(500);
      const body = await response.text();
      expect(body).toBe("The path presets could not be saved.");
      expect(body).not.toContain(directory);
      expect(body).not.toContain("path-presets.json");
      expect(logged).toHaveBeenCalled();
    } finally {
      logged.mockRestore();
    }
  });
});
