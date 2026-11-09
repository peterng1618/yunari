// @vitest-environment jsdom

import { Canvas, Point } from "fabric/es";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_PREVIEW_RATIO_TOKENS,
  setActivePreviewRatios,
} from "../display-lens.js";
import { createViewportManager, type ViewportManager } from "./index.js";

// jsdom cannot drawImage an undecoded img inside Fabric's render pass; a proxy
// over a real context forwards everything and no-ops only `drawImage`.
beforeEach(() => {
  const real = document.createElement("canvas").getContext("2d");
  if (real !== null) {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
      () =>
        new Proxy(real, {
          get(target, property) {
            if (property === "drawImage") return (): void => {};
            const value = Reflect.get(target, property, target);
            return typeof value === "function" ? value.bind(target) : value;
          },
          set(target, property, value) {
            if (property === "patternQuality") return true;
            return Reflect.set(target, property, value);
          },
        }) as unknown as CanvasRenderingContext2D,
    );
  }
  setActivePreviewRatios(DEFAULT_PREVIEW_RATIO_TOKENS);
});

const cameras: ViewportManager[] = [];

afterEach(() => {
  for (const camera of cameras.splice(0)) camera.destroy();
});

/** A camera on a host that can be resized, showing the whole stage. */
function setup() {
  const host = document.createElement("div");
  const size = { width: 1000, height: 800 };
  Object.defineProperties(host, {
    clientWidth: { get: () => size.width },
    clientHeight: { get: () => size.height },
  });
  const camera = createViewportManager({
    canvas: new Canvas(document.createElement("canvas")),
    host,
    artboard: () => ({ width: 1280, height: 720 }),
  });
  cameras.push(camera);
  camera.showDisplay(undefined);
  return {
    camera,
    /** The seam the ResizeObserver drives, driven directly instead. */
    resizeHost(width: number, height: number): void {
      size.width = width;
      size.height = height;
      camera.resize();
    },
  };
}

/**
 * Fit is a toggle as well as a state: the second press returns the zoom and
 * pan the last fit replaced, so an author who fitted the stage by mistake is
 * not left to find their view again by hand.
 */
describe("the fit toggle", () => {
  it("toggles fit back to the camera the fit replaced", () => {
    const { camera } = setup();
    camera.zoomToPoint(new Point(0, 0), 0.4);
    camera.panBy(40, 25);
    const chosenZoom = camera.zoom();
    const chosenRect = camera.artboardScreenRect();

    camera.toggleFit();
    expect(camera.isFitted(), "the first press fits").toBe(true);

    camera.toggleFit();
    expect(camera.zoom(), "the second press returns the zoom").toBeCloseTo(
      chosenZoom,
      6,
    );
    expect(
      camera.artboardScreenRect(),
      "and the pan it was looking at",
    ).toEqual(chosenRect);
    expect(camera.isFitted()).toBe(false);
  });

  it("has nothing to toggle back to when the camera opened fitted", () => {
    const { camera } = setup();
    expect(camera.isFitted()).toBe(true);
    camera.toggleFit();
    expect(camera.isFitted(), "a fit nobody replaced stays a fit").toBe(true);
  });

  it("does not remember the camera a window resize refitted", () => {
    const { camera, resizeHost } = setup();
    // A fitted view follows its window; that refit is nobody's choice, so the
    // toggle must not treat the pre-resize camera as somewhere to return to.
    resizeHost(1200, 900);
    expect(camera.isFitted()).toBe(true);
    camera.toggleFit();
    expect(camera.isFitted()).toBe(true);
  });
});
