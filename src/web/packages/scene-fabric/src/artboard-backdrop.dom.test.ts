// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import { artboardBackdrop } from "./artboard-backdrop.js";
import type { BackdropMedia, DeviceRect } from "./glass.js";

/**
 * The composition decision 0080 rests on: what a glass panel samples is the
 * board's paint **with its media over it**, and not the canvas, which sits above
 * the media and can no longer carry the paint at all.
 *
 * Pixels rather than calls, because every one of these cases is about what ends
 * up in the surface — the layering is the whole content of the decision.
 */

const REGION: DeviceRect = { left: 0, top: 0, width: 20, height: 20 };
const DEVICE: DeviceRect = { left: 0, top: 0, width: 20, height: 20 };
const COLOUR = "#101216";
const PAINTED: readonly number[] = [16, 18, 22, 255];

function scratch(): CanvasRenderingContext2D {
  const canvas = document.createElement("canvas");
  canvas.width = REGION.width;
  canvas.height = REGION.height;
  const context = canvas.getContext("2d");
  if (context === null) throw new Error("The test canvas has no 2D context.");
  return context;
}

function pixel(context: CanvasRenderingContext2D, x: number, y: number) {
  return [...context.getImageData(x, y, 1, 1).data];
}

/** A media layer that paints its left half and reports what it was asked to. */
function halfRed(paints: boolean): BackdropMedia {
  return {
    rect: { left: 0, top: 0, width: 20, height: 20 },
    paint(ctx, region) {
      if (!paints) return false;
      ctx.fillStyle = "#ff0000";
      ctx.fillRect(region.left, region.top, region.width / 2, region.height);
      return true;
    },
  };
}

