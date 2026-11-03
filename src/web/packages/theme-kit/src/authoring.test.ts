import {
  type FabricPalette,
  validateFabricThemeEnvelope,
} from "@yunari/renderer-core";
import { describe, expect, it } from "vitest";
import {
  addChartObject,
  addIconObject,
  addImageObject,
  addLabelObject,
  addShapeObject,
  addTextObject,
} from "./authoring.js";
import { createBlankTheme } from "./starter.js";

type AuthoredRun = Readonly<Record<string, unknown>>;

const authoredRuns = (object: Readonly<Record<string, unknown>>) =>
  (
    object["yunariText"] as
      | { readonly runs?: readonly AuthoredRun[] }
      | undefined
  )?.runs ?? [];

const letterSpacingOf = (run: AuthoredRun | undefined): unknown =>
  (
    run?.["style"] as
      | { readonly letterSpacing?: { readonly value?: unknown } }
      | undefined
  )?.letterSpacing?.value;

describe("the compose vocabulary", () => {
  it("names an object by its authored name, else by its id", () => {
    const text = addTextObject({
      id: "text",
      name: "CPU temperature",
      left: 0,
      top: 0,
      width: 100,
      height: 20,
      runs: [{ kind: "literal", text: "CPU", token: "text", size: 20 }],
    });
    expect(text.object["name"]).toBe("CPU temperature");

    const shape = addShapeObject({
      id: "shape",
      name: "Clock face",
      kind: "ellipse",
      left: 0,
      top: 0,
      width: 100,
      height: 100,
    });
    const unnamed = addShapeObject({
      id: "shape",
      kind: "rect",
      left: 0,
      top: 0,
      width: 10,
      height: 10,
    });
    expect(shape["name"]).toBe("Clock face");
    expect(unnamed["name"]).toBe("shape");

    expect(
      addImageObject({
        id: "image",
        name: "Album art",
        assetId: "cover",
        kind: "image",
        left: 0,
        top: 0,
        width: 10,
        height: 10,
      })["name"],
    ).toBe("Album art");
    expect(
      addIconObject({
        id: "icon",
        name: "CPU icon",
        icon: "cpu",
        left: 0,
        top: 0,
        size: 24,
      })["name"],
    ).toBe("CPU icon");
    expect(
      addChartObject({
        id: "chart",
        name: "CPU load history",
        left: 0,
        top: 0,
        width: 100,
        height: 100,
        family: "line",
        bindings: [{ id: "cpu-load", semanticKey: "cpu.load" }],
      }).object["name"],
    ).toBe("CPU load history");
  });

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

    for (const [object, ref] of [[rect, "palette.storageFill"]] as const) {
      expect(object["yunariPaint"]).toEqual({ fill: ref });
    }
    expect(icon["yunariPaint"]).toEqual({ stroke: "palette.sparkArea" });
    // The exact JSON Fabric's `Gradient.toObject()` persists. A live instance
    // would put Fabric in this Node-only package; the shape is what matters.
    expect(rect["fill"]).toEqual({
      type: "linear",
      coords: { x1: 0, y1: 6, x2: 300, y2: 6 },
      colorStops: [
        { offset: 0, color: "#3f7fe0" },
        { offset: 1, color: "#5ea2ff" },
      ],
      offsetX: 0,
      offsetY: 0,
      gradientUnits: "pixels",
    });
    expect(icon["stroke"]).toMatchObject({ type: "linear" });
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

  it("draws an icon as a stroked path inside its box", () => {
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
      fill: null,
      stroke: "#4da3ff",
      strokeWidth: (44 * 2) / 24,
      yunariPaint: { stroke: "palette.cpu" },
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

    for (const object of [text, shape]) {
      expect(object["fill"]).toBe("#ff0000");
      expect(object["yunariPaint"]).toEqual({ fill: "palette.accent" });
    }
    expect(icon["stroke"]).toBe("#ff0000");
    expect(icon["yunariPaint"]).toEqual({ stroke: "palette.accent" });
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

  it("adds no decorative tracking an author did not ask for", () => {
    const { object } = addTextObject({
      id: "caption",
      left: 0,
      top: 0,
      width: 200,
      height: 24,
      runs: [{ kind: "literal", text: "CPU LOAD", token: "text", size: 17 }],
    });

    expect(letterSpacingOf(authoredRuns(object)[0])).toBeUndefined();
    expect(object["charSpacing"]).toBeUndefined();
  });

  it("accepts a run's own tracking and type token", () => {
    const { object } = addTextObject({
      id: "overline",
      left: 0,
      top: 0,
      width: 200,
      height: 24,
      runs: [
        {
          kind: "literal",
          text: "SYSTEM",
          token: "text",
          size: 17,
          letterSpacing: 6,
          typeToken: "mono",
        },
      ],
    });

    expect(letterSpacingOf(authoredRuns(object)[0])).toBe(6);
    expect(authoredRuns(object)[0]?.["typeToken"]).toBe("typeTokens.mono");
    expect(object["fontFamily"]).toBe("Consolas, monospace");
  });

  it("paints new charts with palette references the validator accepts", () => {
    const palette: FabricPalette = {
      ink: { name: "Ink", value: { kind: "solid", color: "#ff0000" } },
      track: { name: "Track", value: { kind: "solid", color: "#101010" } },
    };
    const settingsOf = (family: "line" | "bar" | "gauge") =>
      addChartObject({
        id: family,
        left: 0,
        top: 0,
        width: 400,
        height: 200,
        family,
        bindings: [{ id: `${family}-load`, semanticKey: "cpu.load" }],
        palette,
      }).object["settings"] as Record<string, unknown>;

    const line = settingsOf("line");
    expect(line["stroke"]).toEqual({ ref: "palette.ink" });
    expect(line["palette"]).toEqual([{ ref: "palette.ink" }]);
    expect(line["area"]).toBeUndefined();

    expect(settingsOf("bar")).toMatchObject({
      fill: { ref: "palette.ink" },
      track: { ref: "palette.track" },
    });
    expect(settingsOf("gauge")).toMatchObject({
      progress: { ref: "palette.ink" },
      track: { ref: "palette.track" },
    });
  });

  it("places a chart from its top-left like every other compose tool", () => {
    const { object } = addChartObject({
      id: "trend",
      left: 40,
      top: 50,
      width: 400,
      height: 200,
      family: "line",
      bindings: [{ id: "cpu", semanticKey: "cpu.load" }],
    });
    expect(object).toMatchObject({
      left: 40,
      top: 50,
      originX: "left",
      originY: "top",
    });
  });

  it("omits an author the caller did not supply", () => {
    const theme = createBlankTheme({ artboard: { width: 800, height: 480 } });
    expect(theme.metadata).not.toHaveProperty("author");
    expect(theme.metadata?.name).toBe("New theme");
  });

  it("keeps a blank chart theme valid end to end", () => {
    const theme = createBlankTheme({ artboard: { width: 800, height: 480 } });
    const { object } = addChartObject({
      id: "trend",
      left: 10,
      top: 10,
      width: 400,
      height: 200,
      family: "line",
      bindings: [{ id: "cpu", semanticKey: "cpu.load" }],
      ...(theme.globals?.palette === undefined
        ? {}
        : { palette: theme.globals.palette }),
    });
    const withChart = {
      ...theme,
      scene: { ...theme.scene, objects: [object] },
      bindings: { trend: [{ id: "cpu", semanticKey: "cpu.load" }] },
    };
    expect(validateFabricThemeEnvelope(withChart).ok).toBe(true);
  });
});
