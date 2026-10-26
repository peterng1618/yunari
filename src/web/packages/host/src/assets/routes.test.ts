import fs from "node:fs/promises";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { lucideSource } from "./icons/lucide.js";
import { type AssetRouteOptions, handleAssetRoutes } from "./routes.js";
import type { AssetSource } from "./source.js";

// Small enough that the 413 case is a short body rather than a hundred
// megabytes of base64. The route reads the store's own constant; this only
// shrinks the boundary the case probes.
vi.mock("../themes/store.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../themes/store.js")>()),
  MAX_ASSET_BYTES: 8,
}));

async function readBody(request: http.IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}

let running: http.Server | undefined;

async function start(
  assets: AssetRouteOptions | undefined,
  loopback = true,
  foreignOrigin = false,
): Promise<string> {
  const server = http.createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    void handleAssetRoutes({
      request,
      response,
      url,
      loopback,
      foreignOrigin,
      assets,
      fetch: globalThis.fetch,
      readBody,
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

afterEach(async () => {
  const server = running;
  running = undefined;
  if (server !== undefined) {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

function utf8(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

/** The trash route's own body: each file's bytes as base64, as the editor sends
 *  them. */
function trashBody(
  files: readonly { readonly name: string; readonly bytes: Uint8Array }[],
): string {
  return JSON.stringify({
    files: files.map((file) => ({
      name: file.name,
      bytes: Buffer.from(file.bytes).toString("base64"),
    })),
  });
}

describe("the asset routes", () => {
  const colourSource: AssetSource = {
    id: "fake-palettes",
    label: "Palettes",
    category: "colour",
    body: "grid",
    requires: undefined,
    configurable: true,
    presetKind: "palette",
    search: async () => ({ results: [], totalPages: 1 }),
    bytesOf: async () => undefined,
  };

  it("lists a colour source's preset kind and a null for the others", async () => {
    const base = await start({ sources: [colourSource, lucideSource] });
    const body = (await (await fetch(`${base}/api/assets/sources`)).json()) as {
      sources: readonly { id: string; presetKind: unknown }[];
    };
    expect(body.sources.find((s) => s.id === "fake-palettes")?.presetKind).toBe(
      "palette",
    );
    expect(body.sources.find((s) => s.id === "lucide")?.presetKind).toBeNull();
  });

  it("lists the sources, with no credential needed", async () => {
    const base = await start({});
    const response = await fetch(`${base}/api/assets/sources`);

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      sources: readonly Record<string, unknown>[];
    };
    expect(body.sources).toContainEqual(
      expect.objectContaining({
        id: "lucide",
        category: "icon",
        body: "grid",
        requires: null,
        configurable: true,
      }),
    );
  });

  it("searches the enabled sources and prefixes every id", async () => {
    const base = await start({});
    const response = await fetch(`${base}/api/assets/search`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query: "arrow down", enabled: ["lucide"] }),
    });

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      pages: readonly {
        source: string;
        results: readonly { id: string }[];
      }[];
    };
    expect(body.pages).toHaveLength(1);
    expect(body.pages[0]?.source).toBe("lucide");
    expect(
      body.pages[0]?.results.every((entry) => entry.id.startsWith("lucide:")),
    ).toBe(true);
  });

  it("ignores an enabled id this host does not know", async () => {
    const base = await start({});
    const response = await fetch(`${base}/api/assets/search`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query: "arrow", enabled: ["gone"] }),
    });

    expect((await response.json()) as unknown).toEqual({ pages: [] });
  });

  it("refuses a body that is not a search", async () => {
    const base = await start({});
    const response = await fetch(`${base}/api/assets/search`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{ not json",
    });

    expect(response.status).toBe(400);
  });

  it("answers an icon's bytes with its filename", async () => {
    const base = await start({});
    const response = await fetch(
      `${base}/api/assets/bytes?source=lucide&id=arrow-down`,
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/svg+xml");
    expect(response.headers.get("x-yunari-filename")).toBe("arrow-down.svg");
    expect(await response.text()).toContain("<svg");
  });

  it("answers 404 for an unknown source or asset", async () => {
    const base = await start({});

    expect(
      (await fetch(`${base}/api/assets/bytes?source=nope&id=arrow-down`))
        .status,
    ).toBe(404);
    expect(
      (await fetch(`${base}/api/assets/bytes?source=lucide&id=nope`)).status,
    ).toBe(404);
  });

  it("supports only the method each path names", async () => {
    const base = await start({});

    expect(
      (await fetch(`${base}/api/assets/sources`, { method: "POST" })).status,
    ).toBe(405);
    expect((await fetch(`${base}/api/assets/search`)).status).toBe(405);
    expect(
      (
        await fetch(`${base}/api/assets/bytes?source=lucide&id=arrow-down`, {
          method: "POST",
        })
      ).status,
    ).toBe(405);
  });

  it("keeps search and bytes on this PC", async () => {
    const base = await start({}, false);

    expect(
      (
        await fetch(`${base}/api/assets/search`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ query: "arrow", enabled: ["lucide"] }),
        })
      ).status,
    ).toBe(403);
    expect(
      (await fetch(`${base}/api/assets/bytes?source=lucide&id=arrow-down`))
        .status,
    ).toBe(403);
  });

  it("answers a search-prefixed id, which is what the grid shows", async () => {
    const base = await start({});
    const response = await fetch(
      `${base}/api/assets/bytes?source=lucide&id=lucide:arrow-down`,
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("x-yunari-filename")).toBe("arrow-down.svg");
  });

  it("refuses a request another page made", async () => {
    const base = await start({}, true, true);

    expect(
      (
        await fetch(`${base}/api/assets/search`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ query: "arrow", enabled: ["lucide"] }),
        })
      ).status,
    ).toBe(403);
    expect(
      (await fetch(`${base}/api/assets/bytes?source=lucide&id=arrow-down`))
        .status,
    ).toBe(403);
  });

  it("reports a host that serves no sources", async () => {
    const base = await start(undefined);
    const response = await fetch(`${base}/api/assets/sources`);

    expect(response.status).toBe(503);
    expect(await response.text()).toContain("not enabled");
  });

  describe("the trash route", () => {
    async function stagingRoot(): Promise<string> {
      return await fs.mkdtemp(path.join(os.tmpdir(), "yunari-trash-test-"));
    }

    it("trashes a staged copy and removes it from the staging directory", async () => {
      const root = await stagingRoot();
      const staged: {
        readonly paths: readonly string[];
        readonly text: string;
      }[] = [];
      const base = await start({
        stagingRoot: root,
        trash: async (paths) => {
          staged.push({
            paths,
            text: await fs.readFile(paths[0] ?? "", "utf8"),
          });
        },
      });

      try {
        const response = await fetch(`${base}/api/assets/trash`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: trashBody([{ name: "assets/old.woff2", bytes: utf8("woff") }]),
        });

        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({ ok: true });
        // The staged name is a basename, and the bytes are the decoded body.
        expect(path.basename(staged[0]?.paths[0] ?? "")).toBe("old.woff2");
        expect(staged[0]?.text).toBe("woff");
        // The staging directory is removed, so the copies are in the trash the
        // OS moved them to rather than duplicated in temp for good.
        expect(await fs.readdir(root)).toEqual([]);
      } finally {
        await fs.rm(root, { recursive: true, force: true });
      }
    });

    it("aborts with the host's reason when the trash fails", async () => {
      const root = await stagingRoot();
      const base = await start({
        stagingRoot: root,
        trash: async () => {
          throw new Error("gio: Operation not supported");
        },
      });

      try {
        const response = await fetch(`${base}/api/assets/trash`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: trashBody([{ name: "old.woff2", bytes: utf8("woff") }]),
        });

        expect(response.status).toBe(500);
        expect(await response.text()).toBe("gio: Operation not supported");
        // A refused trash still leaves no staged copy behind.
        expect(await fs.readdir(root)).toEqual([]);
      } finally {
        await fs.rm(root, { recursive: true, force: true });
      }
    });

    it("refuses a file over the per-asset cap before staging anything", async () => {
      const root = await stagingRoot();
      const trashed: string[][] = [];
      const base = await start({
        stagingRoot: root,
        trash: async (paths) => {
          trashed.push([...paths]);
        },
      });

      try {
        const response = await fetch(`${base}/api/assets/trash`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          // One byte past the cap this case mocks.
          body: trashBody([{ name: "big.woff2", bytes: new Uint8Array(9) }]),
        });

        expect(response.status).toBe(413);
        expect(trashed).toEqual([]);
        expect(await fs.readdir(root)).toEqual([]);
      } finally {
        await fs.rm(root, { recursive: true, force: true });
      }
    });

    it("refuses a body that is not a trash request", async () => {
      const base = await start({ trash: async () => undefined });

      const notFiles = await fetch(`${base}/api/assets/trash`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ files: "nope" }),
      });
      expect(notFiles.status).toBe(400);

      const notJson = await fetch(`${base}/api/assets/trash`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{ not json",
      });
      expect(notJson.status).toBe(400);
    });

    it("refuses a file with no name or a payload that is not base64", async () => {
      const base = await start({ trash: async () => undefined });

      const named = await fetch(`${base}/api/assets/trash`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ files: [{ name: "", bytes: "AAAA" }] }),
      });
      expect(named.status).toBe(400);

      const encoded = await fetch(`${base}/api/assets/trash`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          files: [{ name: "old.woff2", bytes: "not base64!" }],
        }),
      });
      expect(encoded.status).toBe(400);
    });

    it("refuses two files that sanitise to the same staged name", async () => {
      const root = await stagingRoot();
      const trashed: string[][] = [];
      const base = await start({
        stagingRoot: root,
        trash: async (paths) => {
          trashed.push([...paths]);
        },
      });

      try {
        const response = await fetch(`${base}/api/assets/trash`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          // Both are `x.woff2` once the path is a basename; one copy would
          // overwrite the other before either reached the trash.
          body: trashBody([
            { name: "a/x.woff2", bytes: utf8("a") },
            { name: "b/x.woff2", bytes: utf8("b") },
          ]),
        });

        expect(response.status).toBe(400);
        expect(trashed).toEqual([]);
        expect(await fs.readdir(root)).toEqual([]);
      } finally {
        await fs.rm(root, { recursive: true, force: true });
      }
    });

    it("answers 400 for a name the platform cannot store", async () => {
      const root = await stagingRoot();
      const trashed: string[][] = [];
      const base = await start({
        stagingRoot: root,
        trash: async (paths) => {
          trashed.push([...paths]);
        },
      });

      try {
        // Past every platform's single-component filename limit, so the write
        // itself refuses it (`ENAMETOOLONG`) rather than the host compiling a
        // platform rule of its own.
        const response = await fetch(`${base}/api/assets/trash`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: trashBody([{ name: "x".repeat(300), bytes: utf8("a") }]),
        });

        expect(response.status).toBe(400);
        expect(await response.text()).toContain("cannot be stored");
        expect(trashed).toEqual([]);
        expect(await fs.readdir(root)).toEqual([]);
      } finally {
        await fs.rm(root, { recursive: true, force: true });
      }
    });

    it("keeps the trash on this PC", async () => {
      const base = await start({ trash: async () => undefined }, false);

      expect((await fetch(`${base}/api/assets/trash`)).status).toBe(403);
    });

    it("keeps the trash off another page", async () => {
      const base = await start({ trash: async () => undefined }, true, true);

      expect((await fetch(`${base}/api/assets/trash`)).status).toBe(403);
    });

    it("owns the trash path on a host that serves no sources", async () => {
      // A method refusal, not the 503 the sources check answers: the trash
      // branch comes first, and a host with no finder sources can still trash.
      const base = await start(undefined);

      expect((await fetch(`${base}/api/assets/trash`)).status).toBe(405);
    });
  });
});
