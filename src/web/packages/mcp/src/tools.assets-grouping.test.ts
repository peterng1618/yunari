import { afterEach, describe, expect, it } from "vitest";
import {
  closeHosts,
  context,
  hostHandler,
  payload,
  sceneObjects,
  startHost,
} from "./testing/tool-fixtures.js";
import { importAsset, previewAsset, searchAssets } from "./tools/assets.js";
import {
  addCard,
  addChart,
  addShape,
  groupObjects,
  listObjects,
  ungroupObjects,
  updateObject,
} from "./tools/compose.js";
import { createTheme } from "./tools/draft.js";
import { saveTheme, validateTheme } from "./tools/verify.js";

afterEach(closeHosts);

describe("asset tools", () => {
  it("searches, previews and imports a finder result with its credit", async () => {
    const svg = Buffer.from("<svg/>");
    const host = await startHost((request) => {
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
    const host = await startHost((request) => {
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
    const host = await startHost(hostHandler());
    const ctx = context(host);
    await createTheme(ctx, { name: "Mine", width: 800, height: 480 });

    const result = await importAsset(ctx, { path: "C:/tmp/dot.png" });

    expect(result.isError).toBe(true);
    expect((result.content[0] as { text: string }).text).toMatch(/licence/u);
  });
});

describe("grouping", () => {
  it("groups root objects and lifts their children back out", async () => {
    const host = await startHost(hostHandler());
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
    const host = await startHost(hostHandler());
    const ctx = context(host);
    await createTheme(ctx, { name: "Mine", width: 1672, height: 941 });
    const card = payload(
      await addCard(ctx, { unit: "group-cpu-card", left: 0, top: 0 }),
    );

    await groupObjects(ctx, [(card.ids as string[])[0] as string]);

    const validated = payload(await validateTheme(ctx));
    expect(validated.ok).toBe(true);
  });

  it("groups objects from their top-left boxes", async () => {
    const host = await startHost(hostHandler());
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
      left: 400,
      top: 240,
      width: 200,
      height: 160,
    });
  });

  it("scales a group box by its objects' scale", async () => {
    const host = await startHost(hostHandler());
    const ctx = context(host);
    await createTheme(ctx, { name: "Mine", width: 800, height: 480 });
    const shape = payload(
      await addShape(ctx, {
        kind: "rect",
        box: { left: 10, top: 10, width: 100, height: 100 },
      }),
    );
    const id = (shape.ids as string[])[0] as string;
    await updateObject(ctx, id, { scaleX: 2, scaleY: 3 });

    const grouped = payload(await groupObjects(ctx, [id]));
    const group = sceneObjects(ctx).find(
      (object) => object["id"] === grouped.groupId,
    );
    expect(group).toMatchObject({ left: 10, top: 10, width: 200, height: 300 });
  });

  it("adds a library card and reports the ids it created", async () => {
    const host = await startHost(hostHandler());
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
