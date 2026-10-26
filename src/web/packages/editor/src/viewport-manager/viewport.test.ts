// @vitest-environment jsdom

import { Canvas, Point } from "fabric/es";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_PREVIEW_RATIO_TOKENS,
  setActivePreviewRatios,
} from "../display-lens.js";
import { createViewportManager, MAX_ZOOM, MIN_ZOOM } from "./index.js";

// jsdom cannot drawImage an undecoded img inside Fabric's render pass; a proxy
// over a real context forwards everything, no-ops only drawImage, and swallows
// Fabric's node-canvas-only `patternQuality` writes.
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
});

/** The catalogue is module state shared by every camera in this file, so each
 *  test starts from the shipped list rather than from whatever the last one
 *  left behind. */
const resetPreviewRatios = (): void => {
  setActivePreviewRatios(DEFAULT_PREVIEW_RATIO_TOKENS);
};

beforeEach(resetPreviewRatios);

/** A camera on a host and an artboard of the test's own choosing, for the
 *  scene-anchored screen, whose numbers are not `setup`'s 1000x800 / 1280x720. */
function createCamera(options: {
  readonly width: number;
  readonly height: number;
  readonly artboard: { readonly width: number; readonly height: number };
}) {
  const host = document.createElement("div");
  Object.defineProperties(host, {
    clientWidth: { get: () => options.width },
    clientHeight: { get: () => options.height },
  });
  return createViewportManager({
    canvas: new Canvas(document.createElement("canvas")),
    host,
    artboard: () => options.artboard,
  });
}

function setup(options: { lens?: string; fitted?: boolean } = {}) {
  const host = document.createElement("div");
  // Read through a live holder rather than a fixed `value`, so a test can
  // resize the host the way a window does.
  const size = { width: 1000, height: 800 };
  Object.defineProperties(host, {
    clientWidth: { get: () => size.width },
    clientHeight: { get: () => size.height },
  });
  const canvas = new Canvas(document.createElement("canvas"));
  const camera = createViewportManager({
    canvas,
    host,
    artboard: () => ({ width: 1280, height: 720 }),
  });
  // The camera opens on a display, so a test that means "the whole stage" has
  // to say Fit rather than inherit whatever the product ships. Left implicit,
  // the numbers below would be describing the lens and a reader could not tell
  // which of the two they were reading.
  //
  // `fitted: false` leaves the camera at construction instead, for the two
  // tests whose subject *is* that state — one anchors on the identity
  // transform and one asserts that construction performs no fit.
  if (options.fitted !== false) {
    camera.showDisplay(options.lens);
  }
  return {
    canvas,
    camera,
    host,
    /** The seam the ResizeObserver drives, driven directly instead. */
    resizeHost(width: number, height: number): void {
      size.width = width;
      size.height = height;
      camera.resize();
    },
  };
}

