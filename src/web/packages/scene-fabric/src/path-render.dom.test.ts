// @vitest-environment jsdom

import { StaticCanvas } from "fabric/es";
import { describe, expect, it } from "vitest";
import { reviveScene } from "./persist.js";

describe("an authored path", () => {
  it("revives as a stroked, visible object", async () => {
    const canvas = new StaticCanvas(undefined, { width: 400, height: 200 });
    await reviveScene(canvas, {
      version: "7.4.0",
      objects: [
        {
          type: "Path",
          id: "rule",
          name: "rule",
          left: 40,
          top: 50,
          path: [
            ["M", 0, 0],
            ["L", 100, 0],
          ],
          fill: null,
          stroke: "#7dbde0",
          strokeWidth: 2,
          strokeLineCap: "round",
          strokeLineJoin: "round",
          yunariPaint: { stroke: "palette.rule" },
          originX: "left",
          originY: "top",
        },
      ],
    });
    const [path] = canvas.getObjects();
    expect(path?.type).toBe("path");
    expect(path?.stroke).toBe("#7dbde0");
    canvas.renderAll();
    const pixels = canvas.getContext().getImageData(85, 50, 1, 1).data;
    expect(pixels[3]).toBeGreaterThan(0);
    await canvas.dispose();
  });
});
