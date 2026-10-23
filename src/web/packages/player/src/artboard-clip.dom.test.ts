// @vitest-environment jsdom

import type { FabricThemeEnvelope } from "@yunari/renderer-core";
import { mountFabricScene, reviveThemeEnvelope } from "@yunari/scene-fabric";
import { describe, expect, it } from "vitest";

/**
 * The artboard is a clip, and revival used to take it away.
 *
 * `mountFabricScene` installs a `clipPath` sized to the artboard and paints
 * the artboard's own background. `reviveThemeEnvelope` then calls Fabric's
 * `canvas.loadFromJSON`, which sets `backgroundColor` and `clipPath` from the
 * revived document — and a Yunari scene document carries neither, because
 * both are artboard state rather than scene state. Fabric assigns `undefined`
 * to each, so the clip and the paint are both gone by the time the display
 * has its objects.
 *
 * Measured on a real hosted display at 412×839: with a 1920×1080 artboard
 * letterboxed into 839px, an object authored 60 units above the artboard's top
 * edge painted at y=291 — 12 pixels *above* the artboard, out over the
 * letterbox bar, where it is fully visible on a wall and on a phone. The crop
 * notice is built on the opposite premise ("Fabric clips the canvas to the
 * artboard rect, so an object outside it is drawn nowhere"), so on the hosted
 * path it was reporting objects as "not shown" while the renderer was showing
 * them.
 */

const ARTBOARD = { width: 1920, height: 1080 } as const;

function host(): HTMLElement {
  const element = document.createElement("div");
  Object.defineProperty(element, "clientWidth", { value: 412 });
  Object.defineProperty(element, "clientHeight", { value: 839 });
  document.body.append(element);
  return element;
}

function envelope(): FabricThemeEnvelope {
  return {
    schemaVersion: 2,
    fabricVersion: "7.4.0",
    id: "clip-probe",
    artboard: { ...ARTBOARD },
    // The background is its own envelope section now, so revival is exercised
    // with one present: `loadFromJSON` must not carry it onto the canvas.
    background: { color: { value: "#112233" } },
    globals: { palette: {} },
    bindings: {},
    assets: [],
    scene: {
      version: "7.4.0",
      objects: [
        {
          type: "Rect",
          version: "7.4.0",
          id: "overhang",
          originX: "left",
          originY: "top",
          left: 200,
          top: -60,
          width: 400,
          height: 40,
          fill: "#ffffff",
        },
      ],
    },
  } as unknown as FabricThemeEnvelope;
}

function mount() {
  const element = host();
  const scene = mountFabricScene({
    host: element,
    plan: {
      artboard: {
        width: ARTBOARD.width,
        height: ARTBOARD.height,
        contentFit: "contain",
        background: "#112233",
      },
      nodes: [],
      issues: [],
    },
    artboard: { ...ARTBOARD },
  });
  return { element, scene };
}

describe("reviving a hosted scene keeps the artboard", () => {
  it("mounts with the artboard clip installed and the paint off the canvas", () => {
    const { element, scene } = mount();

    // The premise the crop notice is built on. If this is not true, the notice
    // is describing a clip that is not there.
    expect(scene.canvas.clipPath).toBeTruthy();
    // 0080: the board's paint is the host's, which puts it behind the media
    // layer; a fill on the canvas sits above that layer and hides it. A glass
    // panel samples the backdrop instead, which composes the same paint.
    expect(String(scene.canvas.backgroundColor)).toBe("");
    expect(element.style.background).toBe("rgb(17, 34, 51)");

    scene.dispose();
  });

  it("still clips to the artboard after the scene is revived", async () => {
    const { element, scene } = mount();

    await reviveThemeEnvelope(scene.canvas, envelope());

    // Fabric's `loadFromJSON` assigns `undefined` to every canvas-level
    // property the document does not carry, and a scene document carries
    // neither the clip nor the paint.
    expect(
      scene.canvas.clipPath,
      "revival dropped the artboard clip, so objects outside it paint over the letterbox bars",
    ).toBeTruthy();
    expect(
      String(scene.canvas.backgroundColor),
      "a revived document's own fill covers the media layer",
    ).toBe("");
    expect(
      element.style.background,
      "the background bag is the plan's to paint, not the revived scene's",
    ).toBe("rgb(17, 34, 51)");

    scene.dispose();
  });
});