describe("viewport camera", () => {
  it("clamps zoom to its limits", () => {
    const { camera } = setup();
    camera.zoomToPoint(new Point(0, 0), 9999);
    expect(camera.zoom()).toBe(MAX_ZOOM);
    camera.zoomToPoint(new Point(0, 0), 0.000001);
    expect(camera.zoom()).toBe(MIN_ZOOM);
  });

  it("fits the whole artboard into the host", () => {
    const { camera } = setup();
    camera.zoomToFit();
    // contain-fit of 1280x720 into 1000x800 is limited by width.
    expect(camera.zoom()).toBeCloseTo(1000 / 1280, 5);
  });

  it("refuses to fit a board with no frameable area, as the renderer-core transform does", () => {
    // The editor's fit is deliberately its own rule — it frames the display's
    // screen rather than the host — but it must carry the refusals
    // `computeArtboardTransform` already has, or only one of the two copies is
    // guarded (vg-241, RULED 2026-10-12).
    //
    // A zero-width board is the shape that slips past the derived-scale guard:
    // `box.width / 0` is `Infinity`, and `Math.min(Infinity, 800 / 720)` is a
    // perfectly finite scale, so the camera would fit to a board that cannot be
    // framed. The renderer-core transform refuses the same board with a
    // `RangeError`.
    const host = document.createElement("div");
    Object.defineProperties(host, {
      clientWidth: { get: () => 1000 },
      clientHeight: { get: () => 800 },
    });
    const canvas = new Canvas(document.createElement("canvas"));
    let board = { width: 1280, height: 720 };
    const camera = createViewportManager({
      canvas,
      host,
      artboard: () => board,
    });
    camera.zoomToPoint(new Point(0, 0), 0.5);

    board = { width: 0, height: 720 };
    camera.zoomToFit();

    // The camera keeps the zoom it had rather than fitting to the board, which
    // is the same answer a collapsed box already gets.
    expect(camera.zoom()).toBeCloseTo(0.5, 6);
  });

  it("refuses to fit a board with a non-finite dimension", () => {
    const host = document.createElement("div");
    Object.defineProperties(host, {
      clientWidth: { get: () => 1000 },
      clientHeight: { get: () => 800 },
    });
    const canvas = new Canvas(document.createElement("canvas"));
    let board = { width: 1280, height: 720 };
    const camera = createViewportManager({
      canvas,
      host,
      artboard: () => board,
    });
    camera.zoomToPoint(new Point(0, 0), 0.5);

    board = { width: Number.NaN, height: 720 };
    camera.zoomToFit();

    expect(camera.zoom()).toBeCloseTo(0.5, 6);
  });

  it("keeps the point under the cursor fixed while zooming", () => {
    // Unfitted, because the anchor below reads the identity transform.
    const { canvas, camera } = setup({ fitted: false });
    // A real MouseEvent, not {x, y}: getScenePoint resolves through getPointer,
    // which reads event.clientX/clientY. A bare object yields NaN on both sides
    // and toBeCloseTo can never pass on NaN.
    const at = (x: number, y: number) =>
      canvas.getScenePoint(
        new MouseEvent("pointermove", { clientX: x, clientY: y }),
      );

    // Anchor: at the identity transform the scene point IS the event's own
    // coordinates. jsdom reports a zero-size, unlaid-out element, so without
    // this the invariant below could hold by comparing 0 to 0.
    const identity = at(400, 300);
    expect(identity.x).toBe(400);
    expect(identity.y).toBe(300);

    camera.zoomToFit();
    const before = at(400, 300);
    expect(before.x).not.toBe(400);

    camera.zoomToPoint(new Point(400, 300), camera.zoom() * 2);
    const after = at(400, 300);
    expect(after.x).toBeCloseTo(before.x, 3);
    expect(after.y).toBeCloseTo(before.y, 3);
  });

  it("restores the view after panning far away", () => {
    const { camera } = setup();
    camera.zoomToFit();
    camera.panBy(-100000, -100000);
    camera.zoomToFit();
    expect(camera.zoom()).toBeCloseTo(1000 / 1280, 5);
  });

  it("notifies subscribers until they unsubscribe", () => {
    const { camera } = setup();
    const listener = vi.fn();
    const unsubscribe = camera.onChange(listener);

    camera.panBy(10, 10);
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
    camera.panBy(10, 10);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("reports the artboard rect in canvas coordinates, not client ones", () => {
    const { camera } = setup();
    camera.zoomToFit();
    // contain-fit of 1280x720 into 1000x800 is 0.78125, so the board draws
    // 1000x562.5 centred: a 118.75px band above and below.
    const scale = 1000 / 1280;
    expect(camera.artboardScreenRect()).toEqual({
      left: 0,
      top: (800 - 720 * scale) / 2,
      width: 1000,
      height: 720 * scale,
    });
  });

  it("moves the artboard rect with the pan", () => {
    const { camera } = setup();
    camera.zoomToFit();
    const before = camera.artboardScreenRect();
    camera.panBy(40, -25);
    expect(camera.artboardScreenRect()).toEqual({
      ...before,
      left: before.left + 40,
      top: before.top - 25,
    });
  });
});

describe("viewport camera on a host resize", () => {
  it("re-fits a camera that was showing the whole artboard", () => {
    const { camera, resizeHost } = setup();
    camera.zoomToFit();
    // Contain-fit of 1280x720 into 1000x800 is 0.78125.
    expect(camera.zoom()).toBeCloseTo(1000 / 1280, 5);

    resizeHost(400, 800);

    // The board was whole in the old box, so it is whole in the new one. A
    // camera that only held its zoom would leave 1290 of the board's pixels
    // past the right edge and the badge reading a number for the wrong view.
    const scale = 400 / 1280;
    expect(camera.zoom()).toBeCloseTo(scale, 5);
    expect(camera.artboardScreenRect()).toEqual({
      left: (400 - 1280 * scale) / 2,
      top: (800 - 720 * scale) / 2,
      width: 400,
      height: 720 * scale,
    });
  });

  it("re-fits on every step of a shrinking host", () => {
    const { camera, resizeHost } = setup();
    camera.zoomToFit();
    for (const width of [900, 700, 500, 300]) {
      resizeHost(width, 800);
      expect(camera.zoom()).toBeCloseTo(width / 1280, 5);
    }
  });

  it("keeps the zoom an author chose", () => {
    const { camera, resizeHost } = setup();
    camera.zoomToFit();
    camera.zoomToPoint(new Point(500, 400), camera.zoom() * 2);
    const zoomed = camera.zoom();
    expect(zoomed).toBeCloseTo((1000 / 1280) * 2, 5);

    resizeHost(400, 800);

    // The revert this replaces re-centred on every resize, which is what broke
    // `keeps the point under the cursor fixed while zooming`: a zoom the author
    // asked for is not the camera's to undo.
    expect(camera.zoom()).toBeCloseTo(zoomed, 5);
  });

  it("keeps the pan an author made", () => {
    const { camera, resizeHost } = setup();
    camera.zoomToFit();
    camera.panBy(-200, -50);
    const panned = camera.artboardScreenRect();

    resizeHost(500, 800);

    expect(camera.artboardScreenRect()).toEqual(panned);
  });

  it("keeps the point under the cursor across a resize", () => {
    const { canvas, camera, resizeHost } = setup();
    const at = (x: number, y: number) =>
      canvas.getScenePoint(
        new MouseEvent("pointermove", { clientX: x, clientY: y }),
      );

    camera.zoomToFit();
    camera.zoomToPoint(new Point(400, 300), camera.zoom() * 2);
    const before = at(400, 300);

    resizeHost(500, 700);

    // Read through the same accessor as the zooming test, so this pins the
    // camera not having moved rather than a transform tuple restated here.
    const after = at(400, 300);
    expect(after.x).toBeCloseTo(before.x, 3);
    expect(after.y).toBeCloseTo(before.y, 3);
  });

  it("fits again after the author takes the camera off fit", () => {
    const { camera, resizeHost } = setup();
    camera.zoomToFit();
    camera.panBy(-200, 0);
    resizeHost(400, 800);
    // Held: a pan is the author's, and the row is not about taking it back.
    expect(camera.zoom()).toBeCloseTo(1000 / 1280, 5);

    camera.zoomToFit();
    resizeHost(400, 800);

    expect(camera.zoom()).toBeCloseTo(400 / 1280, 5);
  });

  it("still sizes the canvas to the host", () => {
    const { canvas, resizeHost } = setup();
    resizeHost(640, 480);
    expect(canvas.getWidth()).toBe(640);
    expect(canvas.getHeight()).toBe(480);
  });

  it("refits nothing on the resize at construction", () => {
    // There is no camera yet: the canvas still carries Fabric's own 300x150
    // default and the identity transform, which is not a fit for this board. A
    // predicate that read the host — already at its real size by the time the
    // manager is built — would compare identity against that host and could
    // claim a fit nobody chose. `zoomToFit` is what establishes the first view.
    const { camera } = setup({ fitted: false });
    expect(camera.zoom()).toBe(1);
    expect(camera.artboardScreenRect()).toEqual({
      left: 0,
      top: 0,
      width: 1280,
      height: 720,
    });
  });
});

/**
 * The display is a **lens**: it changes what the camera looks at and at what
 * shape, and nothing else. Each test below is one of those "nothing else"
 * claims, because the failure this guards against is not a wrong number on
 * screen — it is a lens that quietly becomes a document.
 */
describe("the display lens", () => {
  it("opens on 16:9, because the starter is drawn in that shape", () => {
    // **One owner for "the default shape", not two constants that disagree.**
    // The default used to be a 19.5:9 lens held beside a 16:9 document default,
    // justified by a comment claiming the starter is drawn in a landscape
    // phone. It is 1672 × 941 — 1.7768, which is 16:9 — so the claim was false
    // and the stage spent ~287 px of a 1600 px one on bars. The lens is now read
    // out of the artboard default; this pins what that resolves to and the
    // arithmetic that makes the old comment false.
    const { camera } = setup({ fitted: false });

    // Not 19.5:9: the two differ by 0.39, so this is the whole claim.
    expect(
      Math.abs(1672 / 941 - 16 / 9),
      "the starter is 16:9, not 19.5:9",
    ).toBeLessThan(0.001);
    expect(
      Math.abs(1672 / 941 - 19.5 / 9),
      "and nowhere near the shape the old default claimed",
    ).toBeGreaterThan(0.3);
    expect(camera.display()).toBe("16:9");
    const screen = camera.displayScreenRect();
    if (screen === undefined) throw new Error("no display screen rect");
    expect(
      screen.width / screen.height,
      "so the frame it opens in carries the starter's own aspect",
    ).toBeCloseTo(16 / 9, 6);
  });

  it("frames the artboard to the display's shape, not the window's", () => {
    const { camera } = setup({ lens: "19.5:9" });
    const screen = camera.displayScreenRect();
    if (screen === undefined) throw new Error("no display screen rect");
    // The screen carries the display's aspect...
    expect(screen.width / screen.height).toBeCloseTo(19.5 / 9, 6);
    // ...and the artboard sits inside it at its own aspect, letterboxed rather
    // than cropped. This board (16:9) is narrower than a 19.5:9 screen, so it
    // fills the screen's height and leaves bars at the sides. Cropping to fill
    // them would be the lens deciding what the display shows, which is the one
    // thing a preview must not do.
    const board = camera.artboardScreenRect();
    expect(board.width / board.height).toBeCloseTo(16 / 9, 6);
    expect(board.left).toBeGreaterThan(screen.left + 1);
    expect(board.left + board.width).toBeLessThan(
      screen.left + screen.width - 1,
    );
    // And it is centred in the screen, which is itself centred in the stage.
    expect(board.left + board.width / 2).toBeCloseTo(
      screen.left + screen.width / 2,
      6,
    );
    expect(board.top + board.height / 2).toBeCloseTo(
      screen.top + screen.height / 2,
      6,
    );
  });

  it("rotates the screen for a portrait display and keeps the artboard upright", () => {
    const landscape = setup({ lens: "19.5:9" }).camera;
    const portrait = setup({ lens: "9:19.5" }).camera;
    const wide = landscape.displayScreenRect();
    const tall = portrait.displayScreenRect();
    if (wide === undefined || tall === undefined) {
      throw new Error("no display screen rect");
    }
    // The same screen turned: the exact reciprocal of the landscape aspect,
    // because a display's two orientations cannot drift apart.
    expect(tall.width / tall.height).toBeCloseTo(1 / (19.5 / 9), 6);
    // The artboard does not rotate with it — it is the author's composition,
    // and a lens that turned the document would be editing rather than showing.
    expect(
      portrait.artboardScreenRect().width /
        portrait.artboardScreenRect().height,
    ).toBeCloseTo(16 / 9, 6);
  });

  it("restores the whole-stage fit, one click away", () => {
    const { camera } = setup({ lens: "16:9" });
    expect(camera.display()).toBe("16:9");
    camera.showDisplay(undefined);
    expect(camera.display()).toBeUndefined();
    // Fit is exactly what it was before the display existed: the artboard
    // contained in the whole stage, and no screen drawn around it.
    expect(camera.zoom()).toBeCloseTo(1000 / 1280, 5);
    expect(camera.displayScreenRect()).toBeUndefined();
  });

  it("keeps a camera the author has moved, rather than re-framing it", () => {
    // The fight the brief names: a display and a manual zoom both wanting to
    // own the camera. The author wins, and a host resize must not take it back.
    const { camera, resizeHost } = setup({ lens: "19.5:9" });
    camera.zoomBy(2);
    const zoomed = camera.zoom();

    resizeHost(1400, 900);

    expect(camera.display(), "the lens is still the one they chose").toBe(
      "19.5:9",
    );
    expect(camera.zoom(), "and their zoom survived the resize").toBeCloseTo(
      zoomed,
      5,
    );
  });

  it("reports the camera's fit, so the menu's tick can be read off the camera", () => {
    const { camera } = setup({ lens: "19.5:9" });
    expect(camera.isFitted(), "choosing a display fits through it").toBe(true);

    // The defect this predicate exists for: `reset` clears the lens and parks
    // the camera at 1:1, which `display()` alone reports as Fit.
    camera.reset();
    expect(camera.display()).toBeUndefined();
    expect(camera.isFitted(), "100 % is not a fit").toBe(false);

    // And the camera the author moved off the fit, under Fit rather than 100 %.
    camera.showDisplay(undefined);
    expect(camera.isFitted()).toBe(true);
    camera.zoomBy(2);
    expect(camera.isFitted(), "a zoom the author made is not a fit").toBe(
      false,
    );
    camera.zoomToFit();
    expect(camera.isFitted(), "and a refit is").toBe(true);
  });

  it("re-frames through the same display when the host resizes", () => {
    const { camera, resizeHost } = setup({ lens: "19.5:9" });
    const before = camera.artboardScreenRect();
    resizeHost(700, 900);
    const after = camera.artboardScreenRect();
    // A fitted camera follows its window — that is the property that lets the
    // shell collapse a panel without stranding the author at the old scale.
    expect(after.width).toBeLessThan(before.width);
    expect(after.width / after.height).toBeCloseTo(16 / 9, 6);
  });

  it("leaves the artboard's authored dimensions exactly as they were", () => {
    // The lens is a lens: a 3:1 board and a square one are both authored at
    // their own size, and choosing a display must not reach into either. The
    // board here is the harness's 1280x720; nothing below may change it.
    const { camera } = setup({ lens: "16:9" });
    for (const lens of ["9:19.5", "19.5:9", undefined] as const) {
      camera.showDisplay(lens);
      const board = camera.artboardScreenRect();
      const scale = board.width / 1280;
      expect(board.height / scale).toBeCloseTo(720, 6);
    }
  });

  it("moves the display box with the camera after a zoom", () => {
    const camera = createCamera({
      width: 800,
      height: 600,
      artboard: { width: 1600, height: 900 },
    });
    camera.showDisplay("16:9");
    const fitted = camera.displayScreenRect();
    camera.zoomBy(1.5);
    const zoomed = camera.displayScreenRect();
    expect(zoomed?.left).not.toBeCloseTo(fitted?.left ?? 0, 6);
    expect(zoomed?.width).toBeCloseTo((fitted?.width ?? 0) * 1.5, 6);
  });

  it("moves the display box by the pan delta", () => {
    const camera = createCamera({
      width: 800,
      height: 600,
      artboard: { width: 1600, height: 900 },
    });
    camera.showDisplay("16:9");
    camera.zoomBy(2);
    const before = camera.displayScreenRect();
    camera.panBy(40, -25);
    const after = camera.displayScreenRect();
    expect(after?.left).toBeCloseTo((before?.left ?? 0) + 40, 6);
    expect(after?.top).toBeCloseTo((before?.top ?? 0) - 25, 6);
  });

  it("inscribes the artboard diagonal in a circle lens", () => {
    const camera = createCamera({
      width: 800,
      height: 600,
      artboard: { width: 1600, height: 900 },
    });
    camera.showDisplay("Circle");
    const board = camera.artboardScreenRect();
    const screen = camera.displayScreenRect();
    expect(screen?.width).toBeCloseTo(Math.min(800, 600), 6);
    expect(Math.hypot(board.width, board.height)).toBeCloseTo(
      screen?.width ?? 0,
      6,
    );
  });

  it("clears a lens removed from the catalogue", () => {
    const camera = createCamera({
      width: 800,
      height: 600,
      artboard: { width: 1600, height: 900 },
    });
    camera.showDisplay("16:9");
    setActivePreviewRatios(["4:3"]);
    expect(camera.display()).toBeUndefined();
    resetPreviewRatios();
  });

  it("opens on the first landscape lens or Fit", () => {
    setActivePreviewRatios(["9:16"]);
    expect(
      createCamera({
        width: 800,
        height: 600,
        artboard: { width: 1600, height: 900 },
      }).display(),
    ).toBeUndefined();
    resetPreviewRatios();
  });
});
