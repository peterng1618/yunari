import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { lucideSource } from "./icons/lucide.js";
import { type AssetRouteOptions, handleAssetRoutes } from "./routes.js";
import type { AssetSource } from "./source.js";

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
});
