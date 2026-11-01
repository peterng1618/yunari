// @vitest-environment jsdom

import type { BackdropMedia } from "@yunari/scene-fabric";
import { type Canvas, Rect, StaticCanvas } from "fabric/es";
import { describe, expect, it } from "vitest";
import { captureCanvas } from "./thumbnail-capture.js";

/** The plane the capture hands the backdrop sampler, in export pixels. */
function deviceFor(
  viewport: number[],
  artboard: { width: number; height: number },
  maxEdge?: number,
): { region: unknown; device: unknown } {
  let seen: { region: unknown; device: unknown } | undefined;
  const backdrop: BackdropMedia = {
    rect: { left: 0, top: 0, ...artboard },
    paint(_ctx, region, device) {
      seen = { region, device };
      return true;
    },
  };
  // jsdom has no Fabric canvas, and the compositing question is the plane the
  // media is drawn at, not Fabric's re-render. The export canvas is sized the
  // way `toCanvasElement` sizes it: the logical canvas times the multiplier.
  const canvas = {
    width: 1000,
    height: 500,
    viewportTransform: viewport,
    toCanvasElement: (multiplier: number) => {
      const shot = document.createElement("canvas");
      shot.width = 1000 * multiplier;
      shot.height = 500 * multiplier;
      return shot;
    },
  } as unknown as Canvas;
  captureCanvas(canvas, backdrop, maxEdge);
  if (seen === undefined) throw new Error("the backdrop was never painted");
  return seen;
}

describe("the capture's artboard plane", () => {
  it("places the media where the camera put the artboard", () => {
    // Zoom 0.4, offset 60/30, exported 1:1: the media covers a
    // quarter-scale artboard where the camera put it.
    const { region, device } = deviceFor(
      [0.4, 0, 0, 0.4, 60, 30],
      {
        width: 1000,
        height: 500,
      },
      1000,
    );
    expect(region).toEqual({ left: 0, top: 0, width: 1000, height: 500 });
    expect(device).toEqual({ left: 60, top: 30, width: 400, height: 200 });
  });

  it("scales the plane by the export multiplier, not just the zoom", () => {
    const { device } = deviceFor(
      [0.4, 0, 0, 0.4, 60, 30],
      {
        width: 1000,
        height: 500,
      },
      250,
    );
    expect(device).toEqual({ left: 15, top: 7.5, width: 100, height: 50 });
  });

  it("paints no media when the camera is degenerate", () => {
    expect(() =>
      deviceFor([0, 0, 0, 0, 0, 0], { width: 1000, height: 500 }),
    ).toThrow("the backdrop was never painted");
  });
});

describe("the capture's view state", () => {
  /** A canvas that records the order of the calls the capture makes around it. */
  function recording(canvas: { readonly shoot: () => void }): {
    canvas: Canvas;
    order: string[];
  } {
    const order: string[] = [];
    return {
      order,
      canvas: {
        width: 100,
        height: 100,
        viewportTransform: [1, 0, 0, 1, 0, 0],
        toCanvasElement: () => {
          order.push("shot");
          canvas.shoot();
          return document.createElement("canvas");
        },
      } as unknown as Canvas,
    };
  }

  const suspend = (order: string[]) => (): (() => void) => {
    order.push("lift");
    return () => order.push("restore");
  };

  it("takes the shot with the view state lifted and puts it back", () => {
    // The capture reads the document, not the screen (`vg-527`): the
    // entered-group dim is lifted for the shot itself and never longer.
    const { canvas, order } = recording({ shoot: () => undefined });
    captureCanvas(canvas, undefined, 640, suspend(order));
    expect(order).toEqual(["lift", "shot", "restore"]);
  });

  it("puts the view state back when the shot throws", () => {
    // A lift that outlives a failure would leave the canvas undimmed for the
    // rest of the session with nothing left to put it back.
    const { canvas, order } = recording({
      shoot: () => {
        throw new Error("tainted canvases may not be exported");
      },
    });
    expect(() => captureCanvas(canvas, undefined, 640, suspend(order))).toThrow(
      "tainted canvases",
    );
    expect(order).toEqual(["lift", "shot", "restore"]);
  });
});

describe("the capture's artboard shape", () => {
  const SIZE = 100;
  const RED = [255, 0, 0, 255];
  const BLUE = [0, 0, 255, 255];

  /** A blue backdrop over the whole exported picture. */
  function blueBackdrop(): BackdropMedia {
    return {
      rect: { left: 0, top: 0, width: SIZE, height: SIZE },
      paint(context, region) {
        context.fillStyle = "#0000ff";
        context.fillRect(region.left, region.top, region.width, region.height);
        return true;
      },
    };
  }

  /** A board covered in red, behind whatever clip the live canvas carries. */
  function mounted(clipPath?: Rect): Canvas {
    const stage = new StaticCanvas(document.createElement("canvas"), {
      width: SIZE,
      height: SIZE,
    });
    if (clipPath !== undefined) stage.clipPath = clipPath;
    stage.add(
      new Rect({
        left: 0,
        top: 0,
        width: SIZE,
        height: SIZE,
        originX: "left",
        originY: "top",
        fill: "#ff0000",
      }),
    );
    stage.renderAll();
    return stage as unknown as Canvas;
  }

  function pixelAt(canvas: HTMLCanvasElement, x: number, y: number): number[] {
    const context = canvas.getContext("2d");
    if (context === null)
      throw new Error("the captured canvas has no 2D context");
    return [...context.getImageData(x, y, 1, 1).data];
  }

  it("keeps a circle theme's picture inside its disc", () => {
    // A circle theme ships as the disc inscribed in its artboard, so a card
    // showing the square would advertise a picture the panel never shows.
    const canvas = mounted();
    const picture = captureCanvas(
      canvas,
      blueBackdrop(),
      640,
      undefined,
      "circle",
    );
    if (picture === undefined)
      throw new Error("the capture produced no picture");

    expect(pixelAt(picture, SIZE / 2, SIZE / 2)).toEqual(RED);
    const corners: ReadonlyArray<readonly [number, number]> = [
      [0, 0],
      [SIZE - 1, 0],
      [0, SIZE - 1],
      [SIZE - 1, SIZE - 1],
    ];
    for (const [x, y] of corners) {
      expect(pixelAt(picture, x, y)).toEqual(BLUE);
    }
  });

  it("puts the live clip back when the shot is done", () => {
    // The author's canvas must not be left wearing the thumbnail's disc.
    const sentinel = new Rect({
      width: SIZE,
      height: SIZE,
      left: 0,
      top: 0,
      fill: "#ffffff",
      absolutePositioned: true,
    });
    const canvas = mounted(sentinel);
    captureCanvas(canvas, blueBackdrop(), 640, undefined, "circle");
    expect(canvas.clipPath).toBe(sentinel);
  });
});
