import type { BackgroundRegion } from "./document.js";

/** The media's region in the bounds box's pixels. */
export interface CompositionRect {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

/** The one ramp every surface paints: a canvas/CSS gradient line for a linear
 *  blend, or an ellipse fitted to the region for a radial one. */
export type BackgroundMask =
  | {
      readonly kind: "linear";
      readonly x1: number;
      readonly y1: number;
      readonly x2: number;
      readonly y2: number;
    }
  | {
      readonly kind: "radial";
      readonly cx: number;
      readonly cy: number;
      readonly rx: number;
      readonly ry: number;
      /** The fraction of the radius that is fully opaque; 1 − blend.length. */
      readonly opaqueFraction: number;
    };

export interface BackgroundComposition {
  readonly region: CompositionRect;
  readonly mask: BackgroundMask | undefined;
}

/**
 * Turns authored fractions into the one geometry every surface reads.
 *
 * The region is always the whole box unless an inset narrows it, and the ramp
 * is capped at the opposite region edge so a length longer than the region
 * cannot draw the mask outside the media.
 */
export function resolveBackgroundComposition(
  box: { readonly width: number; readonly height: number },
  region: BackgroundRegion | undefined,
): BackgroundComposition {
  const left = (region?.left ?? 0) * box.width;
  const top = (region?.top ?? 0) * box.height;
  const width = box.width - left - (region?.right ?? 0) * box.width;
  const height = box.height - top - (region?.bottom ?? 0) * box.height;
  const rect: CompositionRect = { left, top, width, height };
  const blend = region?.blend;

  if (blend === undefined) {
    return { region: rect, mask: undefined };
  }

  if (blend.shape === "radial") {
    return {
      region: rect,
      mask: {
        kind: "radial",
        cx: left + width / 2,
        cy: top + height / 2,
        rx: width / 2,
        ry: height / 2,
        opaqueFraction: 1 - blend.length,
      },
    };
  }

  const across = blend.length * box.width;
  const down = blend.length * box.height;

  switch (blend.edge) {
    case "left":
      return {
        region: rect,
        mask: {
          kind: "linear",
          x1: left,
          y1: top,
          x2: Math.min(left + across, left + width),
          y2: top,
        },
      };
    case "right":
      return {
        region: rect,
        mask: {
          kind: "linear",
          x1: left + width,
          y1: top,
          x2: Math.max(left + width - across, left),
          y2: top,
        },
      };
    case "top":
      return {
        region: rect,
        mask: {
          kind: "linear",
          x1: left,
          y1: top,
          x2: left,
          y2: Math.min(top + down, top + height),
        },
      };
    case "bottom":
      return {
        region: rect,
        mask: {
          kind: "linear",
          x1: left,
          y1: top + height,
          x2: left,
          y2: Math.max(top + height - down, top),
        },
      };
  }
}
