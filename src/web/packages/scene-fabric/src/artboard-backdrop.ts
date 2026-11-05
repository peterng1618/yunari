import {
  type ArtboardShape,
  type BackgroundMask,
  blendRampStops,
  type CompositionRect,
  cssArtboardPaint,
  type DisplayShape,
  type GlassSampling,
} from "@yunari/renderer-core";
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
  /** The authored canvas's shape. A circle artboard's theme-bounded media is
   *  the disc inscribed in the board, so a panel and a stored thumbnail see the
   *  same picture: the board's colour in the four corners. Display-bounded
   *  media keeps its own geometry and is clipped only by the display. */
  readonly artboardShape?: ArtboardShape;
}

/**
 * What is actually behind a glass panel: **the artboard's own paint, with its
 * media over it**.
 *
 * The paint is here rather than on the canvas because the canvas sits above the
 * media layer, where a fill of it would hide the media completely and leave the
 * reader no letterbox. It cannot simply be dropped, though: the glass samples
 * the canvas's own pixels, so a board whose paint only reached the host would
 * leave every panel sampling nothing — measured as alpha 130, the tint over
 * transparency — which is the same defect in another costume.
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
  // A display-bounded layer's own box is not the board: it is the screen, so
  // its device rect is carried through, and the media turns inside it with the
  // display's mount angle.
  const screenRect = media?.screenRect;
  const surface = options.surface;
  // One scratch reused for every panel on this backdrop sample. The sampler
  // builds a fresh backdrop per render, so the surface lives as long as the
  // objects that paint it and is released with them.
  let scratch: HTMLCanvasElement | undefined;

  return {
    // The board's own rect, so the `device` the sampler passes is the board in
    // the context's pixels — which is the box the paint's gradient is mapped to.
    rect: board,
    key: compositionKey(options, board),
    angle: media?.angle ?? options.angle ?? 0,
    ...(screenRect === undefined ? {} : { screenRect }),
    ...(surface === undefined
      ? {}
      : { plate: surfacePlate(surface, background) }),
    paint(ctx, region, device, sampling) {
      // The media first and the paint **underneath** it, so a frame the media
      // could not paint is left where it was: clearing to the colour
      // first would throw away the one frame the reader would otherwise keep.
      const disc =
        options.artboardShape === "circle" && screenRect === undefined;
      if (disc) {
        // **A theme-bounded picture on a circle artboard is the disc**, the same
        // rule the media layer applies in the DOM. Clipping here rather than in
        // each caller keeps the panel and the stored thumbnail on one decision.
        ctx.save();
        ctx.beginPath();
        ctx.arc(
          device.left + device.width / 2 - region.left,
          device.top + device.height / 2 - region.top,
          Math.min(device.width, device.height) / 2,
          0,
          Math.PI * 2,
        );
        ctx.clip();
      }
      if (media !== undefined) {
        const mediaBox =
          screenRect === undefined
            ? mediaDevice(device, board, media.rect)
            : device;
        if (media.region === undefined) {
          media.paint(ctx, region, mediaBox, sampling);
        } else {
          paintComposition(
            ctx,
            region,
            mediaBox,
            media,
            sampling,
            () => (scratch ??= document.createElement("canvas")),
          );
        }
      }
      if (disc) ctx.restore();
      ctx.save();
      ctx.globalCompositeOperation = "destination-over";
      if (surface === undefined) {
        // No display surface to sit on: the board's paint is the whole
        // backdrop and covers the region it is asked to.
        fillRegionPaint(ctx, region, device, background);
      } else if (screenRect === undefined) {
        // **The board's plate, and it turns with the composition.** The
        // sampler has already turned this context about the board's mapped
        // centre, so clipping to the board's device box turns the fill with it.
        // The screen's own fill is the `plate` below, composited after this and
        // therefore underneath it; a display-bounded layer already covers the
        // screen, so it contributes nothing here.
        const local = regionLocal(device, region);
        ctx.beginPath();
        ctx.rect(local.left, local.top, local.width, local.height);
        ctx.clip();
        // Fill the board box itself, not the region: the context is turned, so
        // the region-shaped rect would land somewhere else in the user space.
        // The clip above already limits the paint to the board's quad.
        fillArtboardPaint(ctx, local, local, background);
      }
      ctx.restore();
      // True whatever the media did. The paint is a backdrop on its own, so a
      // panel is never left sampling nothing, and the sampler keeps this
      // surface rather than falling back to the canvas.
      return true;
    },
  };
}

/**
 * What the composed picture is made of. A panel keeps its last sample while
 * that sample's region holds still, which is how a video survives a loop wrap;
 * the key is what tells it the *picture* still holds still too. A repaint is
 * `destination-over` and cannot replace opaque pixels an older, larger media
 * region or an older paint left behind, so a changed key must start from
 * nothing. The video's own frames are not part of it: they are repainted over
 * the same composition every frame.
 */
