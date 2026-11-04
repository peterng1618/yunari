import { addAsset } from "@yunari/theme-kit";
import { afterEach, describe, expect, it } from "vitest";
import {
  closeHosts,
  context,
  hostHandler,
  payload,
  sceneObjects,
  startHost,
} from "./testing/tool-fixtures.js";
import {
  addChart,
  addIcon,
  addImage,
  addShape,
  addText,
  groupObjects,
} from "./tools/compose.js";
import { createTheme, setPalette } from "./tools/draft.js";

afterEach(closeHosts);

describe("layer naming and grouping", () => {
  it("writes the layer name an author supplies and names a component group", async () => {
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

    const box = { left: 0, top: 0, width: 100, height: 100 };
    const text = payload(
      await addText(ctx, {
        box,
        runs: [{ kind: "literal", text: "12", size: 20 }],
        name: "Clock numerals",
      }),
    );
    const face = payload(
      await addShape(ctx, { kind: "ellipse", box, name: "Clock face" }),
    );
    const plain = payload(await addShape(ctx, { kind: "rect", box }));
    const image = payload(
      await addImage(ctx, { assetId: "photo", box, name: "Album art" }),
    );
    const icon = payload(
      await addIcon(ctx, { icon: "cpu", box, name: "CPU icon" }),
    );
    const chart = payload(
      await addChart(ctx, {
        family: "line",
        box,
        binding: { id: "cpu-load", semanticKey: "cpu.load" },
        settings: {
          stroke: { ref: "palette.cpu" },
          area: { ref: "palette.sparkArea" },
        },
        name: "CPU history",
      }),
    );
    const names = new Map(
      sceneObjects(ctx).map((object) => [object["id"], object["name"]]),
    );
    const first = (entry: Record<string, unknown>) =>
      (entry.ids as string[])[0] as string;
    expect(names.get(first(text))).toBe("Clock numerals");
    expect(names.get(first(face))).toBe("Clock face");
    expect(names.get(first(plain))).toBe("shape");
    expect(names.get(first(image))).toBe("Album art");
    expect(names.get(first(icon))).toBe("CPU icon");
    expect(names.get(first(chart))).toBe("CPU history");

    const grouped = payload(
      await groupObjects(ctx, [first(text), first(face)], undefined, "Clock"),
    );
    const group = sceneObjects(ctx).find(
      (object) => object["id"] === grouped.groupId,
    );
    expect(group?.["name"]).toBe("Clock");
  });
});
