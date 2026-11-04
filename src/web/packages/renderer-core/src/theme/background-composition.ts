import {
  type Background,
  type BackgroundAnchor,
  type BackgroundMediaComposition,
  DEFAULT_BACKGROUND_EXTENT,
  MAX_BACKGROUND_EXTENT,
  MAX_BACKGROUND_FADE,
  MIN_BACKGROUND_EXTENT,
} from "./document.js";

/** The media's region in the bounds box's pixels. */
export interface CompositionRect {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
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
  readonly region: CompositionRect;
  /** One ramp per side that meets the fill: none for a full cover, one for an
   *  edge anchor, two for a centred band's opposite gaps. */
  readonly masks: readonly BackgroundMask[];
}

/** The composition a background actually composes. A basic background keeps
 *  the full cover it was authored with, whatever stray keys its media carries;
 *  only an advanced one positions its media and fades it into the fill. */
export function activeBackgroundComposition(
  background: Background | undefined,
): BackgroundMediaComposition | undefined {
  return background?.mode === "advanced"
    ? background.media?.composition
    : undefined;
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
 * Turns an anchor into the one geometry every surface reads.
 *
 * An edge anchor is a full-perpendicular band whose size along the anchored
 * axis is `extent`; the fill takes the remaining side. A `center` anchor keeps
 * no authored size: the picture's long edge fits the box, so the aspect decides
 * which axis leaves the two gaps and the fill never surrounds the media on all
 * four sides. With no source size yet, a centred picture covers the box until
 * its bytes say otherwise.
 */
export function resolveBackgroundComposition(
  box: { readonly width: number; readonly height: number },
  composition: BackgroundMediaComposition | undefined,
  source?: { readonly width: number; readonly height: number },
): BackgroundComposition {
  // No composition is the basic background: the media covers the box. An
  // advanced background always passes one, and only then does an absent anchor
  // mean the centred letterbox.
  if (composition === undefined) {
    return {
      region: { left: 0, top: 0, width: box.width, height: box.height },
      masks: [],
    };
  }

  const anchor = composition.anchor ?? "center";
  const fade = fadeOf(composition.fade);

  if (anchor === "center") {
    return centre(box, fade, source);
  }

  const extent = extentOf(composition?.extent);
  const rect = edgeBand(box, anchor, extent);
  if (fade === undefined) return { region: rect, masks: [] };

  const across = fade * box.width;
  const down = fade * box.height;
  const mask: BackgroundMask =
    anchor === "left"
      ? {
          kind: "linear",
          x1: rect.left + rect.width,
          y1: rect.top,
          x2: Math.max(rect.left + rect.width - across, rect.left),
          y2: rect.top,
        }
      : anchor === "right"
        ? {
            kind: "linear",
            x1: rect.left,
            y1: rect.top,
            x2: Math.min(rect.left + across, rect.left + rect.width),
            y2: rect.top,
          }
        : anchor === "top"
          ? {
              kind: "linear",
              x1: rect.left,
              y1: rect.top + rect.height,
              x2: rect.left,
              y2: Math.max(rect.top + rect.height - down, rect.top),
            }
          : {
              kind: "linear",
              x1: rect.left,
              y1: rect.top,
              x2: rect.left,
              y2: Math.min(rect.top + down, rect.top + rect.height),
            };
  return { region: rect, masks: [mask] };
}

function centre(
  box: { readonly width: number; readonly height: number },
  fade: number | undefined,
  source: { readonly width: number; readonly height: number } | undefined,
): BackgroundComposition {
  const cover: BackgroundComposition = {
    region: { left: 0, top: 0, width: box.width, height: box.height },
    masks: [],
  };
  if (
    source === undefined ||
    !(source.width > 0) ||
    !(source.height > 0) ||
    !(box.width > 0) ||
    !(box.height > 0)
  ) {
    return cover;
  }

  const boxAspect = box.width / box.height;
  const sourceAspect = source.width / source.height;
  if (Math.abs(sourceAspect - boxAspect) < 1e-9) return cover;

  const wide = sourceAspect > boxAspect;
  const region: CompositionRect = wide
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

  if (fade === undefined) return { region, masks: [] };

  // The two gaps are the pair of sides the picture's short axis leaves.
  const across = fade * box.width;
  const down = fade * box.height;
  const masks: readonly BackgroundMask[] = wide
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
  return { region, masks };
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
