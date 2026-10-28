import type { DisplayShape } from "@yunari/renderer-core";
import { fillArtboardPaint } from "./artboard-paint.js";
import type { MediaBox } from "./background-media.js";
import type {
  ArtboardRect,
  BackdropMedia,
  BackdropPlate,
  DeviceRect,
} from "./glass.js";

/** The display's own surface: the host rect for a rect display, the disc for a
 *  circle. Both are DOM boxes in host pixels, and **neither turns with the
 *  composition** — the media inside them does. */
export interface ArtboardSurface {
  readonly shape: DisplayShape;
  readonly box: MediaBox;
}

export interface ArtboardBackdropOptions {
  /** The resolved artboard paint, as the plan builder or the editor resolved it. */
  readonly background: unknown;
  readonly width: number;
  readonly height: number;
  /** The artboard's media layer, when the theme declares one. */
  readonly media: BackdropMedia | undefined;
  /** Whole degrees clockwise the composition is turned. The media turns with it,
   *  the display surface does not. */
  readonly angle?: number;
  /** The display's own surface — the paint a panel sees where the media is
   *  absent or transparent. Absent keeps the board's own rect as the paint
   *  surface, the behaviour the earlier direct-call cases pin. */
  readonly surface?: ArtboardSurface;
}

/**
 * What is actually behind a glass panel: **the artboard's own paint, with its
 * media over it** (0080).
 *
 * The paint is here rather than on the canvas because the canvas sits above the
 * media layer, where a fill of it would hide the media completely and leave the
 * reader no letterbox. It cannot simply be dropped, though: the glass samples
 * the canvas's own pixels, so a board whose paint only reached the host would
 * leave every panel sampling nothing — measured as alpha 130, the tint over
 * transparency — which is the defect decision 0079 closed, in another costume.
 *
 * The two are composed rather than listed because they are one surface: the
 * paint is what shows wherever the media is not, and a theme with no media (or
 * one whose media has not decoded a frame) keeps a colour backdrop rather than
 * losing its body.
 */
export function artboardBackdrop(
  options: ArtboardBackdropOptions,
): BackdropMedia {
  const { background, media } = options;
  const board: ArtboardRect = {
    left: 0,
    top: 0,
    width: options.width,
    height: options.height,
  };
  // A display-bounded layer's own box is not the board: it fills the host and
  // must not turn with the composition, so its device rect is carried through.
  const screenRect = media?.screenRect;
  const surface = options.surface;

  return {
    // The board's own rect, so the `device` the sampler passes is the board in
    // the context's pixels — which is the box the paint's gradient is mapped to.
    rect: board,
    angle: media?.angle ?? options.angle ?? 0,
    ...(screenRect === undefined ? {} : { screenRect }),
    ...(surface === undefined
      ? {}
      : { plate: surfacePlate(surface, background) }),
    paint(ctx, region, device, sampling) {
      // The media first and the paint **underneath** it, so a frame the media
      // could not paint is left where it was (0079): clearing to the colour
      // first would throw away the one frame the reader would otherwise keep.
      if (media !== undefined)
        media.paint(
          ctx,
          region,
          screenRect === undefined
            ? mediaDevice(device, board, media.rect)
            : device,
          sampling,
        );
      // **A display surface paints the paint, not this paint** (0125). The plate
      // is the host/disc box a panel actually sees, and it must not be turned
      // with the composition; the board-mapped fill below would be.
      if (surface !== undefined) return true;
      ctx.save();
      ctx.globalCompositeOperation = "destination-over";
      fillRegionPaint(ctx, region, device, background);
      ctx.restore();
      // True whatever the media did. The paint is a backdrop on its own, so a
      // panel is never left sampling nothing, and the sampler keeps this
      // surface rather than falling back to the canvas.
      return true;
    },
  };
}

/**
 * The display's own paint as a plate: the host rect for a rect display, the
 * disc on black for a circle. The caller composites it `destination-over`, so a
 * media frame kept from an earlier one is never overwritten — and so the black
 * outside the disc reaches only the pixels the disc's paint did not.
 */
function surfacePlate(
  surface: ArtboardSurface,
  background: unknown,
): BackdropPlate {
  return {
    screenRect: surface.box,
    paint(ctx, region, device) {
      // The sampler hands a **region-sized** surface, so the paint is drawn in
      // region-local pixels while both boxes arrive in the surface's own.
      const local = regionLocal(device, region);
      if (surface.shape === "rect") {
        if (!fillRegionPaint(ctx, region, device, background))
          fillBlack(ctx, region);
        return;
      }
      ctx.save();
      ctx.beginPath();
      ctx.arc(
        local.left + local.width / 2,
        local.top + local.height / 2,
        Math.min(local.width, local.height) / 2,
        0,
        Math.PI * 2,
      );
      ctx.clip();
      fillRegionPaint(ctx, region, device, background);
      ctx.restore();
      // Outside the disc is outside the screen, exactly as the host shows it.
      fillBlack(ctx, region);
    },
  };
}

/** The paint across the region, mapped to `device` — both pulled back to the
 *  region-sized surface's own origin. */
function fillRegionPaint(
  ctx: CanvasRenderingContext2D,
  region: DeviceRect,
  device: DeviceRect,
  background: unknown,
): boolean {
  return fillArtboardPaint(
    ctx,
    { left: 0, top: 0, width: region.width, height: region.height },
    regionLocal(device, region),
    background,
  );
}

/** A box stated in surface pixels, in the region-sized paint surface's own
 *  pixels. */
function regionLocal(box: DeviceRect, region: DeviceRect): DeviceRect {
  return {
    left: box.left - region.left,
    top: box.top - region.top,
    width: box.width,
    height: box.height,
  };
}

/** The host's own fallback, which is what the scene paints when the resolved
 *  background is not paintable (`cssArtboardPaint(...) ?? "#000"`). */
function fillBlack(ctx: CanvasRenderingContext2D, region: DeviceRect): void {
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, region.width, region.height);
}

/** The media's own rect in the context's pixels, converted from the board's. */
function mediaDevice(
  device: DeviceRect,
  board: ArtboardRect,
  rect: ArtboardRect,
): DeviceRect {
  // Two scales rather than one: `device` is the board as the camera drew it, and
  // nothing here is entitled to assume the camera scaled the axes alike.
  const scaleX = board.width > 0 ? device.width / board.width : 0;
  const scaleY = board.height > 0 ? device.height / board.height : 0;
  return {
    left: device.left + rect.left * scaleX,
    top: device.top + rect.top * scaleY,
    width: rect.width * scaleX,
    height: rect.height * scaleY,
  };
}