function compositionKey(
  options: ArtboardBackdropOptions,
  board: ArtboardRect,
): string {
  const { media } = options;
  return JSON.stringify([
    cssArtboardPaint(options.background) ?? null,
    board,
    options.angle,
    options.artboardShape ?? null,
    options.surface === undefined
      ? null
      : [options.surface.shape, options.surface.box],
    media === undefined
      ? null
      : [media.rect, media.angle, media.screenRect, media.region, media.masks],
  ]);
}

/**
 * The screen's own fill: the host rect for a rect display, the disc on black
 * for a circle. **It is the letterbox, not the board's plate** — the board's
 * paint is the caller's turned layer above this one — and it stays screen-fixed
 * because the host and disc are the screen. The caller composites it
 * `destination-over`, so a media frame kept from an earlier one is never
 * overwritten — and so the black outside the disc reaches only the pixels the
 * disc's paint did not.
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

/**
 * The composed media: the media clipped to the authored region and faded by
 * its mask. Where the mask thins it, the board's paint underneath is what the
 * panel sees.
 *
 * The masked media is built on a scratch surface the size of the region and
 * drawn once, so `destination-in` never touches the sampler's own context: a
 * `destination-in` there would erase everything painted beside the media.
 */
function paintComposition(
  ctx: CanvasRenderingContext2D,
  surfaceRegion: DeviceRect,
  mediaBox: DeviceRect,
  media: BackdropMedia,
  sampling: GlassSampling,
  scratchOf: () => HTMLCanvasElement,
): boolean {
  const region = media.region;
  if (region === undefined) return false;
  const box = media.rect;
  const scaleX = box.width > 0 ? mediaBox.width / box.width : 0;
  const scaleY = box.height > 0 ? mediaBox.height / box.height : 0;
  const regionDevice: DeviceRect = {
    left: mediaBox.left + region.left * scaleX,
    top: mediaBox.top + region.top * scaleY,
    width: region.width * scaleX,
    height: region.height * scaleY,
  };

  const width = Math.round(regionDevice.width);
  const height = Math.round(regionDevice.height);
  if (!(width > 0) || !(height > 0)) return false;

  const scratch = scratchOf();
  if (scratch.width !== width) scratch.width = width;
  if (scratch.height !== height) scratch.height = height;
  const context = scratch.getContext("2d");
  if (context === null) return false;
  context.clearRect(0, 0, width, height);

  // The media is placed inside the region, exactly as the DOM layer is.
  const painted = media.paint(context, regionDevice, mediaBox, sampling);
  if (painted && media.masks !== undefined) {
    for (const mask of media.masks) {
      applyMask(context, mask, region, scaleX, scaleY);
    }
  }
  ctx.drawImage(
    scratch,
    regionDevice.left - surfaceRegion.left,
    regionDevice.top - surfaceRegion.top,
  );
  return painted;
}

/** Multiplies the scratch's alpha by one resolved ramp, in region-local pixels. */
function applyMask(
  ctx: CanvasRenderingContext2D,
  mask: BackgroundMask,
  region: CompositionRect,
  scaleX: number,
  scaleY: number,
): void {
  const x = (value: number): number => (value - region.left) * scaleX;
  const y = (value: number): number => (value - region.top) * scaleY;

  ctx.save();
  ctx.globalCompositeOperation = "destination-in";
  const gradient = ctx.createLinearGradient(
    x(mask.x1),
    y(mask.y1),
    x(mask.x2),
    y(mask.y2),
  );
  for (const stop of blendRampStops()) {
    gradient.addColorStop(stop.offset, `rgba(0, 0, 0, ${stop.alpha})`);
  }
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  ctx.restore();
}
