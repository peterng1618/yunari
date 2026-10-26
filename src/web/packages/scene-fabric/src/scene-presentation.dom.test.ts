// @vitest-environment jsdom

import type { DisplayPresentation, ScenePlan } from "@yunari/renderer-core";
import { viewportToDocument } from "@yunari/renderer-core";
import { Rect } from "fabric/es";
import { describe, expect, it, vi } from "vitest";
import { host, plan, resizeHost } from "./scene-test-fixtures.js";
import { mountFabricScene } from "./scene.js";

describe("mountFabricScene's display presentation", () => {
  /** The scene as its host mounted it: the handle is the record, and `host` is
   *  where the disc and the canvas live. */
  function mountPresented(
    presentation?: DisplayPresentation,
    artboard: Partial<ScenePlan["artboard"]> = {},
  ) {
    const element = host();
    const scene = mountFabricScene({
      host: element,
      plan: plan(artboard),
      ...(presentation === undefined ? {} : { presentation }),
    });
    return { element, scene };
  }

  /** A scene whose media fills the display box rather than the board. */
  function mountDisplayMedia(presentation: DisplayPresentation) {
    const element = host();
    const scene = mountFabricScene({
      host: element,
      plan: plan(),
      artboard: { width: 400, height: 300 },
      background: { media: { assetId: "hero", bounds: "display" } },
      assets: [{ id: "hero", kind: "image", path: "assets/hero.png" }],
      resolveAsset: () => ({ url: "blob:hero" }),
      presentation,
    });
    return { element, scene };
  }

  it("applies a 90 degree rect presentation to the canvas", () => {
    const { element, scene } = mountPresented({
      shape: "rect",
      rotation: 90,
    });
    const vpt = scene.canvas.viewportTransform;
    expect(vpt[0]).toBeCloseTo(0, 9);
    expect(vpt[3]).toBeCloseTo(0, 9);
    expect(Math.abs(vpt[1])).toBeCloseTo(Math.abs(vpt[2]), 9);

    scene.dispose();
    element.remove();
  });

  it("clips a circle presentation to the disc", () => {
    // A paint that is not black, so the host assertion cannot pass on the
    // default: outside the disc the reader sees black, inside it the theme.
    const { element, scene } = mountPresented(
      { shape: "circle" },
      { background: "#101216" },
    );
    expect(element.style.background).toBe("rgb(0, 0, 0)");
    expect(scene.artboard.style.clipPath).toContain("circle(");
    const disc = element.querySelector<HTMLElement>(
      "[data-yunari-display-disc]",
    );
    expect(disc).not.toBeNull();
    // The 400x300 host: the disc is the shorter axis, centred.
    expect([
      disc?.style.left,
      disc?.style.top,
      disc?.style.width,
      disc?.style.height,
    ]).toEqual(["50px", "0px", "300px", "300px"]);
    expect(disc?.style.borderRadius).toBe("50%");
    expect(disc?.style.background, "the disc carries the theme").toBe(
      "rgb(16, 18, 22)",
    );

    scene.dispose();
    element.remove();
  });

  it("fills the disc with a display-bounded layer and restores the host", () => {
    const { element, scene } = mountDisplayMedia({ shape: "circle" });
    const layer = element.querySelector<HTMLElement>(
      "[data-yunari-background-media]",
    );
    const bounds = () => [
      layer?.style.left,
      layer?.style.top,
      layer?.style.width,
      layer?.style.height,
    ];
    // The media box is the disc box, not the artboard's.
    expect(bounds()).toEqual(["50px", "0px", "300px", "300px"]);
    expect(layer?.style.borderRadius).toBe("50%");

    scene.updatePresentation({ shape: "rect" });
    expect(scene.artboard.style.clipPath).toBe("");
    expect(
      element.querySelector<HTMLElement>("[data-yunari-display-disc]")?.style
        .display,
      "the disc leaves the composition",
    ).toBe("none");
    expect(bounds(), "and the display box is the host again").toEqual([
      "0px",
      "0px",
      "400px",
      "300px",
    ]);
    expect(layer?.style.borderRadius).toBe("");

    scene.dispose();
    element.remove();
  });

  it("moves the presentation in place", () => {
    const { element, scene } = mountPresented();
    scene.updatePresentation({ shape: "circle", rotation: 45 });
    expect(scene.transform().rotation).toBe(45);
    expect(element.querySelector("[data-yunari-display-disc]")).not.toBeNull();

    scene.dispose();
    element.remove();
  });

  it("stays upright and rectangular with no presentation", () => {
    // The record's absence is today's behaviour exactly: no disc, no clip, and
    // the transform reports the angle a reader assumes.
    const { element, scene } = mountPresented();
    expect(scene.transform().rotation).toBe(0);
    expect(scene.artboard.style.clipPath).toBe("");
    expect(element.querySelector("[data-yunari-display-disc]")).toBeNull();

    scene.dispose();
    element.remove();
  });

  it("keeps the previous presentation when an angle is refused", () => {
    const { element, scene } = mountPresented(undefined, {
      background: "#101216",
    });
    expect(() =>
      scene.updatePresentation({ shape: "rect", rotation: 45 }),
    ).toThrow(RangeError);
    expect(scene.transform().rotation).toBe(0);
    expect(element.style.background, "the paint is not repainted").toBe(
      "rgb(16, 18, 22)",
    );
    expect(element.querySelector("[data-yunari-display-disc]")).toBeNull();

    // A refused fit must not record the host size as fitted, or the next resize
    // early-returns on a size that was never fitted.
    const setDimensions = vi.spyOn(scene.canvas, "setDimensions");
    resizeHost(element, 800, 600);
    expect(() =>
      scene.updatePresentation({ shape: "rect", rotation: 45 }),
    ).toThrow(RangeError);
    scene.resize();
    expect(
      setDimensions,
      "the refused fit left no fitted size behind",
    ).toHaveBeenCalledTimes(1);

    // And a valid presentation still lands afterwards.
    scene.updatePresentation({ shape: "circle" });
    expect(element.querySelector("[data-yunari-display-disc]")).not.toBeNull();

    scene.dispose();
    element.remove();
  });

  it("samples a rotated scene's host paint under a panel, not a turned copy", () => {
    // The canvas is transparent behind a media-less theme, so a panel's
    // backdrop is the host's own background. A panel is placed over the host
    // point (100, 240) — the left half, below the centre — where the host
    // gradient is red. A sampler that turns the board's paint with the
    // composition reads the gradient's right half (blue) there.
    const element = host();
    const scene = mountFabricScene({
      host: element,
      plan: plan({
        background: {
          kind: "gradient",
          angle: 0,
          stops: [
            { offset: 0, color: "#ff0000" },
            { offset: 0.5, color: "#ff0000" },
            { offset: 0.5, color: "#0000ff" },
            { offset: 1, color: "#0000ff" },
          ],
        },
      }),
      presentation: { shape: "rect", rotation: 90 },
    });
    const at = viewportToDocument(scene.transform(), { x: 100, y: 240 });
    scene.canvas.add(
      new Rect({
        left: at.x - 20,
        top: at.y - 20,
        width: 40,
        height: 40,
        originX: "left",
        originY: "top",
        fill: "transparent",
        yunariGlass: { blurRadius: 0 },
      }),
    );
    scene.canvas.renderAll();

    const pixel = scene.canvas.getContext().getImageData(100, 240, 1, 1).data;
    expect(pixel[0], "the host's left half is red").toBeGreaterThan(200);
    expect(pixel[2]).toBeLessThan(60);

    scene.dispose();
    element.remove();
  });
});
