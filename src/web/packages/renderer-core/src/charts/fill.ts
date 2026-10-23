import { parseColor } from "../color.js";
import type { Fill, GradientStop } from "../types.js";

/**
 * Shared chart fill resolution. Threshold offsets are upper bounds, so
 * `[{0.8, green}, {1, red}]` means 0–80% green, then red.
 */

/** Direction colour travels through a cartesian gradient. */
export type GradientDirection = "to-right" | "to-bottom" | "to-top";

export interface LinearGradientColor {
  readonly type: "linear";
  readonly x: number;
  readonly y: number;
  readonly x2: number;
  readonly y2: number;
  readonly colorStops: readonly {
    readonly offset: number;
    readonly color: string;
  }[];
}

export type EngineColor = string | LinearGradientColor;

/** Degenerate gradients collapse to a plain colour. */
export function toLinearGradient(
  stops: readonly GradientStop[],
  direction: GradientDirection,
): EngineColor {
  if (stops.length === 0) {
    return "transparent";
  }

  if (stops.length === 1) {
    return stops[0]!.color;
  }

  const axis = gradientAxis(direction);

  return {
    type: "linear",
    ...axis,
    colorStops: [...stops]
      .sort((a, b) => a.offset - b.offset)
      .map((s) => ({ offset: clamp01(s.offset), color: s.color })),
  };
}

function gradientAxis(direction: GradientDirection): {
  x: number;
  y: number;
  x2: number;
  y2: number;
} {
  switch (direction) {
    case "to-right":
      return { x: 0, y: 0, x2: 1, y2: 0 };
    case "to-bottom":
      return { x: 0, y: 0, x2: 0, y2: 1 };
    case "to-top":
      return { x: 0, y: 1, x2: 0, y2: 0 };
  }
}

/** First band whose upper bound contains `position`; the last band covers the tail. */
export function resolveThresholdColor(
  bands: readonly GradientStop[],
  position: number,
): string {
  if (bands.length === 0) {
    return "transparent";
  }

  const sorted = [...bands].sort((a, b) => a.offset - b.offset);
  const clamped = clamp01(position);

  for (const band of sorted) {
    if (clamped <= band.offset) {
      return band.color;
    }
  }

  return sorted.at(-1)!.color;
}

/** Resolve a fill to one flat colour at `position`. */
export function resolveFlatColor(fill: Fill, position: number): string {
  switch (fill.kind) {
    case "solid":
      return fill.color;
    case "thresholds":
      return resolveThresholdColor(fill.bands, position);
    case "gradient":
      return colorAt(fill.stops, position);
  }
}

/** Interpolate a gradient at `position`, clamping outside the stop range. */
export function colorAt(
  stops: readonly GradientStop[],
  position: number,
): string {
  if (stops.length === 0) {
    return "transparent";
  }

  const sorted = [...stops]
    .map((s) => ({ offset: clamp01(s.offset), color: s.color }))
    .sort((a, b) => a.offset - b.offset);

  const first = sorted[0]!;
  const last = sorted.at(-1)!;

  if (position <= first.offset) {
    return first.color;
  }
  if (position >= last.offset) {
    return last.color;
  }

  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i]!;
    const b = sorted[i + 1]!;

    if (position >= a.offset && position <= b.offset) {
      const span = b.offset - a.offset;
      const t = span === 0 ? 0 : (position - a.offset) / span;
      return mixHex(a.color, b.color, t);
    }
  }

  return last.color;
}

/** Mix two stored colours; an unparseable value falls back to the nearer endpoint. */
export function mixHex(from: string, to: string, t: number): string {
  const a = parseColor(from);
  const b = parseColor(to);

  if (!a || !b) {
    return t < 0.5 ? from : to;
  }

  const r = Math.round(a.r + (b.r - a.r) * t);
  const g = Math.round(a.g + (b.g - a.g) * t);
  const bl = Math.round(a.b + (b.b - a.b) * t);

  return `#${toHexByte(r)}${toHexByte(g)}${toHexByte(bl)}`;
}

function toHexByte(value: number): string {
  return Math.max(0, Math.min(255, value)).toString(16).padStart(2, "0");
}

/** Normalise a raw value to 0–1; a zero-width range maps to 0. */
export function normalizePosition(
  value: number,
  min: number,
  max: number,
): number {
  const span = max - min;
  if (span === 0) {
    return 0;
  }
  return clamp01((value - min) / span);
}

export function clamp01(value: number): number {
  return Math.min(Math.max(value, 0), 1);
}
