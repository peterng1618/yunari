// @vitest-environment jsdom

import { reviveScene } from "@yunari/scene-fabric";
import { StaticCanvas } from "fabric/es";
import { describe, expect, it } from "vitest";
import { addIconObject } from "./authoring.js";

describe("a shared glyph", () => {
  it.each([
    "cpu",
    "gpu",
    "ram",
    "network",
    "trends",
    "storage",
    "thermometer",
    "fan",
    "gauge",
    "activity",
    "power",
    "clock",
    "zap",
    "arrow-up",
    "arrow-down",
  ] as const)("fills its box: %s", async (name) => {
    const icon = addIconObject({
      id: "icon",
      icon: name,
      left: 20,
      top: 20,
      size: 24,
      token: "text",
    });
    const canvas = new StaticCanvas(undefined, { width: 80, height: 80 });
    await reviveScene(canvas, {
      version: "7.4.0",
      objects: [icon as Record<string, unknown>],
    });
    canvas.renderAll();
    const data = canvas.getContext().getImageData(0, 0, 80, 80).data;
    let minX = 80;
    let minY = 80;
    let maxX = 0;
    let maxY = 0;
    let painted = 0;
    for (let y = 0; y < 80; y += 1) {
      for (let x = 0; x < 80; x += 1) {
        if (data[(y * 80 + x) * 4 + 3] === 0) continue;
        painted += 1;
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    }
    expect(painted, name).toBeGreaterThan(0);
    // Lucide draws inside the 24-unit square with a little inset; a stroked
    // glyph must still reach roughly the box rather than collapse to a mark.
    expect(maxX - minX, name).toBeGreaterThanOrEqual(8);
    expect(maxY - minY, name).toBeGreaterThanOrEqual(8);
    await canvas.dispose();
  });
});