describe("the artboard backdrop", () => {
  it("is the board's own rect, so the sampler maps a gradient to the board", () => {
    const backdrop = artboardBackdrop({
      background: COLOUR,
      width: 20,
      height: 20,
      media: undefined,
    });

    expect(backdrop.rect).toEqual({ left: 0, top: 0, width: 20, height: 20 });
  });

  it("paints a circle display's disc, and black outside it", () => {
    // The surface a panel sees with no media is the disc: the theme's paint
    // clipped to the round screen, and black where the screen is not. The
    // caller composites it under the media, hence `destination-over`.
    const backdrop = artboardBackdrop({
      background: "#ff0000",
      width: 20,
      height: 20,
      media: undefined,
      surface: {
        shape: "circle",
        box: { left: 0, top: 0, width: 20, height: 20 },
      },
    });
    const plate = backdrop.plate;
    if (plate === undefined) throw new Error("the surface painted no plate");
    expect(plate.screenRect).toEqual({
      left: 0,
      top: 0,
      width: 20,
      height: 20,
    });

    const context = scratch();
    context.globalCompositeOperation = "destination-over";
    plate.paint(context, REGION, DEVICE);

    expect(pixel(context, 10, 10), "inside the disc").toEqual([255, 0, 0, 255]);
    // (1, 1) is 12.7px from the centre of a 10px-radius disc.
    expect(pixel(context, 1, 1), "outside the disc").toEqual([0, 0, 0, 255]);
  });

  it("maps a rect display's plate across the host box, not the board", () => {
    // The host's background spans the whole viewport, so a panel in the
    // letterbox still samples the board's paint — mapped to the host, which is
    // the box the CSS gradient actually covers.
    const backdrop = artboardBackdrop({
      background: {
        kind: "gradient",
        angle: 0,
        stops: [
          { offset: 0, color: "#000000" },
          { offset: 1, color: "#ffffff" },
        ],
      },
      width: 20,
      height: 20,
      media: undefined,
      surface: {
        shape: "rect",
        // A host box wider than the board: the gradient's far end is here.
        box: { left: 0, top: 0, width: 40, height: 20 },
      },
    });
    const plate = backdrop.plate;
    if (plate === undefined) throw new Error("the surface painted no plate");
    const context = scratch();
    context.globalCompositeOperation = "destination-over";
    plate.paint(context, REGION, { left: 0, top: 0, width: 40, height: 20 });

    // 19 of the host's 40 px is just short of the gradient's midpoint; a
    // board-mapped plate (20 px wide) would be nearly white here.
    const mid = pixel(context, 19, 10)[0] ?? 0;
    expect(mid, "half way along the host").toBeGreaterThan(80);
    expect(mid).toBeLessThan(160);
  });

  it("paints the board's colour when the theme declares no media", () => {
    // The case the canvas used to cover: a colour-only theme has no media layer
    // for a panel to sample, so without this the panel composites over
    // transparency — alpha 130, measured, which is the defect 0079 closed.
    const context = scratch();
    const painted = artboardBackdrop({
      background: COLOUR,
      width: 20,
      height: 20,
      media: undefined,
    }).paint(context, REGION, DEVICE, "dynamic");

    expect(painted, "a colour is a backdrop on its own").toBe(true);
    expect(pixel(context, 4, 4)).toEqual(PAINTED);
    expect(pixel(context, 19, 19)).toEqual(PAINTED);
  });

  it("puts the media over the colour and the colour where the media is not", () => {
    const context = scratch();
    artboardBackdrop({
      background: COLOUR,
      width: 20,
      height: 20,
      media: halfRed(true),
    }).paint(context, REGION, DEVICE, "dynamic");

    expect(pixel(context, 2, 10), "the media wins where it painted").toEqual([
      255, 0, 0, 255,
    ]);
    expect(pixel(context, 15, 10), "and the board shows beside it").toEqual(
      PAINTED,
    );
  });

  it("keeps the media's last frame across one it cannot paint", () => {
    // 0079 in one assertion: the colour is painted *under* what is already in
    // the surface, so a video's loop wrap — where `drawImage` refuses the
    // source — does not blank the frame the reader would otherwise keep.
    const context = scratch();
    let frames = 0;
    const media: BackdropMedia = {
      rect: { left: 0, top: 0, width: 20, height: 20 },
      paint(ctx, region) {
        frames += 1;
        if (frames > 1) return false;
        ctx.fillStyle = "#ff0000";
        ctx.fillRect(region.left, region.top, region.width / 2, region.height);
        return true;
      },
    };
    const backdrop = artboardBackdrop({
      background: COLOUR,
      width: 20,
      height: 20,
      media,
    });

    backdrop.paint(context, REGION, DEVICE, "dynamic");
    const kept = backdrop.paint(context, REGION, DEVICE, "dynamic");

    expect(kept, "the colour is still a backdrop for that frame").toBe(true);
    expect(pixel(context, 2, 10), "the kept frame is untouched").toEqual([
      255, 0, 0, 255,
    ]);
    expect(pixel(context, 15, 10)).toEqual(PAINTED);
  });

  it("maps a gradient across the board's device rect, not across the region", () => {
    // A board painted as a gradient is the same picture wherever it is drawn, so
    // a panel sampling a corner of it must get the corner's colour. The board is
    // 100px wide in this context's pixels and the region is a 20px window 40px
    // in, so a region-mapped gradient would read black at its own left edge.
    const context = scratch();
    const device: DeviceRect = { left: -40, top: 0, width: 100, height: 20 };
    artboardBackdrop({
      background: {
        kind: "gradient",
        angle: 0,
        stops: [
          { offset: 0, color: "#000000" },
          { offset: 1, color: "#ffffff" },
        ],
      },
      width: 20,
      height: 20,
      media: undefined,
    }).paint(context, REGION, device, "dynamic");

    const left = pixel(context, 0, 10)[0] ?? 0;
    const right = pixel(context, 19, 10)[0] ?? 0;
    expect(left, "40% into the board, so mid-grey").toBeGreaterThan(80);
    expect(left).toBeLessThan(130);
    expect(right, "and further along it").toBeGreaterThan(left);
  });

  it("paints a rotated gradient in the direction the CSS preview shows", () => {
    // Stored angle 90 is CSS's `0deg` — first stop at the bottom. The canvas
    // gradient is the form a glass panel samples, so a mirrored sweep here is a
    // panel sampling the wrong half of the board (gradient without rotation was
    // correct, which is how the sign survived).
    const context = scratch();
    artboardBackdrop({
      background: {
        kind: "gradient",
        angle: 90,
        stops: [
          { offset: 0, color: "#000000" },
          { offset: 1, color: "#ffffff" },
        ],
      },
      width: 20,
      height: 20,
      media: undefined,
    }).paint(context, REGION, DEVICE, "dynamic");

    const top = pixel(context, 10, 0)[0] ?? 0;
    const bottom = pixel(context, 10, 19)[0] ?? 0;
    expect(top, "the last stop is at the top").toBeGreaterThan(200);
    expect(bottom, "the first stop is at the bottom").toBeLessThan(55);
  });

  it("leaves the colour under a media layer that has no frame yet", () => {
    const context = scratch();
    artboardBackdrop({
      background: COLOUR,
      width: 20,
      height: 20,
      media: halfRed(false),
    }).paint(context, REGION, DEVICE, "dynamic");

    expect(pixel(context, 2, 10), "where the media would have been").toEqual(
      PAINTED,
    );
  });
});
