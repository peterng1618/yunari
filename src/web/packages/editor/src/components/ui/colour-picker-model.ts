import type { Hsva } from "@yunari/renderer-core";
import { uiCopy } from "../../ui-copy.js";

/** The four channels the picker exposes, in the order its tracks show them. */
export type ColourChannel = "saturation" | "value" | "hue" | "alpha";

/**
 * Each channel in the unit its control carries: hue in degrees, the rest as
 * percentages. One table, so the track, the aria range and the keyboard agree.
 */
export const CHANNEL_RANGES: Readonly<
  Record<
    ColourChannel,
    { readonly min: number; readonly max: number; readonly step: number }
  >
> = {
  saturation: { min: 0, max: 100, step: 1 },
  value: { min: 0, max: 100, step: 1 },
  hue: { min: 0, max: 360, step: 1 },
  alpha: { min: 0, max: 100, step: 1 },
};

/** The stored `Hsva` holds saturation, value and alpha as 0–1. */
function isPercentage(channel: ColourChannel): boolean {
  return channel !== "hue";
}

export function channelValue(channel: ColourChannel, hsva: Hsva): number {
  switch (channel) {
    case "hue":
      return hsva.h;
    case "saturation":
      return hsva.s * 100;
    case "value":
      return hsva.v * 100;
    case "alpha":
      return hsva.a * 100;
  }
}

/**
 * One channel written, the rest untouched. A non-finite value is refused by
 * returning the input: coercing it to zero would paint black instead of saying
 * the number was not one.
 */
export function withChannel(
  hsva: Hsva,
  channel: ColourChannel,
  value: number,
): Hsva {
  if (!Number.isFinite(value)) return hsva;
  const range = CHANNEL_RANGES[channel];
  const bounded = clamp(value, range.min, range.max);
  const normalized = isPercentage(channel) ? bounded / 100 : bounded;
  switch (channel) {
    case "hue":
      return { ...hsva, h: normalized };
    case "saturation":
      return { ...hsva, s: normalized };
    case "value":
      return { ...hsva, v: normalized };
    case "alpha":
      return { ...hsva, a: normalized };
  }
}

/** A channel as the 0–1 fraction a pointer's position gives. */
export function channelRatio(channel: ColourChannel, hsva: Hsva): number {
  const range = CHANNEL_RANGES[channel];
  return (channelValue(channel, hsva) - range.min) / (range.max - range.min);
}

export function withChannelRatio(
  hsva: Hsva,
  channel: ColourChannel,
  ratio: number,
): Hsva {
  if (!Number.isFinite(ratio)) return hsva;
  const range = CHANNEL_RANGES[channel];
  return withChannel(
    hsva,
    channel,
    range.min + clamp(ratio, 0, 1) * (range.max - range.min),
  );
}

/** The area's channel is two at once, so it has its own pair of conversions. */
export function areaPoint(hsva: Hsva): {
  readonly x: number;
  readonly y: number;
} {
  // y is inverted: brightness is 1 at the top, which is where CSS's 0% is.
  return { x: hsva.s * 100, y: (1 - hsva.v) * 100 };
}

export function areaFromPoint(
  xRatio: number,
  yRatio: number,
): { readonly s: number; readonly v: number } {
  if (!Number.isFinite(xRatio) || !Number.isFinite(yRatio)) {
    throw new RangeError("the area point must be a finite 0–1 ratio");
  }
  return {
    s: clamp(xRatio, 0, 1),
    v: 1 - clamp(yRatio, 0, 1),
  };
}

/**
 * The area announces both of its channels and the colour they make, because
 * `aria-valuenow` can carry only one of the two.
 */
export function areaValueText(hsva: Hsva, hex: string): string {
  const saturation = Math.round(hsva.s * 100);
  const brightness = Math.round(hsva.v * 100);
  return `${uiCopy.panels.pickerSaturation} ${saturation}%, brightness ${brightness}%, ${hex}`;
}

/**
 * The value one key press moves a bounded channel to, or `undefined` for a key
 * the slider does not own. Shift is ten arrow steps; a page is ten steps on its
 * own, so Shift does not stack on a page and jump a hundred.
 */
export function steppedValue(
  value: number,
  min: number,
  max: number,
  step: number,
  key: string,
  shifted: boolean,
): number | undefined {
  const page = step * 10;
  switch (key) {
    case "ArrowRight":
    case "ArrowUp":
      return clamp(value + (shifted ? page : step), min, max);
    case "ArrowLeft":
    case "ArrowDown":
      return clamp(value - (shifted ? page : step), min, max);
    case "PageUp":
      return clamp(value + page, min, max);
    case "PageDown":
      return clamp(value - page, min, max);
    case "Home":
      return min;
    case "End":
      return max;
    default:
      return undefined;
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
