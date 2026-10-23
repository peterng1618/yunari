import {
  type AssetReference,
  BACKGROUND_MEDIA_DEFAULTS,
  type Background,
  type BackgroundMedia,
} from "@yunari/renderer-core";
import type { BackdropMedia } from "./glass.js";

export interface BackgroundMediaSource {
  readonly url: string;
  readonly dispose?: () => void;
}

export interface BackgroundMediaOptions {
  readonly host: HTMLElement;
  readonly background: Background | undefined;
  readonly artboard: { readonly width: number; readonly height: number };
  readonly assets: readonly AssetReference[] | undefined;
  readonly resolveAsset: (assetId: string) => BackgroundMediaSource | undefined;
  /** A declared background that cannot be resolved is reported, never silently
   * dropped. Distinct from `SceneAdapterOptions.onAssetError`, which reports a
   * node's own asset by id; this one carries a human-readable reason. */
  readonly onMediaError?: (message: string) => void;
  /** Called once per decoded video frame. Subscribed once, at mount, and kept
   *  across a re-placement: making it per-update let a caller silently stop
   *  following frames by omitting it. Nothing subscribes unless a video is the
   *  media, so an image background starts no loop at all. */
  readonly onFrame?: () => void;
}

/** A box in host pixels: where a media layer sits and how large it is. */
export interface MediaBox {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

/** The two boxes a media layer can be sized to. */
export interface MediaBounds {
  readonly artboard: MediaBox;
  readonly display: MediaBox;
}

export interface PlacementInput {
  readonly box: { readonly width: number; readonly height: number };
  readonly source:
    | { readonly width: number; readonly height: number }
    | undefined;
  readonly offsetX: number;
  readonly offsetY: number;
}

/** Finite, non-negative. A refused reading leaves nothing to draw. */
const size = (value: number): number =>
  Number.isFinite(value) ? Math.max(0, value) : 0;

/**
 * The one media placement. The source always `cover`s the box — the larger axis
 * scale, so the rect is never smaller than the box on either axis — and the
 * offsets pan within the overhang the placed rect leaves. The result may extend
 * outside the box; the box is the caller's clip.
 *
 * **An offset implies the zoom it needs** (0095). A pan of `|o|·box` needs an
 * overhang of `|o|·box`, so that axis needs a rect of `box·(1 + 2|o|)`; the
 * factor is the largest of the cover factor and those per-axis floors. Without
 * it a picture whose aspect matches the box covers it exactly, leaves no
 * overhang, and every offset clamps to zero — the starter backdrop's case.
 * One factor for both axes, so the picture never distorts.
 *
 * The pan stays bounded by the overhang, so an offset can never uncover colour
 * inside the box: the rect has at least the overhang the offset asks for.
 */
export function placement(input: PlacementInput): MediaBox {
  const boxWidth = size(input.box.width);
  const boxHeight = size(input.box.height);
  const sourceWidth = input.source === undefined ? 0 : size(input.source.width);
  const sourceHeight =
    input.source === undefined ? 0 : size(input.source.height);

  // No intrinsic size yet: there is nothing to cover or translate, so the box
  // itself is the rect. Offsets are ignored, or the load window shows a strip.
  if (sourceWidth <= 0 || sourceHeight <= 0) {
    return { left: 0, top: 0, width: boxWidth, height: boxHeight };
  }

  const offsetX = Number.isFinite(input.offsetX) ? input.offsetX : 0;
  const offsetY = Number.isFinite(input.offsetY) ? input.offsetY : 0;
  const factor = Math.max(
    boxWidth / sourceWidth,
    boxHeight / sourceHeight,
    panFloor(boxWidth, sourceWidth, offsetX),
    panFloor(boxHeight, sourceHeight, offsetY),
  );
  const width = size(sourceWidth * factor);
  const height = size(sourceHeight * factor);
  const panX = bounded(boxWidth * offsetX, (width - boxWidth) / 2);
  const panY = bounded(boxHeight * offsetY, (height - boxHeight) / 2);
  return {
    left: (boxWidth - width) / 2 + panX,
    top: (boxHeight - height) / 2 + panY,
    width,
    height,
  };
}

/** The factor that leaves `|offset|·box` of overhang on one axis, so the pan the
 *  offset asks for is reachable instead of clamping to nothing. */
function panFloor(box: number, source: number, offset: number): number {
  return source <= 0 ? 0 : (box * (1 + 2 * Math.abs(offset))) / source;
}

/** A requested pan, stopped where the placed rect's own edge meets the box's. */
function bounded(pan: number, overhang: number): number {
  const limit = Math.max(0, overhang);
  return Math.max(-limit, Math.min(limit, pan));
}

/** A paint-time mirror about the element's own centre — the placed rect's
 *  centre — as a CSS transform. Empty when neither flip is set. */
function flipTransform(media: BackgroundMedia | undefined): string {
  const scales: string[] = [];
  if (media?.flipX === true) scales.push("scaleX(-1)");
  if (media?.flipY === true) scales.push("scaleY(-1)");
  return scales.join(" ");
}

export interface BackgroundMediaHandle {
  /** Reconfigures the layer. Same asset re-places the mounted element; a
   *  different asset (or none) tears it down and mounts afresh, because a
   *  remount is what restarts a video. */
  setBackground(background: Background | undefined): void;
  setArtboardSize(size: {
    readonly width: number;
    readonly height: number;
  }): void;
  setBounds(bounds: MediaBounds): void;
  /** Pixel access for the glass sampler, or undefined with nothing to sample.
   *  The media is a DOM sibling below the canvas, so a glass panel cannot read
   *  it out of the canvas it is painting. */
  backdrop(): BackdropMedia | undefined;
  destroy(): void;
}

/** Mounts the optional DOM-only artboard background below the caller's canvas. */
export function mountBackgroundMedia(
  options: BackgroundMediaOptions,
): BackgroundMediaHandle {
  const layer = document.createElement("div");
  layer.dataset["yunariBackgroundMedia"] = "";
  layer.style.cssText =
    "position:absolute;inset:0;overflow:hidden;pointer-events:none;";
  options.host.prepend(layer);
  const { assets, resolveAsset, onMediaError, onFrame } = options;
  let background = options.background;
  let artboardSize = {
    width: options.artboard.width,
    height: options.artboard.height,
  };
  let bounds: MediaBounds | undefined;
  let element: HTMLImageElement | HTMLVideoElement | undefined;
  let mountedAssetId: string | undefined;
  let disposeSource: (() => void) | undefined;
  let stopFrames: (() => void) | undefined;
  let stopDecoded: (() => void) | undefined;
  let stopIntrinsic: (() => void) | undefined;

  /**
   * The layer is the clip: one of the two bounds boxes. The child is placed
   * inside it by `placement`, which may extend past the clip on purpose.
   */
  const place = (): void => {
    const media = background?.media;
    const box =
      media?.bounds === "display" ? bounds?.display : bounds?.artboard;
    if (box === undefined) return;
    layer.style.left = `${box.left}px`;
    layer.style.top = `${box.top}px`;
    layer.style.right = "";
    layer.style.bottom = "";
    layer.style.width = `${box.width}px`;
    layer.style.height = `${box.height}px`;
    const child = element;
    if (child === undefined || media === undefined) return;
    const rect = placement({
      box: { width: box.width, height: box.height },
      source: intrinsic(child),
      offsetX: media.offsetX ?? BACKGROUND_MEDIA_DEFAULTS.offsetX,
      offsetY: media.offsetY ?? BACKGROUND_MEDIA_DEFAULTS.offsetY,
    });
    child.style.left = `${rect.left}px`;
    child.style.top = `${rect.top}px`;
    child.style.width = `${rect.width}px`;
    child.style.height = `${rect.height}px`;
    // Flip never enters `placement`: the rect, and the no-gap proof, stay put.
    child.style.transform = flipTransform(media);
  };

  const stop = (): void => {
    disposeSource?.();
    disposeSource = undefined;
    stopFrames?.();
    stopFrames = undefined;
    stopDecoded?.();
    stopDecoded = undefined;
    stopIntrinsic?.();
    stopIntrinsic = undefined;
  };

  /** Resolves and mounts one media, reporting rather than dropping a refusal. */
  const mount = (media: BackgroundMedia): void => {
    const asset = assets?.find((candidate) => candidate.id === media.assetId);
    if (asset === undefined) {
      onMediaError?.(
        `Background media asset "${media.assetId}" is not declared by this theme.`,
      );
      return;
    }
    if (!isBackgroundAsset(asset)) {
      onMediaError?.(
        `Background media asset "${asset.id}" is a ${asset.kind}, which cannot be a background.`,
      );
      return;
    }
    const source = resolveAsset(asset.id);
    if (source === undefined) {
      onMediaError?.(
        `Background media asset "${asset.id}" has no readable bytes.`,
      );
      return;
    }

    const child =
      asset.kind === "video"
        ? document.createElement("video")
        : document.createElement("img");
    child.src = source.url;
    // `max-width:none` is load-bearing: Tailwind's preflight (the editor's
    // stylesheet) applies `img, video { max-width: 100%; height: auto }`, which
    // capped the placed rect's width at the layer's while the inline height
    // stayed — the picture stretched, and an x offset could not widen it.
    // `max-width:none` is load-bearing: Tailwind's preflight (the editor's
    // stylesheet) applies `img, video { max-width: 100%; height: auto }`, which
    // capped the placed rect's width at the layer's while the inline height
    // stayed — the picture stretched, and an x offset could not widen it.
    child.style.cssText =
      "display:block;position:absolute;max-width:none;max-height:none;";
    if (child instanceof HTMLVideoElement) {
      child.autoplay = true;
      child.muted = true;
      child.loop = true;
      child.playsInline = true;
    }
    disposeSource = source.dispose;
    element = child;
    mountedAssetId = asset.id;
    layer.append(child);
    stopFrames = followFrames(child, onFrame);
    // Re-place before the decode repaint: the glass sample the repaint takes
    // must read the placed rect, not the pre-load fallback.
    stopIntrinsic = notifyOnIntrinsic(child, place);
    stopDecoded = notifyOnDecode(child, onFrame);
  };

  const setBackground = (next: Background | undefined): void => {
    background = next;
    const media = next?.media;
    if (media?.assetId !== mountedAssetId) {
      stop();
      layer.replaceChildren();
      element = undefined;
      mountedAssetId = undefined;
      if (media !== undefined) mount(media);
    }
    place();
  };

  setBackground(options.background);
  return {
    setBackground,
    setArtboardSize(size) {
      artboardSize = { width: size.width, height: size.height };
      place();
    },
    setBounds(next) {
      bounds = next;
      place();
    },
    backdrop(): BackdropMedia | undefined {
      const mounted = element;
      if (mounted === undefined) return undefined;
      // The rect the layer covers, in artboard units. A display-bounded layer
      // covers more than the artboard and may start outside it, so the glass
      // sampler is told the rect actually painted, not the board's own.
      const scale =
        bounds === undefined ? 0 : bounds.artboard.width / artboardSize.width;
      const rect =
        background?.media?.bounds === "display" &&
        bounds !== undefined &&
        scale > 0 &&
        Number.isFinite(scale)
          ? {
              left: (bounds.display.left - bounds.artboard.left) / scale,
              top: (bounds.display.top - bounds.artboard.top) / scale,
              width: bounds.display.width / scale,
              height: bounds.display.height / scale,
            }
          : {
              left: 0,
              top: 0,
              width: artboardSize.width,
              height: artboardSize.height,
            };
      return {
        rect,
        paint(ctx, region, device) {
          const source = intrinsic(mounted);
          // Sizing and drawing have different preconditions: metadata sizes the
          // rect, a frame is what `drawImage` accepts.
          if (source === undefined || !drawable(mounted)) return false;
          const media = background?.media;
          // The child is placed inside this rect, the layer's box in artboard
          // units; the glass maps that box onto the device rect it samples, so
          // the sampler and the element cannot show different crops.
          const placed = placement({
            box: { width: rect.width, height: rect.height },
            source,
            offsetX: media?.offsetX ?? BACKGROUND_MEDIA_DEFAULTS.offsetX,
            offsetY: media?.offsetY ?? BACKGROUND_MEDIA_DEFAULTS.offsetY,
          });
          const scaleX = rect.width > 0 ? device.width / rect.width : 0;
          const scaleY = rect.height > 0 ? device.height / rect.height : 0;
          const left = device.left - region.left + placed.left * scaleX;
          const top = device.top - region.top + placed.top * scaleY;
          const width = placed.width * scaleX;
          const height = placed.height * scaleY;
          // Five arguments: the whole source, placed. A source window is the
          // defect 0012 cropped the file with.
          if (media?.flipX === true || media?.flipY === true) {
            // `drawImage` does not flip a negative destination width, so the
            // mirror is the same context transform the DOM child carries:
            // about the placed rect's centre.
            ctx.save();
            ctx.translate(left + width / 2, top + height / 2);
            ctx.scale(
              media.flipX === true ? -1 : 1,
              media.flipY === true ? -1 : 1,
            );
            ctx.drawImage(mounted, -width / 2, -height / 2, width, height);
            ctx.restore();
          } else {
            ctx.drawImage(mounted, left, top, width, height);
          }
          return true;
        },
      };
    },
    destroy() {
      stop();
      element = undefined;
      mountedAssetId = undefined;
      layer.remove();
    },
  };
}

/**
 * Fabric cannot see a `<video>` that is a DOM sibling rather than an object, so
 * nothing repaints and the glass keeps a still frame of a moving background.
 * Repainting on the video's own cadence is the fix; on its own it is a loop.
 */
function followFrames(
  element: HTMLImageElement | HTMLVideoElement,
  onFrame: (() => void) | undefined,
): (() => void) | undefined {
  if (!(element instanceof HTMLVideoElement) || onFrame === undefined) return;
  if (typeof element.requestVideoFrameCallback !== "function") return;
  let live = true;
  const step = (): void => {
    if (!live) return;
    onFrame();
    pending = element.requestVideoFrameCallback(step);
  };
  let pending = element.requestVideoFrameCallback(step);
  return () => {
    live = false;
    element.cancelVideoFrameCallback(pending);
  };
}

/**
 * A still image's bytes land after the first paint, and until they do a glass
 * panel sampling this layer has nothing to sample - it keeps the empty
 * backdrop it took, because a DOM sibling is invisible to Fabric and nothing
 * else in the scene changes to trigger a repaint. One notification when the
 * decode lands, which is not a loop.
 */
function notifyOnDecode(
  element: HTMLImageElement | HTMLVideoElement,
  onFrame: (() => void) | undefined,
): (() => void) | undefined {
  if (onFrame === undefined) return undefined;
  // A video's first frame is the first `requestVideoFrameCallback`, so it is
  // already covered and must not ask twice.
  if (element instanceof HTMLVideoElement) return undefined;
  const onLoad = (): void => {
    element.removeEventListener("load", onLoad);
    onFrame();
  };
  element.addEventListener("load", onLoad);
  return () => {
    element.removeEventListener("load", onLoad);
  };
}

/**
 * The intrinsic size arrives after the first placement — after `load` for an
 * image, after `loadedmetadata` for a video — and there is nothing to cover
 * until it does. Re-place when it lands, and once more in case it landed before
 * the listener could be attached (a cached source completes in the same task).
 */
function notifyOnIntrinsic(
  element: HTMLImageElement | HTMLVideoElement,
  place: () => void,
): () => void {
  const event = element instanceof HTMLVideoElement ? "loadedmetadata" : "load";
  element.addEventListener(event, place);
  if (intrinsic(element) !== undefined) place();
  return () => {
    element.removeEventListener(event, place);
  };
}

/** `HTMLMediaElement`'s ready states, as numbers: enough metadata to know the
 *  video's own size, and a decoded frame to draw. */
const HAVE_METADATA = 1;
const HAVE_CURRENT_DATA = 2;

/**
 * The source's own size, or undefined while it is unknown.
 *
 * A video **knows its size from its metadata**, before any frame decodes. Gating
 * this on a frame left a video placed as the bare box — stretched to the box's
 * aspect, every offset inert — while the glass sampler, reading later, drew the
 * placed rect. Only drawing needs a frame; sizing does not.
 */
function intrinsic(
  element: HTMLImageElement | HTMLVideoElement,
): { readonly width: number; readonly height: number } | undefined {
  if (element instanceof HTMLVideoElement) {
    if (element.readyState < HAVE_METADATA) return undefined;
    if (element.videoWidth === 0 || element.videoHeight === 0) return undefined;
    return { width: element.videoWidth, height: element.videoHeight };
  }
  if (!element.complete || element.naturalWidth === 0) return undefined;
  return { width: element.naturalWidth, height: element.naturalHeight };
}

/** Whether there is a frame `drawImage` will accept. A video below
 *  HAVE_CURRENT_DATA — including every loop wrap — has a size but no pixels. */
function drawable(element: HTMLImageElement | HTMLVideoElement): boolean {
  if (!(element instanceof HTMLVideoElement)) return true;
  return element.readyState >= HAVE_CURRENT_DATA;
}

function isBackgroundAsset(
  asset: AssetReference,
): asset is AssetReference & { readonly kind: "image" | "svg" | "video" } {
  return (
    asset.kind === "image" || asset.kind === "svg" || asset.kind === "video"
  );
}
