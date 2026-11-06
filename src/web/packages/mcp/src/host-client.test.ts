import { afterEach, describe, expect, it } from "vitest";
import { HostRefusalError, HttpHostClient } from "./host-client.js";
import {
  type FakeHost,
  startFakeHost,
  testEnvelope,
} from "./testing/fake-host.js";

const hosts: FakeHost[] = [];

async function fakeHost(
  handler: Parameters<typeof startFakeHost>[0],
): Promise<FakeHost> {
  const host = await startFakeHost(handler);
  hosts.push(host);
  return host;
}

afterEach(async () => {
  await Promise.all(hosts.splice(0).map((host) => host.close()));
});

describe("HttpHostClient", () => {
  it("summarises the host from the routes status needs", async () => {
    const host = await fakeHost((request, url) => {
      if (url.pathname === "/api/themes") {
        return {
          body: {
            themes: [
              { id: "a", name: "A", facets: { width: 800, height: 480 } },
            ],
          },
        };
      }
      if (url.pathname === "/api/themes/active") {
        return {
          body: {
            default: null,
            displays: [
              {
                id: "this-pc",
                label: "Host",
                kind: "local",
                theme: "a",
                shape: "rect",
                rotation: 0,
              },
            ],
          },
        };
      }
      if (url.pathname === "/api/sensors") {
        return { body: { sensors: [{ semanticKey: "cpu.load" }] } };
      }
      if (url.pathname === "/api/assets/sources") {
        return { body: { sources: [{ id: "lucide" }] } };
      }
      return undefined;
    });

    const status = await new HttpHostClient(host.url).status();

    expect(status).toEqual({
      url: host.url,
      reachable: true,
      themeCount: 1,
      displays: 1,
      sensorCount: 1,
      assetSources: ["lucide"],
      unavailable: [],
    });
  });

  it("reports a reachable host with one section unavailable", async () => {
    const host = await fakeHost((_request, url) => {
      if (url.pathname === "/api/themes") return { body: { themes: [] } };
      if (url.pathname === "/api/themes/active") {
        return { status: 404, body: "This host keeps no active theme." };
      }
      if (url.pathname === "/api/sensors") return { body: { sensors: [] } };
      if (url.pathname === "/api/assets/sources") {
        return { body: { sources: [] } };
      }
      return undefined;
    });

    const status = await new HttpHostClient(host.url).status();

    expect(status.reachable).toBe(true);
    expect(status.themeCount).toBe(0);
    expect(status.displays).toBeNull();
    expect(status.unavailable.map((entry) => entry.section)).toEqual([
      "displays",
    ]);
    expect(status.unavailable[0]?.reason).toContain("404");
  });

  it("reports an unreachable host when every section fails", async () => {
    const host = await fakeHost(() => ({ status: 500, body: "boom" }));

    const status = await new HttpHostClient(host.url).status();

    expect(status.reachable).toBe(false);
    expect(status.unavailable.map((entry) => entry.section)).toEqual([
      "themes",
      "displays",
      "sensors",
      "asset sources",
    ]);
    expect(status.themeCount).toBeNull();
  });

  it("maps the listing's facets to an artboard", async () => {
    const host = await fakeHost((_request, url) =>
      url.pathname === "/api/themes"
        ? {
            body: {
              themes: [
                {
                  id: "a",
                  name: "A",
                  author: "Ann",
                  updatedAt: "2026-11-03T00:00:00.000Z",
                  origin: "created",
                  facets: { width: 800, height: 480 },
                },
              ],
            },
          }
        : undefined,
    );

    await expect(new HttpHostClient(host.url).listThemes()).resolves.toEqual([
      {
        id: "a",
        name: "A",
        author: "Ann",
        updatedAt: "2026-11-03T00:00:00.000Z",
        origin: "created",
        artboard: { width: 800, height: 480 },
      },
    ]);
  });

  it("refuses a widget-pack listing it cannot read rather than calling it empty", async () => {
    const host = await fakeHost((_request, url) =>
      url.pathname === "/api/widget-packs"
        ? { body: { unexpected: [] } }
        : undefined,
    );

    await expect(
      new HttpHostClient(host.url).listWidgetPacks(),
    ).rejects.toThrow("did not answer a widget-pack listing");
  });

  it("decodes a stored theme's base64 assets", async () => {
    const host = await fakeHost((_request, url) =>
      url.pathname === "/api/themes/abc"
        ? {
            body: {
              envelope: testEnvelope("abc"),
              assets: {
                "assets/dot.png": Buffer.from([1, 2, 3]).toString("base64"),
              },
              base: "hash",
            },
          }
        : undefined,
    );

    const content = await new HttpHostClient(host.url).getTheme("abc");

    expect(content.envelope.id).toBe("abc");
    expect(content.base).toBe("hash");
    expect(content.assets["assets/dot.png"]).toEqual(new Uint8Array([1, 2, 3]));
  });

  it("encodes a save's assets and carries the base claim", async () => {
    const host = await fakeHost((request, url) => {
      if (url.pathname !== "/api/themes/abc" || request.method !== "PUT") {
        return undefined;
      }
      expect(request.headers["content-type"]).toBe("application/json");
      // No agent-only header: a stored theme with no picture is the host's to
      // fill, for any client.
      const body = JSON.parse(request.body.toString("utf8")) as {
        envelope: { id: string };
        assets: Record<string, string>;
        base: string;
        overwrite: boolean;
      };
      expect(body.envelope.id).toBe("abc");
      expect(
        Buffer.from(body.assets["assets/dot.png"] ?? "", "base64"),
      ).toEqual(Buffer.from([9, 8]));
      expect(body.base).toBe("stored");
      expect(body.overwrite).toBe(true);
      return { body: { ok: true, id: "abc", base: "next" } };
    });

    const saved = await new HttpHostClient(host.url).saveTheme("abc", {
      envelope: testEnvelope("abc"),
      assets: { "assets/dot.png": new Uint8Array([9, 8]) },
      base: "stored",
      overwrite: true,
    });

    expect(saved).toEqual({ ok: true, id: "abc", base: "next" });
  });

  it("asks for measured sensors only when asked", async () => {
    const host = await fakeHost((_request, url) => {
      if (url.pathname !== "/api/sensors") return undefined;
      return url.searchParams.get("measured") === "1"
        ? {
            body: {
              sensors: [{ semanticKey: "cpu.load" }],
              measured: ["cpu.load"],
            },
          }
        : { body: { sensors: [{ semanticKey: "cpu.load" }] } };
    });
    const client = new HttpHostClient(host.url);

    await expect(client.sensors(false)).resolves.toEqual({
      sensors: [{ semanticKey: "cpu.load" }],
      measured: [],
    });
    await expect(client.sensors(true)).resolves.toEqual({
      sensors: [{ semanticKey: "cpu.load" }],
      measured: ["cpu.load"],
    });
  });

  it("reads the active map and assigns a display", async () => {
    const host = await fakeHost((request, url) => {
      if (url.pathname !== "/api/themes/active") return undefined;
      if (request.method === "GET") {
        return { body: { default: "a", displays: [] } };
      }
      expect(JSON.parse(request.body.toString("utf8"))).toEqual({
        display: "panel-1",
        id: "a",
      });
      return { body: { ok: true } };
    });
    const client = new HttpHostClient(host.url);

    await expect(client.activeThemes()).resolves.toEqual({
      default: "a",
      displays: [],
    });
    await expect(client.assignTheme("panel-1", "a")).resolves.toBeUndefined();
  });

  it("searches asset sources and fetches bytes with the source filename", async () => {
    const host = await fakeHost((request, url) => {
      if (url.pathname === "/api/assets/sources") {
        return {
          body: {
            sources: [
              {
                id: "lucide",
                label: "Lucide",
                category: "icon",
                body: "grid",
                requires: null,
                configurable: false,
                presetKind: null,
                host: null,
              },
            ],
          },
        };
      }
      if (url.pathname === "/api/assets/search") {
        expect(request.method).toBe("POST");
        expect(JSON.parse(request.body.toString("utf8"))).toEqual({
          query: "arrow",
          enabled: ["lucide"],
          pages: {},
        });
        return { body: { pages: [] } };
      }
      if (url.pathname === "/api/assets/bytes") {
        expect(url.searchParams.get("source")).toBe("lucide");
        expect(url.searchParams.get("id")).toBe("lucide:arrow");
        return {
          body: Buffer.from([7, 7]),
          headers: { "x-yunari-filename": "arrow.svg" },
        };
      }
      return undefined;
    });
    const client = new HttpHostClient(host.url);

    const sources = await client.listAssetSources();
    expect(sources[0]?.id).toBe("lucide");

    await expect(
      client.searchAssets({
        query: "arrow",
        enabled: ["lucide"],
        pages: {},
      }),
    ).resolves.toEqual({ pages: [] });

    const bytes = await client.assetBytes("lucide", "lucide:arrow");
    expect(bytes.filename).toBe("arrow.svg");
    expect(bytes.bytes).toEqual(new Uint8Array([7, 7]));
  });

  it("normalises video through the host route", async () => {
    const host = await fakeHost((request, url) => {
      if (url.pathname !== "/api/themes/normalize-video") return undefined;
      expect(request.method).toBe("POST");
      expect(url.searchParams.get("startMs")).toBe("100");
      expect(url.searchParams.get("endMs")).toBe("900");
      return {
        body: {
          ok: true,
          bytesBase64: Buffer.from([4, 5]).toString("base64"),
        },
      };
    });

    await expect(
      new HttpHostClient(host.url).normalizeVideo(new Uint8Array([1]), {
        startMs: 100,
        endMs: 900,
      }),
    ).resolves.toEqual(new Uint8Array([4, 5]));
  });

  it("relays a video refusal that arrives as a 200 answer", async () => {
    const host = await fakeHost((_request, url) =>
      url.pathname === "/api/themes/normalize-video"
        ? { body: { ok: false, message: "That video is too long." } }
        : undefined,
    );

    await expect(
      new HttpHostClient(host.url).normalizeVideo(new Uint8Array([1])),
    ).rejects.toThrow("That video is too long.");
  });

  it("fetches a panel preview as PNG bytes", async () => {
    const host = await fakeHost((_request, url) => {
      if (url.pathname !== "/api/themes/abc/panel-preview") return undefined;
      expect(url.searchParams.get("display")).toBe("panel-1");
      expect(url.searchParams.get("clip")).toBe("1");
      return { body: Buffer.from([0x89, 0x50]) };
    });

    await expect(
      new HttpHostClient(host.url).panelPreview("abc", "panel-1", true),
    ).resolves.toEqual(new Uint8Array([0x89, 0x50]));
  });

  it("names the status and the host's text on a refusal", async () => {
    const host = await fakeHost((_request, url) =>
      url.pathname === "/api/themes/missing"
        ? { status: 404, body: "Theme not found." }
        : undefined,
    );

    await expect(
      new HttpHostClient(host.url).getTheme("missing"),
    ).rejects.toThrow(/404: Theme not found\./u);
  });

  it("carries a JSON refusal's validator issues", async () => {
    const issues = [{ code: "bad-path", path: "/a", message: "bad" }];
    const host = await fakeHost((_request, url) =>
      url.pathname === "/api/themes/bad"
        ? { status: 422, body: { error: "Invalid theme", issues } }
        : undefined,
    );

    const error = await new HttpHostClient(host.url)
      .getTheme("bad")
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(HostRefusalError);
    expect(error).toMatchObject({ status: 422, issues });
  });

  it("names the host URL, probed ports and YUNARI_URL when the connection fails", async () => {
    const host = await fakeHost(() => undefined);
    const url = host.url;
    await host.close();
    hosts.splice(hosts.indexOf(host), 1);

    await expect(new HttpHostClient(url).listThemes()).rejects.toThrow(
      new RegExp(
        `Could not reach the Yunari host at ${url}.*http://127\\.0\\.0\\.1:5227.*YUNARI_URL`,
        "u",
      ),
    );
  });
});
