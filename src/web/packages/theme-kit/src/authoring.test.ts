import type { FabricPalette } from "@yunari/renderer-core";
import { describe, expect, it } from "vitest";
import {
  addChartObject,
  addIconObject,
  addImageObject,
  addLabelObject,
  addShapeObject,
  addTextObject,
} from "./authoring.js";

describe("the compose vocabulary", () => {
  it("builds a text box whose value run names its binding", () => {
    const { object, bindings } = addTextObject({
      id: "load",
      left: 10,
      top: 20,
      width: 200,
      height: 80,
      runs: [
        {
          kind: "value",
          bindingId: "cpu-load",
          token: "text",
          size: 90,
          precision: 0,
        },
      ],
      bindings: [{ id: "cpu-load", semanticKey: "cpu.load" }],
    });

    expect(object).toMatchObject({
      type: "Textbox",
      id: "load",
      left: 10,
      top: 20,
      originX: "left",
      originY: "top",
    });
    expect(bindings).toEqual([{ id: "cpu-load", semanticKey: "cpu.load" }]);
  });

  it("builds rect, ellipse and path shapes as plain JSON", () => {
    const rect = addShapeObject({
      id: "panel",
      kind: "rect",
      left: 0,
      top: 0,
      width: 360,
      height: 200,
      radius: 10,
    });
    const ellipse = addShapeObject({
      id: "ring",
      kind: "ellipse",
      left: 0,
      top: 0,
      width: 100,
      height: 60,
      token: "rule",
    });
    const line = addShapeObject({
      id: "rule",
      kind: "path",
      left: 0,
      top: 0,
      width: 100,
      height: 0,
      points: [
        ["M", 0, 0],
        ["L", 100, 0],
      ],
    });

    expect(rect).toMatchObject({ type: "Rect", rx: 10, ry: 10 });
    expect(ellipse).toMatchObject({ type: "Ellipse", rx: 50, ry: 30 });
    expect(line).toMatchObject({ type: "Path", fill: null, strokeWidth: 2 });
    expect(() =>
      addShapeObject({
        id: "bad",
        kind: "path",
        left: 0,
        top: 0,
        width: 1,
        height: 1,
      }),
    ).toThrow(/commands/);
  });

  it("resolves a gradient token to its gradient paint, not null", () => {
    const rect = addShapeObject({
      id: "bar",
      kind: "rect",
      left: 0,
      top: 0,
      width: 300,
      height: 12,
      token: "storageFill",
    });
    const icon = addIconObject({
      id: "spark",
      icon: "trends",
      left: 0,
      top: 0,
      size: 24,
      token: "sparkArea",
    });
    const line = addShapeObject({
      id: "spark-line",
      kind: "path",
      left: 0,
      top: 0,
      width: 300,
      height: 40,
      token: "storageFill",
      points: [
        ["M", 0, 0],
        ["L", 300, 40],
      ],
    });

    for (const [object, ref] of [
      [rect, "palette.storageFill"],
      [icon, "palette.sparkArea"],
    ] as const) {
      expect(object["fill"]).toMatchObject({ type: "linear" });
      expect(object["yunariPaint"]).toEqual({ fill: ref });
    }
    expect(line["stroke"]).toMatchObject({ type: "linear" });
  });

  it("names a declared asset on an image object", () => {
    expect(
      addImageObject({
        id: "photo",
        assetId: "sunset-1234",
        kind: "image",
        left: 5,
        top: 6,
        width: 300,
        height: 200,
      }),
    ).toMatchObject({
      type: "Image",
      yunariAsset: { assetId: "sunset-1234", kind: "image" },
      originX: "left",
      originY: "top",
    });
  });

  it("draws an icon as a filled path inside its box", () => {
    const icon = addIconObject({
      id: "cpu-icon",
      icon: "cpu",
      left: 12,
      top: 13,
      size: 44,
      token: "cpu",
    });
    expect(icon).toMatchObject({
      type: "Path",
      fill: "#4da3ff",
      stroke: null,
      yunariPaint: { fill: "palette.cpu" },
    });
    expect((icon["path"] as readonly unknown[]).length).toBeGreaterThan(2);
  });

  it("builds a chart and returns its bindings separately", () => {
    const bindings = [
      { id: "trend-cpu", semanticKey: "cpu.load" },
      { id: "trend-gpu", semanticKey: "gpu.load" },
    ];
    const { object, bindings: returned } = addChartObject({
      id: "trend",
      left: 0,
      top: 0,
      width: 400,
      height: 200,
      family: "line",
      bindings,
    });
    expect(object).toMatchObject({ type: "YunariChart", family: "line" });
    expect(returned).toBe(bindings);
  });

  it("paints a token the theme palette declares", () => {
    const palette: FabricPalette = {
      accent: { name: "Accent", value: { kind: "solid", color: "#ff0000" } },
    };

    const { object: text } = addTextObject({
      id: "load",
      left: 0,
      top: 0,
      width: 100,
      height: 24,
      runs: [{ kind: "literal", text: "A", token: "accent", size: 24 }],
      palette,
    });
    const shape = addShapeObject({
      id: "panel",
      kind: "rect",
      left: 0,
      top: 40,
      width: 40,
      height: 40,
      token: "accent",
      palette,
    });
    const icon = addIconObject({
      id: "cpu-icon",
      icon: "cpu",
      left: 60,
      top: 40,
      size: 24,
      token: "accent",
      palette,
    });

    for (const object of [text, shape, icon]) {
      expect(object["fill"]).toBe("#ff0000");
      expect(object["yunariPaint"]).toEqual({ fill: "palette.accent" });
    }
  });

  it("builds a one-run literal label", () => {
    expect(
      addLabelObject({
        id: "title",
        left: 0,
        top: 0,
        width: 100,
        height: 24,
        text: "CPU",
        size: 24,
      }),
    ).toMatchObject({ type: "Textbox", id: "title" });
  });
});
