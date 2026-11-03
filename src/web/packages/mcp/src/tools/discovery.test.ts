import type { CallToolResult } from "@modelcontextprotocol/server";
import { afterEach, describe, expect, it } from "vitest";
import { InMemoryDraftStore } from "../drafts.js";
import { HttpHostClient } from "../host-client.js";
import {
  type FakeHost,
  startFakeHost,
  testEnvelope,
} from "../testing/fake-host.js";
import type { ToolContext } from "../types.js";
import {
  getTheme,
  listAssetSources,
  listDisplays,
  listSensors,
  listThemes,
  yunariStatus,
} from "./discovery.js";

const hosts: FakeHost[] = [];

afterEach(async () => {
  await Promise.all(hosts.splice(0).map((host) => host.close()));
});

function context(host: FakeHost): ToolContext {
  return {
    host: new HttpHostClient(host.url),
    drafts: new InMemoryDraftStore(),
  };
}

function payload(result: CallToolResult): unknown {
  const block = result.content[0];
  if (block?.type !== "text") {
    throw new Error("Expected a text content block.");
  }
  return JSON.parse(block.text) as unknown;
}

describe("discovery tools", () => {
  it("reports the host status as text JSON", async () => {
    const host = await startFakeHost((_request, url) => {
      if (url.pathname === "/api/themes") {
        return { body: { themes: [{ id: "a", name: "A" }] } };
      }
      if (url.pathname === "/api/themes/active") {
        return { body: { default: null, displays: [] } };
      }
      if (url.pathname === "/api/sensors") {
        return { body: { sensors: [{ semanticKey: "cpu.load" }] } };
      }
      if (url.pathname === "/api/assets/sources") {
        return { body: { sources: [{ id: "lucide" }] } };
      }
      return undefined;
    });

    const result = await yunariStatus(context(host));

    expect(result.isError).toBeUndefined();
    expect(payload(result)).toEqual({
      url: host.url,
      reachable: true,
      themeCount: 1,
      displays: 0,
      sensorCount: 1,
      assetSources: ["lucide"],
      unavailable: [],
    });
  });

  it("maps displays including a panel's own state", async () => {
    const host = await startFakeHost((_request, url) =>
      url.pathname === "/api/themes/active"
        ? {
            body: {
              default: "a",
              displays: [
                {
                  id: "this-pc",
                  label: "Host",
                  kind: "local",
                  theme: "a",
                  shape: "rect",
                  rotation: 0,
                },
                {
                  id: "panel-1",
                  label: "TURZX",
                  kind: "panel",
                  theme: null,
                  shape: "rect",
                  rotation: 90,
                  panel: {
                    status: "connected",
                    commands: ["brightness"],
                    geometry: { width: 800, height: 480 },
                  },
                },
              ],
            },
          }
        : undefined,
    );

    expect(payload(await listDisplays(context(host)))).toEqual({
      default: "a",
      displays: [
        {
          id: "this-pc",
          label: "Host",
          kind: "local",
          shape: "rect",
          rotation: 0,
          theme: "a",
        },
        {
          id: "panel-1",
          label: "TURZX",
          kind: "panel",
          shape: "rect",
          rotation: 90,
          theme: null,
          panel: {
            status: "connected",
            commands: ["brightness"],
            geometry: { width: 800, height: 480 },
          },
        },
      ],
    });
  });

  it("marks a sensor measured only when the host answered its key", async () => {
    const host = await startFakeHost((_request, url) => {
      if (url.pathname !== "/api/sensors") return undefined;
      return url.searchParams.get("measured") === "1"
        ? {
            body: {
              sensors: [
                { semanticKey: "cpu.load", label: "CPU", family: "cpu" },
                { semanticKey: "gpu.temp", label: "GPU", unit: "°C" },
              ],
              measured: ["cpu.load"],
            },
          }
        : {
            body: {
              sensors: [
                { semanticKey: "cpu.load", label: "CPU", family: "cpu" },
                { semanticKey: "gpu.temp", label: "GPU", unit: "°C" },
              ],
            },
          };
    });
    const ctx = context(host);

    expect(payload(await listSensors(ctx, false))).toEqual({
      sensors: [
        {
          key: "cpu.load",
          family: "cpu",
          label: "CPU",
          measured: false,
        },
        {
          key: "gpu.temp",
          label: "GPU",
          unit: "°C",
          measured: false,
        },
      ],
      measured: false,
    });
    expect(payload(await listSensors(ctx, true))).toEqual({
      sensors: [
        {
          key: "cpu.load",
          family: "cpu",
          label: "CPU",
          measured: true,
        },
        {
          key: "gpu.temp",
          label: "GPU",
          unit: "°C",
          measured: false,
        },
      ],
      measured: true,
    });
    // Omitting the flag polls, so the host's answer is not silently dropped.
    expect(payload(await listSensors(ctx))).toEqual(
      payload(await listSensors(ctx, true)),
    );
  });

  it("lists themes from the library", async () => {
    const host = await startFakeHost((_request, url) =>
      url.pathname === "/api/themes"
        ? {
            body: {
              themes: [
                {
                  id: "a",
                  name: "A",
                  facets: { width: 800, height: 480 },
                },
              ],
            },
          }
        : undefined,
    );

    expect(payload(await listThemes(context(host)))).toEqual([
      { id: "a", name: "A", artboard: { width: 800, height: 480 } },
    ]);
  });

  it("returns a theme's envelope, asset paths and credits but never bytes", async () => {
    const host = await startFakeHost((_request, url) =>
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

    const result = await getTheme(context(host), "abc");
    const body = payload(result) as {
      envelope: { id: string };
      assetPaths: string[];
      base?: string;
      assets?: unknown;
    };

    expect(body.envelope.id).toBe("abc");
    expect(body.assetPaths).toEqual(["assets/dot.png"]);
    expect(body.base).toBe("hash");
    expect("assets" in body).toBe(false);
  });

  it("lists asset sources with their credential requirement", async () => {
    const host = await startFakeHost((_request, url) =>
      url.pathname === "/api/assets/sources"
        ? {
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
          }
        : undefined,
    );

    expect(payload(await listAssetSources(context(host)))).toEqual([
      { id: "lucide", label: "Lucide", category: "icon", requires: null },
    ]);
  });

  it("turns a host refusal into a tool error naming the reason", async () => {
    const host = await startFakeHost((_request, url) =>
      url.pathname === "/api/themes/missing"
        ? { status: 404, body: "Theme not found." }
        : undefined,
    );

    const result = await getTheme(context(host), "missing");

    expect(result.isError).toBe(true);
    const block = result.content[0];
    expect(block?.type).toBe("text");
    if (block?.type === "text") {
      expect(block.text).toMatch(/404: Theme not found\./u);
    }
  });
});
