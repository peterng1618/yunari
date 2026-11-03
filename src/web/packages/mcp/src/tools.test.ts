import { addAsset, createBlankTheme } from "@yunari/theme-kit";
import { afterEach, describe, expect, it } from "vitest";
import {
  closeHosts,
  context,
  hostHandler,
  payload,
  refusalTextOf,
  sceneObjects,
  startHost,
} from "./testing/tool-fixtures.js";
import {
  addBinding,
  addChart,
  addIcon,
  addImage,
  addShape,
  addText,
  listObjects,
  removeObject,
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

afterEach(closeHosts);

describe("draft authoring and verification", () => {
  it("creates, composes, validates, previews, saves and assigns a theme", async () => {
    const host = await startHost(hostHandler());
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
    const host = await startHost((request) => {
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
    const host = await startHost(hostHandler({ panel: true }));
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

  it("saves an opened draft before a browser preview returns its URL", async () => {
    const host = await startHost((request) => {
      const url = new URL(request.path, "http://127.0.0.1");
      if (url.pathname === "/api/themes/stored" && request.method === "GET") {
        const envelope = createBlankTheme({
          artboard: { width: 800, height: 480 },
          name: "Stored",
        });
        return {
          body: { envelope: { ...envelope, id: "stored" }, assets: {} },
        };
      }
      return hostHandler()(request);
    });
    const ctx = context(host);
    await openTheme(ctx, "stored", true);

    const preview = payload(await previewTheme(ctx, undefined, "stored"));

    expect(preview).toMatchObject({
      mode: "browser",
      saved: true,
      url: `${host.url}/?theme=stored`,
    });
    const order = host.requests.map(
      (request) => `${request.method} ${request.path.split("?")[0]}`,
    );
    expect(order).toContain("PUT /api/themes/stored");
  });

  it("returns validator issues and no URL when a browser preview's save is refused", async () => {
    const host = await startHost((request) => {
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
      return hostHandler()(request);
    });
    const ctx = context(host);
    const created = payload(
      await createTheme(ctx, { name: "Mine", width: 800, height: 480 }),
    );
    const themeId = created.themeId as string;

    const result = await previewTheme(ctx, undefined, themeId);

    expect(result.isError).toBe(true);
    const body = payload(result);
    expect(body).toMatchObject({
      ok: false,
      status: 422,
      issues: [{ code: "bad-path", path: "/a" }],
    });
    expect("url" in body).toBe(false);
  });

  it("keeps the content fit create_theme was given", async () => {
    const host = await startHost(hostHandler());
    const ctx = context(host);

    const created = payload(
      await createTheme(ctx, {
        name: "Cover",
        width: 800,
        height: 480,
        contentFit: "cover",
      }),
    );

    expect(
      (created.envelope as { artboard: { contentFit?: string } }).artboard,
    ).toMatchObject({ contentFit: "cover" });
    expect(payload(await validateTheme(ctx)).ok).toBe(true);
  });

  it("refuses shape fields the kind cannot express", async () => {
    const host = await startHost(hostHandler());
    const ctx = context(host);
    await createTheme(ctx, { name: "Mine", width: 800, height: 480 });
    const box = { left: 0, top: 0, width: 10, height: 10 };

    const rectPoints = await addShape(ctx, {
      kind: "rect",
      box,
      points: [["M", 0, 0]],
    });
    expect(refusalTextOf(rectPoints)).toContain('"points"');

    const ellipseStroke = await addShape(ctx, {
      kind: "ellipse",
      box,
      strokeWidth: 2,
    });
    expect(refusalTextOf(ellipseStroke)).toContain('"strokeWidth"');

    const ellipseRadius = await addShape(ctx, {
      kind: "ellipse",
      box,
      radius: 4,
    });
    expect(refusalTextOf(ellipseRadius)).toContain('"radius"');

    const pathRadius = await addShape(ctx, {
      kind: "path",
      box,
      points: [["M", 0, 0]],
      radius: 4,
    });
    expect(refusalTextOf(pathRadius)).toContain('"radius"');

    // The valid forms stay green: a path's commands and stroke, a rect's radius.
    expect(
      (
        await addShape(ctx, {
          kind: "path",
          box,
          points: [
            ["M", 0, 0],
            ["L", 10, 10],
          ],
          strokeWidth: 2,
        })
      ).isError,
    ).toBeUndefined();
    expect(
      (await addShape(ctx, { kind: "rect", box, radius: 4 })).isError,
    ).toBe(undefined);
  });

  it("relays validator issues and writes nothing for an invalid envelope", async () => {
    const host = await startHost(hostHandler());
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
    const host = await startHost(hostHandler());
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
    const host = await startHost((request) => {
      const url = new URL(request.path, "http://127.0.0.1");
      if (url.pathname.startsWith("/api/themes/") && request.method === "PUT") {
        return { status: 409, body: "Theme changed on disk." };
      }
      return hostHandler()(request);
    });
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
    const host = await startHost((request) => {
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
    const host = await startHost(hostHandler());
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
    const host = await startHost((request) => {
      const url = new URL(request.path, "http://127.0.0.1");
      if (url.pathname === "/api/themes/active" && request.method === "PUT") {
        return { status: 400, body: "No such theme." };
      }
      return hostHandler()(request);
    });
    const ctx = context(host);

    const opened = await openTheme(ctx, "ghost", true);
    expect(opened.isError).toBe(true);
    expect(refusalTextOf(opened)).toContain('"ghost"');

    const assigned = await assignTheme(ctx, "this-pc", "ghost");
    expect(assigned.isError).toBe(true);
    expect(refusalTextOf(assigned)).toContain('"ghost"');
  });

  it("refuses unknown object ids by name", async () => {
    const host = await startHost(hostHandler());
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
    const host = await startHost(hostHandler());
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
    const host = await startHost(hostHandler());
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
    const host = await startHost(hostHandler());
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
    const host = await startHost(hostHandler());
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
      const glyph = object["type"] === "Path";
      expect(object[glyph ? "stroke" : "fill"]).toBe("#ff0000");
      expect(object["yunariPaint"]).toEqual({
        [glyph ? "stroke" : "fill"]: "palette.accent",
      });
    }
    expect(payload(await validateTheme(ctx, themeId)).ok).toBe(true);
  });

  it("paints a gradient token declared by set_palette", async () => {
    const host = await startHost(hostHandler());
    const ctx = context(host);
    const created = payload(
      await createTheme(ctx, { name: "Mine", width: 800, height: 480 }),
    );
    const themeId = created.themeId as string;
    await setPalette(ctx, [
      {
        id: "fade",
        name: "Fade",
        value: {
          kind: "gradient",
          angle: 90,
          stops: [
            { offset: 0, color: "#ff0000" },
            { offset: 1, color: "#0000ff" },
          ],
        },
      },
    ]);

    await addText(ctx, {
      box: { left: 0, top: 0, width: 100, height: 24 },
      runs: [{ kind: "literal", text: "A", token: "fade", size: 24 }],
    });
    await addShape(ctx, {
      kind: "rect",
      box: { left: 0, top: 40, width: 40, height: 40 },
      token: "fade",
    });

    expect(payload(await validateTheme(ctx, themeId)).ok).toBe(true);
  });

  it("keeps the metadata, palette, type, background and discard tools local", async () => {
    const host = await startHost(hostHandler());
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
