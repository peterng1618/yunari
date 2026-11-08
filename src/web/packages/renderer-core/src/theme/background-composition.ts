import {
  BACKGROUND_MEDIA_DEFAULTS,
  type Background,
  type BackgroundAnchor,
  type BackgroundMediaComposition,
  DEFAULT_BACKGROUND_EXTENT,
  MAX_BACKGROUND_EXTENT,
  MAX_BACKGROUND_FADE,
  MAX_BACKGROUND_OFFSET,
  MAX_BACKGROUND_SCALE,
  MIN_BACKGROUND_EXTENT,
  MIN_BACKGROUND_OFFSET,
  MIN_BACKGROUND_SCALE,
} from "./document.js";

/** The media's region in the bounds box's pixels. */
export interface CompositionRect {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

/** A window of the source picture, in source pixels. */
export interface CompositionCrop {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** Where one picture goes: the rect a live element covers, the rect the box
 *  lets through, and the source window that fills the latter. */
export interface CompositionMedia {
  readonly cover: CompositionRect;
  readonly dest: CompositionRect;
  readonly crop: CompositionCrop;
}

/** One ramp every surface paints: transparent at the side the media meets the
 *  fill, opaque `length` pixels into the media. */
export interface BackgroundMask {
  readonly kind: "linear";
  readonly x1: number;
  readonly y1: number;
  readonly x2: number;
  readonly y2: number;
}

export interface BackgroundComposition {
  /** The media area in box pixels. It may extend past the box on any side. */
  readonly region: CompositionRect;
  /** One ramp per side that meets the fill: none for a full cover, one for an
   *  edge anchor, two for a centred band's opposite gaps. */
  readonly masks: readonly BackgroundMask[];
  /** Absent until the source's own size is known. */
  readonly media?: CompositionMedia;
}

/** The authored geometry that moves the media area. */
export interface BackgroundMediaGeometry {
  readonly scale: number;
  readonly offsetX: number;
  readonly offsetY: number;
}

/** The composition a background actually composes. A simple background keeps
 *  the full cover it was authored with, whatever stray keys its media carries;
 *  only an advanced one positions its media and fades it into the fill. */
export function activeBackgroundComposition(
  background: Background | undefined,
): BackgroundMediaComposition | undefined {
  return background?.mode === "advanced"
    ? background?.media?.composition
    : undefined;
}

const DEFAULT_GEOMETRY: BackgroundMediaGeometry = {
  scale: BACKGROUND_MEDIA_DEFAULTS.scale,
  offsetX: BACKGROUND_MEDIA_DEFAULTS.offsetX,
  offsetY: BACKGROUND_MEDIA_DEFAULTS.offsetY,
};

/** The authored scale and offsets, clamped to the document's ranges. A
 *  non-finite value is a refused reading, not a number to round. */
export function backgroundGeometry(
  media:
    | {
        readonly scale?: number;
        readonly offsetX?: number;
        readonly offsetY?: number;
      }
    | undefined,
): BackgroundMediaGeometry {
  return {
    scale: bounded(
      media?.scale,
      DEFAULT_GEOMETRY.scale,
      MIN_BACKGROUND_SCALE,
      MAX_BACKGROUND_SCALE,
    ),
    offsetX: bounded(
      media?.offsetX,
      DEFAULT_GEOMETRY.offsetX,
      MIN_BACKGROUND_OFFSET,
      MAX_BACKGROUND_OFFSET,
    ),
    offsetY: bounded(
      media?.offsetY,
      DEFAULT_GEOMETRY.offsetY,
      MIN_BACKGROUND_OFFSET,
      MAX_BACKGROUND_OFFSET,
    ),
  };
}

/** How many stops approximate the eased ramp. Every surface samples the same
 *  list, so the DOM, the glass and the panel bake draw one curve. */
export const BLEND_RAMP_STOPS = 8;

/** The eased ramp, 0 at the transparent end and 1 at the opaque one.
 *  Smootherstep has a zero derivative at both ends, which removes the visible
 *  crease a straight ramp leaves where the fade starts and stops. */
export function blendRamp(t: number): number {
  const x = Math.min(1, Math.max(0, t));
  return x * x * x * (x * (x * 6 - 15) + 10);
}

/** The ramp as evenly spaced stops, for gradients that only take stops. */
export function blendRampStops(): readonly {
  readonly offset: number;
  readonly alpha: number;
}[] {
  return Array.from({ length: BLEND_RAMP_STOPS }, (_, index) => {
    const offset = index / (BLEND_RAMP_STOPS - 1);
    return { offset, alpha: blendRamp(offset) };
  });
}

/**
 * Turns an anchor and the authored geometry into the one picture every surface
 * reads.
 *
 * The base area is the box for a simple background, the picture's contain-fit
 * for a centred one, and an extent band for an edge. Scale multiplies that
 * area about its anchor, then the offset slides it until the fill side is
 * reachable. The picture covers the final area; `dest` is what the box lets
 * through and `crop` is the source window that fills it.
 */
export function resolveBackgroundComposition(
  box: { readonly width: number; readonly height: number },
  composition: BackgroundMediaComposition | undefined,
  source?: { readonly width: number; readonly height: number },
  geometry: BackgroundMediaGeometry = DEFAULT_GEOMETRY,
): BackgroundComposition {
  const authored = backgroundGeometry(geometry);
  const known = knownSize(source, box);

  if (composition === undefined) {
    const region = slid(
      scaled(boxRect(box), "center", authored.scale, box),
      box,
      authored,
    );
    return known
      ? { region, masks: [], media: placeMedia(region, box, known) }
      : { region, masks: [] };
  }

  const anchor = composition.anchor ?? "center";
  const fade = fadeOf(composition.fade);

  if (anchor === "center") {
    const mode = known === undefined ? undefined : centreMode(box, known);
    const base =
      known === undefined || mode === undefined
        ? boxRect(box)
        : centreRect(box, known);
    const region = slid(
      scaled(base, "center", authored.scale, box),
      box,
      authored,
    );
    const masks =
      mode === undefined ? [] : centreMasks(region, box, fade, mode.wide);
    return known === undefined
      ? { region, masks }
      : { region, masks, media: placeMedia(region, box, known) };
  }

  const base = edgeBand(box, anchor, extentOf(composition.extent));
  const region = slid(scaled(base, anchor, authored.scale, box), box, authored);
  const masks = edgeMasks(region, box, anchor, fade);
  return known === undefined
    ? { region, masks }
    : { region, masks, media: placeMedia(region, box, known) };
}

/** The source size when both it and the box can be divided by. */
function knownSize(
  source: { readonly width: number; readonly height: number } | undefined,
  box: { readonly width: number; readonly height: number },
): { readonly width: number; readonly height: number } | undefined {
  return source !== undefined &&
    source.width > 0 &&
    source.height > 0 &&
    box.width > 0 &&
    box.height > 0
    ? source
    : undefined;
}

function boxRect(box: {
  readonly width: number;
  readonly height: number;
}): CompositionRect {
  return { left: 0, top: 0, width: box.width, height: box.height };
}

/** The picture's long edge fits the box, so the aspect decides which axis
 *  leaves the two gaps. */
function centreRect(
  box: { readonly width: number; readonly height: number },
  source: { readonly width: number; readonly height: number },
): CompositionRect {
  const boxAspect = box.width / box.height;
  const sourceAspect = source.width / source.height;
  return sourceAspect > boxAspect
    ? {
        left: 0,
        top: (box.height - box.width / sourceAspect) / 2,
        width: box.width,
        height: box.width / sourceAspect,
      }
    : {
        left: (box.width - box.height * sourceAspect) / 2,
        top: 0,
        width: box.height * sourceAspect,
        height: box.height,
      };
}

/** Which way the centred picture leaves its gaps, or `undefined` when the
 *  aspects match and it covers the box. */
function centreMode(
  box: { readonly width: number; readonly height: number },
  source: { readonly width: number; readonly height: number },
): { readonly wide: boolean } | undefined {
  const boxAspect = box.width / box.height;
  const sourceAspect = source.width / source.height;
  return Math.abs(sourceAspect - boxAspect) < 1e-9
    ? undefined
    : { wide: sourceAspect > boxAspect };
}

/** Scale multiplies the base area about its anchor. A centred area grows about
 *  the box centre; a band grows across the box from the edge it is pinned to,
 *  keeping the perpendicular at the box's own extent. */
function scaled(
  base: CompositionRect,
  anchor: BackgroundAnchor,
  scale: number,
  box: { readonly width: number; readonly height: number },
): CompositionRect {
  switch (anchor) {
    case "left":
      return {
        left: base.left,
        top: 0,
        width: base.width * scale,
        height: box.height,
      };
    case "right":
      return {
        left: box.width - base.width * scale,
        top: 0,
        width: base.width * scale,
        height: box.height,
      };
    case "top":
      return {
        left: 0,
        top: base.top,
        width: box.width,
        height: base.height * scale,
      };
    case "bottom":
      return {
        left: 0,
        top: box.height - base.height * scale,
        width: box.width,
        height: base.height * scale,
      };
    case "center": {
      const centreX = base.left + base.width / 2;
      const centreY = base.top + base.height / 2;
      return {
        left: centreX - (base.width * scale) / 2,
        top: centreY - (base.height * scale) / 2,
        width: base.width * scale,
        height: base.height * scale,
      };
    }
  }
}

/** The offset slides the area over the box and stops where its far edge meets
 *  the box's opposite edge. */
function slid(
  region: CompositionRect,
  box: { readonly width: number; readonly height: number },
  geometry: BackgroundMediaGeometry,
): CompositionRect {
  const travelX = Math.abs(box.width - region.width) / 2;
  const travelY = Math.abs(box.height - region.height) / 2;
  return {
    left: region.left + clamp(geometry.offsetX * box.width, -travelX, travelX),
    top: region.top + clamp(geometry.offsetY * box.height, -travelY, travelY),
    width: region.width,
    height: region.height,
  };
}

/** The part of `region` the box lets through, never smaller than a pixel.
 *  Every surface that draws the final picture reads this one intersect. */
export function visibleArea(
  region: CompositionRect,
  box: { readonly width: number; readonly height: number },
): CompositionRect {
  const left = Math.max(0, region.left);
  const top = Math.max(0, region.top);
  const right = Math.min(box.width, region.left + region.width);
  const bottom = Math.min(box.height, region.top + region.height);
  return {
    left,
    top,
    width: Math.max(1, Math.min(box.width - left, right - left)),
    height: Math.max(1, Math.min(box.height - top, bottom - top)),
  };
}

/** The source window that fills `dest`, and the cover rect it was cut from. */
function placeMedia(
  region: CompositionRect,
  box: { readonly width: number; readonly height: number },
  source: { readonly width: number; readonly height: number },
): CompositionMedia {
  const factor = Math.max(
    region.width / source.width,
    region.height / source.height,
  );
  const cover: CompositionRect = {
    left: region.left + (region.width - source.width * factor) / 2,
    top: region.top + (region.height - source.height * factor) / 2,
    width: source.width * factor,
    height: source.height * factor,
  };
  const dest = visibleArea(cover, box);
  const x = clamp(
    Math.round((dest.left - cover.left) / factor),
    0,
    source.width - 1,
  );
  const y = clamp(
    Math.round((dest.top - cover.top) / factor),
    0,
    source.height - 1,
  );
  const width = clamp(Math.round(dest.width / factor), 1, source.width - x);
  const height = clamp(Math.round(dest.height / factor), 1, source.height - y);
  return { cover, dest, crop: { x, y, width, height } };
}

function centreMasks(
  region: CompositionRect,
  box: { readonly width: number; readonly height: number },
  fade: number | undefined,
  wide: boolean,
): readonly BackgroundMask[] {
  if (fade === undefined) return [];
  const across = fade * box.width;
  const down = fade * box.height;
  // The two gaps are the pair of sides the picture's short axis leaves.
  return wide
    ? [
        {
          kind: "linear",
          x1: region.left,
          y1: region.top,
          x2: region.left,
          y2: Math.min(region.top + down, region.top + region.height),
        },
        {
          kind: "linear",
          x1: region.left,
          y1: region.top + region.height,
          x2: region.left,
          y2: Math.max(region.top + region.height - down, region.top),
        },
      ]
    : [
        {
          kind: "linear",
          x1: region.left,
          y1: region.top,
          x2: Math.min(region.left + across, region.left + region.width),
          y2: region.top,
        },
        {
          kind: "linear",
          x1: region.left + region.width,
          y1: region.top,
          x2: Math.max(region.left + region.width - across, region.left),
          y2: region.top,
        },
      ];
}

function edgeBand(
  box: { readonly width: number; readonly height: number },
  anchor: Exclude<BackgroundAnchor, "center">,
  extent: number,
): CompositionRect {
  switch (anchor) {
    case "left":
      return { left: 0, top: 0, width: box.width * extent, height: box.height };
    case "right":
      return {
        left: box.width * (1 - extent),
        top: 0,
        width: box.width * extent,
        height: box.height,
      };
    case "top":
      return { left: 0, top: 0, width: box.width, height: box.height * extent };
    case "bottom":
      return {
        left: 0,
        top: box.height * (1 - extent),
        width: box.width,
        height: box.height * extent,
      };
  }
}

function edgeMasks(
  region: CompositionRect,
  box: { readonly width: number; readonly height: number },
  anchor: Exclude<BackgroundAnchor, "center">,
  fade: number | undefined,
): readonly BackgroundMask[] {
  if (fade === undefined) return [];
  const across = fade * box.width;
  const down = fade * box.height;
  const mask: BackgroundMask =
    anchor === "left"
      ? {
          kind: "linear",
          x1: region.left + region.width,
          y1: region.top,
          x2: Math.max(region.left + region.width - across, region.left),
          y2: region.top,
        }
      : anchor === "right"
        ? {
            kind: "linear",
            x1: region.left,
            y1: region.top,
            x2: Math.min(region.left + across, region.left + region.width),
            y2: region.top,
          }
        : anchor === "top"
          ? {
              kind: "linear",
              x1: region.left,
              y1: region.top + region.height,
              x2: region.left,
              y2: Math.max(region.top + region.height - down, region.top),
            }
          : {
              kind: "linear",
              x1: region.left,
              y1: region.top,
              x2: region.left,
              y2: Math.min(region.top + down, region.top + region.height),
            };
  return [mask];
}

function extentOf(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) {
    return DEFAULT_BACKGROUND_EXTENT;
  }
  return Math.min(
    MAX_BACKGROUND_EXTENT,
    Math.max(MIN_BACKGROUND_EXTENT, value),
  );
}

function fadeOf(value: number | undefined): number | undefined {
  if (value === undefined || !Number.isFinite(value) || value <= 0) {
    return undefined;
  }
  return Math.min(MAX_BACKGROUND_FADE, value);
}

function bounded(
  value: number | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.min(maximum, Math.max(minimum, value));
}

function clamp(value: number, low: number, high: number): number {
  return Math.max(low, Math.min(high, value));
}
