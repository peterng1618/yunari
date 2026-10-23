import {
  converter,
  formatHex,
  formatHex8,
  modeHsl,
  modeHsv,
  modeRgb,
  parse,
  useMode,
} from "culori/fn";

useMode(modeRgb);
useMode(modeHsl);
useMode(modeHsv);

/** sRGB channels 0–255, alpha 0–1. */
export interface Rgba {
  readonly r: number;
  readonly g: number;
  readonly b: number;
  readonly a: number;
}

/** Hue 0–360, saturation/value/alpha 0–1. */
export interface Hsva {
  readonly h: number;
  readonly s: number;
  readonly v: number;
  readonly a: number;
}

const toRgb = converter("rgb");
const hsvOf = converter("hsv");

/**
 * One parser for every stored colour: hex, `rgb()`, `hsl()` and CSS names.
 * `undefined` is a refusal, never a coerced value.
 */
export function parseColor(input: string): Rgba | undefined {
  const parsed = parse(input);
  if (parsed === undefined) return undefined;

  const rgb = toRgb(parsed);
  if (rgb === undefined) return undefined;

  return {
    r: round(rgb.r * 255),
    g: round(rgb.g * 255),
    b: round(rgb.b * 255),
    a: rgb.alpha ?? 1,
  };
}

/** `#rrggbb` when opaque, `#rrggbbaa` otherwise. */
export function formatColor(rgba: Rgba): string {
  const rgb = {
    mode: "rgb" as const,
    r: clamp(rgba.r / 255),
    g: clamp(rgba.g / 255),
    b: clamp(rgba.b / 255),
    alpha: clamp(rgba.a),
  };
  return rgba.a < 1 ? formatHex8(rgb) : formatHex(rgb);
}

export function toHsv(rgba: Rgba): Hsva {
  const hsv = hsvOf({
    mode: "rgb",
    r: clamp(rgba.r / 255),
    g: clamp(rgba.g / 255),
    b: clamp(rgba.b / 255),
    alpha: clamp(rgba.a),
  });

  // culori omits `h` for a grey, so the finite-hue rule lives here, not at call sites.
  return {
    h: hsv.h !== undefined && Number.isFinite(hsv.h) ? hsv.h : 0,
    s: hsv.s ?? 0,
    v: hsv.v ?? 0,
    a: rgba.a,
  };
}

export function fromHsv(hsva: Hsva): Rgba {
  const rgb = toRgb({
    mode: "hsv",
    h: hsva.h,
    s: clamp(hsva.s),
    v: clamp(hsva.v),
    alpha: clamp(hsva.a),
  });

  return {
    r: round((rgb?.r ?? 0) * 255),
    g: round((rgb?.g ?? 0) * 255),
    b: round((rgb?.b ?? 0) * 255),
    a: hsva.a,
  };
}

function clamp(value: number): number {
  return Math.min(Math.max(value, 0), 1);
}

/** Three decimals keeps float noise out of equality tests without losing a byte. */
function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
