import type { CallToolResult } from "@modelcontextprotocol/server";
import { createStarterTheme } from "@yunari/theme-kit";
import {
  readWidgetPackage,
  type WidgetPackSummary,
  writeWidgetPackage,
} from "@yunari/theme-package";
import { InMemoryDraftStore } from "../drafts.js";
import { HttpHostClient } from "../host-client.js";
import type { ToolContext } from "../types.js";
import { type FakeHost, startFakeHost } from "./fake-host.js";

const hosts: FakeHost[] = [];

/** Starts a fake host and remembers it for `closeHosts`. */
export async function startHost(
  handler: Parameters<typeof startFakeHost>[0],
): Promise<FakeHost> {
  const host = await startFakeHost(handler);
  hosts.push(host);
  return host;
}

/** Closes every host a suite started. Call it from `afterEach`. */
export async function closeHosts(): Promise<void> {
  await Promise.all(hosts.splice(0).map((host) => host.close()));
}

export function context(host: FakeHost): ToolContext {
  return {
    host: new HttpHostClient(host.url),
    drafts: new InMemoryDraftStore(),
  };
}

export function payload(result: CallToolResult): Record<string, unknown> {
  const block = result.content[0];
  if (block?.type !== "text") {
    throw new Error("Expected a text content block.");
  }
  return JSON.parse(block.text) as Record<string, unknown>;
}

export function refusalTextOf(result: CallToolResult): string {
  const block = result.content[0];
  if (block?.type !== "text") throw new Error("Expected a text content block.");
  return block.text;
}

/** The draft's root scene objects, for assertions no tool result exposes. */
export function sceneObjects(ctx: ToolContext): Record<string, unknown>[] {
  const scene = ctx.drafts.current().envelope.scene as unknown as {
    objects?: Record<string, unknown>[];
  };
  return scene.objects ?? [];
}

export const panelDisplay = {
  id: "panel-1",
  label: "TURZX",
  kind: "panel",
  theme: null,
  shape: "rect",
  rotation: 0,
  panel: {
    status: "connected",
    commands: ["brightness"],
    geometry: { width: 800, height: 480 },
  },
};

export const localDisplay = {
  id: "this-pc",
  label: "Host",
  kind: "local",
  theme: null,
  shape: "rect",
  rotation: 0,
};

/** The starter composition as one installed pack: the units every existing
 *  add_card case names. Built once, like the host would have stored it. */
const STARTER_PACK_ID = "yunari-starter";
let starterPack: { readonly bytes: Uint8Array } | undefined;

function starterPackOf(): {
  readonly bytes: Uint8Array;
  readonly summary: WidgetPackSummary;
} {
  if (starterPack === undefined) {
    const { artboard: _artboard, ...document } = createStarterTheme();
    const written = writeWidgetPackage({ document, assets: {} });
    if (!written.ok) throw new Error(written.message);
    starterPack = { bytes: written.bytes };
  }
  const read = readWidgetPackage(starterPack.bytes);
  if (!read.ok) throw new Error(read.message);
  return {
    bytes: starterPack.bytes,
    summary: {
      id: STARTER_PACK_ID,
      name: read.name ?? STARTER_PACK_ID,
      version: read.version,
      units: read.units.map((unit) => ({ id: unit.id, label: unit.label })),
    },
  };
}

/** The routes every save/preview test needs, with the panel opt-in. */
export function hostHandler(options: { readonly panel?: boolean } = {}) {
  const png = Buffer.from([137, 80, 78, 71]);
  return (request: { readonly method: string; readonly path: string }) => {
    const url = new URL(request.path, "http://127.0.0.1");
    if (url.pathname === "/api/widget-packs" && request.method === "GET") {
      return { body: { packs: [starterPackOf().summary] } };
    }
    if (
      url.pathname === `/api/widget-packs/${STARTER_PACK_ID}` &&
      request.method === "GET"
    ) {
      return {
        headers: { "content-type": "application/zip" },
        body: Buffer.from(starterPackOf().bytes),
      };
    }
    if (url.pathname === "/api/themes/active" && request.method === "GET") {
      return {
        body: {
          default: null,
          displays: [localDisplay, ...(options.panel ? [panelDisplay] : [])],
        },
      };
    }
    if (url.pathname === "/api/themes/active" && request.method === "PUT") {
      return { body: { ok: true } };
    }
    if (url.pathname === "/api/sensors") {
      return { body: { sensors: [], measured: ["cpu.load"] } };
    }
    if (url.pathname.endsWith("/panel-preview")) {
      return { headers: { "content-type": "image/png" }, body: png };
    }
    if (
      url.pathname.endsWith("/thumbnail/capture") &&
      request.method === "POST"
    ) {
      return { body: { ok: true, captured: true } };
    }
    if (url.pathname.startsWith("/api/themes/") && request.method === "PUT") {
      const id = url.pathname.slice("/api/themes/".length);
      return { body: { ok: true, id, base: "base-1", name: "Mine" } };
    }
    return undefined;
  };
}
