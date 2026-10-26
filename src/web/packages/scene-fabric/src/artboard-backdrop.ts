import { fillArtboardPaint } from "./artboard-paint.js";
import type { ArtboardRect, BackdropMedia, DeviceRect } from "./glass.js";

export interface ArtboardBackdropOptions {
  /** The resolved artboard paint, as the plan builder or the editor resolved it. */
  readonly background: unknown;
  readonly width: number;
  readonly height: number;
  /** The artboard's media layer, when the theme declares one. */
  readonly media: BackdropMedia | undefined;
  /** Whole degrees clockwise the composition is turned, for a media-less theme
   *  whose paint still has to sample rotated. A media layer's own angle wins. */
  readonly angle?: number;
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

  return {
    // The board's own rect, so the `device` the sampler passes is the board in
    // the context's pixels — which is the box the paint's gradient is mapped to.
    rect: board,
    angle: media?.angle ?? options.angle ?? 0,
    ...(screenRect === undefined ? {} : { screenRect }),
    paint(ctx, region, device) {
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
        );
      ctx.save();
      ctx.globalCompositeOperation = "destination-over";
      fillArtboardPaint(ctx, region, device, background);
      ctx.restore();
      // True whatever the media did. The paint is a backdrop on its own, so a
      // panel is never left sampling nothing, and the sampler keeps this
      // surface rather than falling back to the canvas.
      return true;
    },
  };
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
