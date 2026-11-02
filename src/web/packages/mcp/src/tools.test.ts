import type { CallToolResult } from "@modelcontextprotocol/server";
import { addAsset, createBlankTheme } from "@yunari/theme-kit";
import { afterEach, describe, expect, it } from "vitest";
import { InMemoryDraftStore } from "./drafts.js";
import { HttpHostClient } from "./host-client.js";
import { type FakeHost, startFakeHost } from "./testing/fake-host.js";
import { importAsset, previewAsset, searchAssets } from "./tools/assets.js";
import {
  addBinding,
  addCard,
  addChart,
  addIcon,
  addImage,
  addShape,
  addText,
  groupObjects,
  listObjects,
  removeObject,
  ungroupObjects,
  updateObject,
} from "./tools/compose.js";
import {
  createTheme,
  discardDraft,
  openTheme,
  setArtboard,
  setBackground,
  setPalette,
  setThemeMetadata,
  setTypeTokens,
} from "./tools/draft.js";
import {
  assignTheme,
  browserViewport,
  previewTheme,
  saveTheme,
  validateTheme,
} from "./tools/verify.js";
import type { ToolContext } from "./types.js";

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

function payload(result: CallToolResult): Record<string, unknown> {
  const block = result.content[0];
  if (block?.type !== "text") {
    throw new Error("Expected a text content block.");
  }
  return JSON.parse(block.text) as Record<string, unknown>;
}

function refusalTextOf(result: CallToolResult): string {
  const block = result.content[0];
  if (block?.type !== "text") throw new Error("Expected a text content block.");
  return block.text;
}

/** The draft's root scene objects, for assertions no tool result exposes. */
function sceneObjects(ctx: ToolContext): Record<string, unknown>[] {
  const scene = ctx.drafts.current().envelope.scene as unknown as {
    objects?: Record<string, unknown>[];
  };
  return scene.objects ?? [];
}

const panelDisplay = {
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

const localDisplay = {
  id: "this-pc",
  label: "Host",
  kind: "local",
  theme: null,
  shape: "rect",
  rotation: 0,
};

/** The routes every save/preview test needs, with the panel opt-in. */
function hostHandler(options: { readonly panel?: boolean } = {}) {
  const png = Buffer.from([137, 80, 78, 71]);
  return (request: { readonly method: string; readonly path: string }) => {
    const url = new URL(request.path, "http://127.0.0.1");
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
    if (url.pathname.startsWith("/api/themes/") && request.method === "PUT") {
      const id = url.pathname.slice("/api/themes/".length);
      return { body: { ok: true, id, base: "base-1", name: "Mine" } };
    }
    return undefined;
  };
}

describe("draft authoring and verification", () => {
  it("creates, composes, validates, previews, saves and assigns a theme", async () => {
    const host = await startFakeHost(hostHandler());
    hosts.push(host);
    const ctx = context(host);

    const created = payload(
      await createTheme(ctx, { name: "Mine", width: 1672, height: 941 }),
    );
    const themeId = created.themeId as string;
    expect(created.origin).toBe("new");

    const text = payload(
      await addText(ctx, {
        box: { left: 100, top: 100, width: 300, height: 40 },
        runs: [{ kind: "literal", text: "CPU", token: "text", size: 24 }],
      }),
    );
    expect(text.ids).toHaveLength(1);

    const validated = payload(await validateTheme(ctx, themeId));
    expect(validated.ok).toBe(true);

    const preview = payload(await previewTheme(ctx, undefined, themeId));
    expect(preview.url).toBe(`${host.url}/?theme=${themeId}`);
    expect(preview.viewport).toEqual({ width: 1600, height: 900 });
    expect(preview.shape).toBe("rect");

    const saved = payload(await saveTheme(ctx, themeId));
    expect(saved).toMatchObject({ ok: true, base: "base-1", saved: true });

    const assigned = payload(await assignTheme(ctx, "this-pc", themeId));
    expect(assigned).toMatchObject({ display: "this-pc", theme: themeId });
    expect(
      host.requests.some(
        (request) =>
          request.method === "PUT" && request.path === "/api/themes/active",
      ),
    ).toBe(true);
  });

  it("refuses to open a stored theme without confirmExisting, then opens with it", async () => {
    const host = await startFakeHost((request) => {
      const url = new URL(request.path, "http://127.0.0.1");
      if (url.pathname === "/api/themes/stored" && request.method === "GET") {
        const envelope = createBlankTheme({
          artboard: { width: 800, height: 480 },
          name: "Stored",
        });
        return {
          body: {
            envelope: { ...envelope, id: "stored" },
            assets: {},
            base: "hash",
          },
        };
      }
      return hostHandler()(request);
    });
    hosts.push(host);
    const ctx = context(host);

    const refused = await openTheme(ctx, "stored", false);
    expect(refused.isError).toBe(true);
    const refusal = refused.content[0];
    expect(refusal?.type).toBe("text");
    if (refusal?.type === "text") {
      expect(refusal.text).toContain("confirmExisting");
    }

    const opened = payload(await openTheme(ctx, "stored", true));
    expect(opened).toMatchObject({ themeId: "stored", origin: "opened" });

    await saveTheme(ctx, "stored");
    const put = host.requests.find(
      (request) =>
        request.method === "PUT" && request.path === "/api/themes/stored",
    );
    expect(JSON.parse(put?.body.toString() ?? "{}")).toMatchObject({
      base: "hash",
    });
  });

  it("saves the draft before a panel preview and returns a PNG", async () => {
    const host = await startFakeHost(hostHandler({ panel: true }));
    hosts.push(host);
    const ctx = context(host);
    const created = payload(
      await createTheme(ctx, { name: "Mine", width: 800, height: 480 }),
    );
    const themeId = created.themeId as string;

    const result = await previewTheme(ctx, "panel-1", themeId);

    expect(result.isError).toBeUndefined();
    expect(result.content.map((block) => block.type)).toEqual([
      "text",
      "image",
    ]);
    const image = result.content[1];
    expect(image?.type).toBe("image");
    if (image?.type === "image") {
      expect(image.mimeType).toBe("image/png");
      expect(image.data).toBe(
        Buffer.from([137, 80, 78, 71]).toString("base64"),
      );
    }
    expect(payload(result)).toMatchObject({
      mode: "panel",
      saved: true,
      geometry: { width: 800, height: 480 },
    });

    const order = host.requests.map(
      (request) => `${request.method} ${request.path.split("?")[0]}`,
    );
    expect(order).toContain(`PUT /api/themes/${themeId}`);
    expect(Number(order.indexOf(`PUT /api/themes/${themeId}`))).toBeLessThan(
      order.findIndex((entry) => entry.endsWith("/panel-preview")),
    );
  });

  it("relays validator issues and writes nothing for an invalid envelope", async () => {
    const host = await startFakeHost(hostHandler());
    hosts.push(host);
    const ctx = context(host);
    const created = payload(
      await createTheme(ctx, { name: "Mine", width: 800, height: 480 }),
    );
    const themeId = created.themeId as string;
    const draft = ctx.drafts.read(themeId);
    draft.envelope = { ...draft.envelope, schemaVersion: "1.0.0" } as never;

    const validated = payload(await validateTheme(ctx, themeId));
    expect(validated.ok).toBe(false);
    expect((validated.issues as unknown[]).length).toBeGreaterThan(0);

    const saved = await saveTheme(ctx, themeId);
    expect(saved.isError).toBe(true);
    expect(payload(saved).ok).toBe(false);
    expect(host.requests.some((request) => request.method === "PUT")).toBe(
      false,
    );
  });

  it("refuses to save a draft whose declared asset has no bytes", async () => {
    const host = await startFakeHost(hostHandler());
    hosts.push(host);
    const ctx = context(host);
    const created = payload(
      await createTheme(ctx, { name: "Mine", width: 800, height: 480 }),
    );
    const themeId = created.themeId as string;
    const draft = ctx.drafts.read(themeId);
    draft.envelope = addAsset(
      draft.envelope,
      {
        id: "dot",
        kind: "image",
        path: "assets/dot.png",
        license: { name: "MIT" },
      },
      new Uint8Array([1]),
    );

    const saved = await saveTheme(ctx, themeId);

    expect(saved.isError).toBe(true);
    const issues = payload(saved).issues as { code: string }[];
    expect(issues.map((issue) => issue.code)).toContain("missing-asset-bytes");
    expect(host.requests.some((request) => request.method === "PUT")).toBe(
      false,
    );
  });

  it("relays a save refusal and leaves the draft unsaved", async () => {
    const host = await startFakeHost((request) => {
      const url = new URL(request.path, "http://127.0.0.1");
      if (url.pathname.startsWith("/api/themes/") && request.method === "PUT") {
        return { status: 409, body: "Theme changed on disk." };
      }
      return hostHandler()(request);
    });
    hosts.push(host);
    const ctx = context(host);
    const created = payload(
      await createTheme(ctx, { name: "Mine", width: 800, height: 480 }),
    );
    const themeId = created.themeId as string;

    const saved = await saveTheme(ctx, themeId);

    expect(saved.isError).toBe(true);
    expect(refusalTextOf(saved)).toMatch(/409.*Theme changed on disk\./u);
    expect(ctx.drafts.read(themeId).saved).toBeUndefined();
    expect(
      host.requests.filter((request) => request.method === "PUT"),
    ).toHaveLength(1);
  });

  it("does not capture a panel preview when the save is refused", async () => {
    const host = await startFakeHost((request) => {
      const url = new URL(request.path, "http://127.0.0.1");
      if (url.pathname.startsWith("/api/themes/") && request.method === "PUT") {
        return {
          status: 422,
          body: {
            error: "Invalid theme",
            issues: [{ code: "bad-path", path: "/a", message: "bad" }],
          },
        };
      }
      return hostHandler({ panel: true })(request);
    });
    hosts.push(host);
    const ctx = context(host);
    const created = payload(
      await createTheme(ctx, { name: "Mine", width: 800, height: 480 }),
    );
    const themeId = created.themeId as string;

    const result = await previewTheme(ctx, "panel-1", themeId);

    expect(result.isError).toBe(true);
    expect(result.content.map((block) => block.type)).toEqual(["text"]);
    expect(payload(result)).toMatchObject({
      ok: false,
      status: 422,
      issues: [{ code: "bad-path", path: "/a" }],
    });
    expect(
      host.requests.some((request) => request.path.includes("panel-preview")),
    ).toBe(false);
  });

  it("reports bound sensors the host did not measure in a browser preview", async () => {
    const host = await startFakeHost(hostHandler());
    hosts.push(host);
    const ctx = context(host);
    const created = payload(
      await createTheme(ctx, { name: "Mine", width: 800, height: 480 }),
    );
    const themeId = created.themeId as string;
    await addText(ctx, {
      box: { left: 0, top: 0, width: 200, height: 24 },
      runs: [
        { kind: "value", bindingId: "cpu", size: 20 },
        { kind: "value", bindingId: "gpu", size: 20 },
      ],
      bindings: [
        { id: "cpu", semanticKey: "cpu.load" },
        { id: "gpu", semanticKey: "gpu.load" },
      ],
    });

    const preview = payload(await previewTheme(ctx, "this-pc", themeId));

    expect(preview.boundSensors).toEqual(
      expect.arrayContaining(["cpu.load", "gpu.load"]),
    );
    expect(preview.missingSensors).toEqual(["gpu.load"]);
  });

  it("names the requested theme id on open and assign refusals", async () => {
    const host = await startFakeHost((request) => {
      const url = new URL(request.path, "http://127.0.0.1");
      if (url.pathname === "/api/themes/active" && request.method === "PUT") {
        return { status: 400, body: "No such theme." };
      }
      return hostHandler()(request);
    });
    hosts.push(host);
    const ctx = context(host);

    const opened = await openTheme(ctx, "ghost", true);
    expect(opened.isError).toBe(true);
    expect(refusalTextOf(opened)).toContain('"ghost"');

    const assigned = await assignTheme(ctx, "this-pc", "ghost");
    expect(assigned.isError).toBe(true);
    expect(refusalTextOf(assigned)).toContain('"ghost"');
  });

  it("refuses unknown object ids by name", async () => {
    const host = await startFakeHost(hostHandler());
    hosts.push(host);
    const ctx = context(host);
    const created = payload(
      await createTheme(ctx, { name: "Mine", width: 800, height: 480 }),
    );

    const patched = await updateObject(ctx, "nope", { left: 1 });
    expect(patched.isError).toBe(true);
    expect((patched.content[0] as { text: string }).text).toContain('"nope"');

    const bound = await addBinding(ctx, "nope", [
      { id: "b", semanticKey: "cpu.load" },
    ]);
    expect(bound.isError).toBe(true);

    const removed = await removeObject(ctx, "nope");
    expect(removed.isError).toBe(true);
    expect(created.themeId).toBeTypeOf("string");
  });

  it("refuses an unknown semantic key by name on every binding path", async () => {
    const host = await startFakeHost(hostHandler());
    hosts.push(host);
    const ctx = context(host);
    await createTheme(ctx, { name: "Mine", width: 800, height: 480 });
    const shape = payload(
      await addShape(ctx, {
        kind: "rect",
        box: { left: 0, top: 0, width: 10, height: 10 },
      }),
    );
    const objectId = (shape.ids as string[])[0] as string;

    const bound = await addBinding(ctx, objectId, [
      { id: "b", semanticKey: "cpu.lod" },
    ]);
    expect(bound.isError).toBe(true);
    expect(refusalTextOf(bound)).toContain('"cpu.lod"');
    expect(refusalTextOf(bound)).toContain("list_sensors");

    const text = await addText(ctx, {
      box: { left: 0, top: 0, width: 100, height: 20 },
      runs: [{ kind: "value", bindingId: "b", size: 20 }],
      bindings: [{ id: "b", semanticKey: "cpu.lod" }],
    });
    expect(text.isError).toBe(true);
    expect(refusalTextOf(text)).toContain('"cpu.lod"');

    const chart = await addChart(ctx, {
      family: "line",
      box: { left: 0, top: 0, width: 100, height: 100 },
      binding: { id: "b", semanticKey: "cpu.lod" },
    });
    expect(chart.isError).toBe(true);
    expect(refusalTextOf(chart)).toContain('"cpu.lod"');
  });

  it("builds an image, an icon, a chart and a new artboard", async () => {
    const host = await startFakeHost(hostHandler());
    hosts.push(host);
    const ctx = context(host);
    const created = payload(
      await createTheme(ctx, { name: "Mine", width: 800, height: 480 }),
    );
    const themeId = created.themeId as string;
    await setPalette(ctx, [
      { id: "cpu", name: "CPU", value: "#4da3ff" },
      { id: "sparkArea", name: "Spark area", value: "#4da3ff" },
    ]);
    const draft = ctx.drafts.read(themeId);
    const bytes = new Uint8Array([1, 2, 3]);
    draft.envelope = addAsset(
      draft.envelope,
      {
        id: "photo",
        kind: "image",
        path: "assets/photo.png",
        license: { name: "MIT" },
      },
      bytes,
    );
    ctx.drafts.setAsset(themeId, "assets/photo.png", bytes);

    const image = payload(
      await addImage(ctx, {
        assetId: "photo",
        box: { left: 0, top: 0, width: 100, height: 100 },
      }),
    );
    expect(image.ids).toHaveLength(1);

    const icon = payload(
      await addIcon(ctx, {
        icon: "cpu",
        box: { left: 10, top: 10, width: 24, height: 24 },
      }),
    );
    expect(icon.ids).toHaveLength(1);

    const chart = payload(
      await addChart(ctx, {
        family: "line",
        box: { left: 100, top: 100, width: 200, height: 100 },
        binding: { id: "cpu-load", semanticKey: "cpu.load" },
        settings: {
          stroke: { ref: "palette.cpu" },
          area: { ref: "palette.sparkArea" },
        },
      }),
    );
    expect(chart.ids).toHaveLength(1);

    const artboard = payload(
      await setArtboard(ctx, { width: 1000, height: 1000, shape: "circle" }),
    );
    expect(artboard.artboard).toEqual({
      width: 1000,
      height: 1000,
      shape: "circle",
    });
    const validated = payload(await validateTheme(ctx, themeId));
    expect(validated).toMatchObject({ ok: true, issues: [] });
  });

  it("keeps a type token's packaged face on a weight-only update", async () => {
    const host = await startFakeHost(hostHandler());
    hosts.push(host);
    const ctx = context(host);
    const created = payload(
      await createTheme(ctx, { name: "Mine", width: 800, height: 480 }),
    );
    const themeId = created.themeId as string;
    const draft = ctx.drafts.read(themeId);
    draft.envelope = {
      ...draft.envelope,
      globals: {
        ...draft.envelope.globals,
        typeTokens: {
          heading: { family: "Segoe UI", weight: "600" },
          body: {
            family: "Packaged",
            weight: "400",
            face: { assetId: "font-1" },
          },
          mono: { family: "Consolas", weight: "400" },
        },
      },
    };

    await setTypeTokens(ctx, { body: { weight: "500" } });

    const tokens = ctx.drafts.read(themeId).envelope.globals
      ?.typeTokens as Record<string, unknown>;
    expect(tokens["body"]).toEqual({
      family: "Packaged",
      weight: "500",
      face: { assetId: "font-1" },
    });
  });

  it("paints a token declared by set_palette", async () => {
    const host = await startFakeHost(hostHandler());
    hosts.push(host);
    const ctx = context(host);
    const created = payload(
      await createTheme(ctx, { name: "Mine", width: 800, height: 480 }),
    );
    const themeId = created.themeId as string;
    await setPalette(ctx, [{ id: "accent", name: "Accent", value: "#ff0000" }]);

    const text = payload(
      await addText(ctx, {
        box: { left: 0, top: 0, width: 100, height: 24 },
        runs: [{ kind: "literal", text: "A", token: "accent", size: 24 }],
      }),
    );
    const shape = payload(
      await addShape(ctx, {
        kind: "rect",
        box: { left: 0, top: 40, width: 40, height: 40 },
        token: "accent",
      }),
    );
    const icon = payload(
      await addIcon(ctx, {
        icon: "cpu",
        box: { left: 60, top: 40, width: 24, height: 24 },
        token: "accent",
      }),
    );
    const ids = new Set([
      ...(text.ids as string[]),
      ...(shape.ids as string[]),
      ...(icon.ids as string[]),
    ]);
    const painted = sceneObjects(ctx).filter((object) =>
      ids.has(object["id"] as string),
    );
    expect(painted).toHaveLength(3);
    for (const object of painted) {
      expect(object["fill"]).toBe("#ff0000");
      expect(object["yunariPaint"]).toEqual({ fill: "palette.accent" });
    }
    expect(payload(await validateTheme(ctx, themeId)).ok).toBe(true);
  });

  it("keeps the metadata, palette, type, background and discard tools local", async () => {
    const host = await startFakeHost(hostHandler());
    hosts.push(host);
    const ctx = context(host);
    const created = payload(
      await createTheme(ctx, { name: "Mine", width: 800, height: 480 }),
    );
    const themeId = created.themeId as string;

    await setThemeMetadata(ctx, { name: "Renamed", tags: ["dark"] });
    await setPalette(ctx, [
      { id: "accent", name: "Accent", value: "#ff0000" },
      { id: "fade", name: "Fade", value: { kind: "solid", color: "#000000" } },
    ]);
    await setTypeTokens(ctx, { body: { family: "Georgia", weight: "400" } });
    await setBackground(ctx, { color: "accent" });

    const listed = payload(await listObjects(ctx, themeId));
    expect(listed.objects).toEqual([]);
    expect((await validateTheme(ctx, themeId)).isError).toBeUndefined();

    const discarded = payload(await discardDraft(ctx, themeId));
    expect(discarded.discarded).toBe(true);
    expect(host.requests).toHaveLength(0);
  });
});

describe("viewport", () => {
  it.each([
    [1920, 1080, "rect", { width: 1600, height: 900 }],
    [2340, 1080, "rect", { width: 1600, height: 738 }],
    [1600, 1200, "rect", { width: 1600, height: 1200 }],
    [800, 800, "rect", { width: 800, height: 800 }],
    [800, 800, "circle", { width: 800, height: 800 }],
    [2000, 2000, "circle", { width: 1600, height: 1600 }],
  ] as const)(
    "%ix%i %s keeps its aspect with the long edge capped",
    (width, height, shape, expected) => {
      expect(browserViewport({ width, height, shape })).toEqual(expected);
    },
  );
});

describe("asset tools", () => {
  it("searches, previews and imports a finder result with its credit", async () => {
    const svg = Buffer.from("<svg/>");
    const host = await startFakeHost((request) => {
      const url = new URL(request.path, "http://127.0.0.1");
      if (url.pathname === "/api/assets/search") {
        return {
          body: {
            pages: [
              {
                source: "lucide",
                results: [
                  {
                    id: "lucide:cpu",
                    name: "CPU",
                    kind: "svg",
                    preview: "https://example.test/cpu.svg",
                    licence: "ISC",
                    sourceUrl: "https://lucide.dev/icons/cpu",
                  },
                ],
                totalPages: 1,
              },
            ],
          },
        };
      }
      if (url.pathname === "/api/assets/bytes") {
        return {
          headers: { "x-yunari-filename": "cpu.svg" },
          body: svg,
        };
      }
      return hostHandler()(request);
    });
    hosts.push(host);
    const ctx = context(host);
    await createTheme(ctx, { name: "Mine", width: 800, height: 480 });

    const found = payload(await searchAssets(ctx, "cpu", ["lucide"], 1));
    const row = (found.results as { assetRef: string }[])[0];
    expect(row?.assetRef).toBeTypeOf("string");

    const preview = await previewAsset(ctx, row?.assetRef as string);
    expect(preview.content[1]?.type).toBe("image");
    if (preview.content[1]?.type === "image") {
      expect(preview.content[1].mimeType).toBe("image/svg+xml");
    }

    const imported = payload(
      await importAsset(ctx, { assetRef: row?.assetRef as string }),
    );
    expect(imported).toMatchObject({ kind: "svg", bytes: svg.byteLength });
    expect(imported.credit).toMatchObject({
      kind: "svg",
      title: "CPU",
      license: "ISC",
      source: { url: "https://lucide.dev/icons/cpu" },
    });

    const saved = payload(await saveTheme(ctx));
    expect(saved.ok).toBe(true);
  });

  it("credits a trimmed video with the trim it applied", async () => {
    const host = await startFakeHost((request) => {
      const url = new URL(request.path, "http://127.0.0.1");
      if (url.pathname === "/api/assets/search") {
        return {
          body: {
            pages: [
              {
                source: "pexels",
                results: [
                  {
                    id: "pexels:clip",
                    name: "Clip",
                    kind: "video",
                    preview: "https://example.test/clip.jpg",
                    licence: "CC0",
                    sourceUrl: "https://example.test/clip",
                  },
                ],
                totalPages: 1,
              },
            ],
          },
        };
      }
      if (url.pathname === "/api/assets/bytes") {
        return {
          headers: { "x-yunari-filename": "clip.mp4" },
          body: Buffer.from([1, 2]),
        };
      }
      if (url.pathname === "/api/themes/normalize-video") {
        return {
          body: {
            ok: true,
            bytesBase64: Buffer.from([3, 4, 5]).toString("base64"),
          },
        };
      }
      return hostHandler()(request);
    });
    hosts.push(host);
    const ctx = context(host);
    await createTheme(ctx, { name: "Mine", width: 800, height: 480 });
    const found = payload(await searchAssets(ctx, "clip", ["pexels"], 1));
    const ref = (found.results as { assetRef: string }[])[0]
      ?.assetRef as string;

    const imported = payload(
      await importAsset(ctx, { assetRef: ref, startMs: 100, endMs: 900 }),
    );

    expect(imported.credit).toMatchObject({
      kind: "video",
      changes: "Trimmed to 100-900 ms.",
    });
  });

  it("refuses a local import without the user's stated licence", async () => {
    const host = await startFakeHost(hostHandler());
    hosts.push(host);
    const ctx = context(host);
    await createTheme(ctx, { name: "Mine", width: 800, height: 480 });

    const result = await importAsset(ctx, { path: "C:/tmp/dot.png" });

    expect(result.isError).toBe(true);
    expect((result.content[0] as { text: string }).text).toMatch(/licence/u);
  });
});

describe("grouping", () => {
  it("groups root objects and lifts their children back out", async () => {
    const host = await startFakeHost(hostHandler());
    hosts.push(host);
    const ctx = context(host);
    await createTheme(ctx, { name: "Mine", width: 800, height: 480 });
    const first = payload(
      await addShape(ctx, {
        kind: "rect",
        box: { left: 10, top: 10, width: 100, height: 100 },
      }),
    );
    const second = payload(
      await addShape(ctx, {
        kind: "ellipse",
        box: { left: 200, top: 100, width: 100, height: 100 },
      }),
    );
    const ids = [...(first.ids as string[]), ...(second.ids as string[])];

    const grouped = payload(await groupObjects(ctx, ids));
    expect(grouped.groupId).toBeTypeOf("string");
    expect((grouped.ids as string[]).length).toBe(2);

    const ungrouped = payload(
      await ungroupObjects(ctx, grouped.groupId as string),
    );
    expect((ungrouped.ids as string[]).length).toBe(2);
    expect((payload(await listObjects(ctx)).objects as unknown[]).length).toBe(
      2,
    );
  });

  it("groups a library card without stranding its bindings", async () => {
    const host = await startFakeHost(hostHandler());
    hosts.push(host);
    const ctx = context(host);
    await createTheme(ctx, { name: "Mine", width: 1672, height: 941 });
    const card = payload(
      await addCard(ctx, { unit: "group-cpu-card", left: 0, top: 0 }),
    );

    await groupObjects(ctx, [(card.ids as string[])[0] as string]);

    const validated = payload(await validateTheme(ctx));
    expect(validated.ok).toBe(true);
  });

  it("groups a centre-anchored chart by its true bounding box", async () => {
    const host = await startFakeHost(hostHandler());
    hosts.push(host);
    const ctx = context(host);
    await createTheme(ctx, { name: "Mine", width: 800, height: 480 });
    const chart = payload(
      await addChart(ctx, {
        family: "line",
        box: { left: 400, top: 240, width: 200, height: 100 },
        binding: { id: "cpu-load", semanticKey: "cpu.load" },
      }),
    );
    const shape = payload(
      await addShape(ctx, {
        kind: "rect",
        box: { left: 500, top: 300, width: 100, height: 100 },
      }),
    );

    const grouped = payload(
      await groupObjects(ctx, [
        ...(chart.ids as string[]),
        ...(shape.ids as string[]),
      ]),
    );

    const group = sceneObjects(ctx).find(
      (object) => object["id"] === grouped.groupId,
    );
    expect(group).toMatchObject({
      type: "Group",
      left: 300,
      top: 190,
      width: 300,
      height: 210,
    });
  });

  it("adds a library card and reports the ids it created", async () => {
    const host = await startFakeHost(hostHandler());
    hosts.push(host);
    const ctx = context(host);
    await createTheme(ctx, { name: "Mine", width: 1672, height: 941 });

    const card = payload(
      await addCard(ctx, { unit: "group-cpu-card", left: 0, top: 0 }),
    );

    expect((card.ids as string[]).length).toBeGreaterThan(1);
    expect(card.issues).toEqual(expect.any(Array));
    expect((await validateTheme(ctx)).isError).toBeUndefined();
  });
});
