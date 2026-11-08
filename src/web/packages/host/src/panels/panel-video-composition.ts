import {
  artboardGradientLine,
  type BackgroundMask,
  BLEND_RAMP_STOPS,
  backgroundGeometry,
  blendRamp,
  type CompositionRect,
  type PalettePaint,
  resolveBackgroundComposition,
  visibleArea,
} from "@yunari/renderer-core";
import type { PanelVideoPlacement } from "./panel-device.js";
import {
  angleFilter,
  flipFilter,
  type PanelVideoRotation,
  turnFilter,
} from "./panel-video-turn.js";

/**
 * The picture both device-played panel families bake.
 *
 * The TURZX and the TUR USB differ in wire geometry and encoder flags, not in
 * what a composition looks like. One filter here keeps the fill, the media
 * region and the eased fade identical on every panel, and lets the caller turn
 * the finished picture onto its own wire frame last.
 */

/** The source facts a region's cover and a finite output need. */
export interface VideoSourceFacts {
  readonly width: number;
  readonly height: number;
  readonly durationMs?: number;
}

/** One ffmpeg picture, ready to be passed as `-vf` or `-filter_complex`. */
export interface EncodeFilter {
  readonly filter: string;
  readonly complex: boolean;
  /** The composed graph's fill and mask never end, so the output needs the
   *  source's own duration; the plain path takes its length from the input. */
  readonly durationSeconds?: number;
}

/**
 * The filter that puts `source` onto the panel's `box`, already turned.
 *
 * `box` is the layout box the mount asks for (`rotationBox`). Both device
 * families call this, so the panel, the glass and the DOM all read one
 * geometry: the resolver decides the area, the source window and the fill.
 */
export function panelFilter(
  box: { readonly width: number; readonly height: number },
  placement: PanelVideoPlacement,
  source: VideoSourceFacts | undefined,
  rotation: PanelVideoRotation,
): EncodeFilter {
  if (placement.composition !== undefined || placement.fill !== undefined) {
    const seconds = composedSeconds(source);
    return {
      filter: composeFilterGraph(box, placement, source, rotation),
      complex: true,
      ...(seconds === undefined ? {} : { durationSeconds: seconds }),
    };
  }

  const composition = resolveBackgroundComposition(
    box,
    placement.composition,
    source,
    backgroundGeometry(placement),
  );
  const media = composition.media;
  const picture =
    media === undefined
      ? `scale=${box.width}:${box.height}:force_original_aspect_ratio=increase` +
        `:force_divisible_by=2,crop=${box.width}:${box.height}`
      : `crop=${media.crop.width}:${media.crop.height}:${media.crop.x}:${media.crop.y}` +
        `,scale=${box.width}:${box.height}:force_divisible_by=2`;

  return {
    // `setsar=1` pins the output to square pixels: `scale` keeps the source's
    // display aspect and would otherwise hand a non-square sample aspect on.
    filter: `${picture},setsar=1${flipFilter(placement)}${turnOf(rotation, box)}`,
    complex: false,
  };
}

/** The display's turn, as the fragment that composes it onto the wire frame. */
function turnOf(
  rotation: PanelVideoRotation,
  box: { readonly width: number; readonly height: number },
): string {
  return rotation.kind === "turn"
    ? turnFilter(rotation.turn)
    : angleFilter(rotation.degrees, box);
}

/**
 * The composed graph, in `box` and with the turn applied last.
 *
 * The fill covers the whole box; the media's source window fills the area the
 * box lets through, is masked, and is laid over the fill where it sits. The
 * resolver's own geometry is used rather than re-deriving the ramp, so the
 * device and the page describe one picture.
 */
export function composeFilterGraph(
  box: { readonly width: number; readonly height: number },
  placement: PanelVideoPlacement,
  source: VideoSourceFacts | undefined,
  rotation: PanelVideoRotation,
): string {
  const composition = resolveBackgroundComposition(
    box,
    placement.composition,
    source,
    backgroundGeometry(placement),
  );
  const media = composition.media;
  const dest: CompositionRect =
    media?.dest ?? visibleArea(composition.region, box);
  const width = Math.max(1, Math.round(dest.width));
  const height = Math.max(1, Math.round(dest.height));
  const x = Math.round(dest.left);
  const y = Math.round(dest.top);

  const picture =
    media === undefined
      ? `scale=${width}:${height}:force_original_aspect_ratio=increase:force_divisible_by=2,crop=${width}:${height}`
      : `crop=${media.crop.width}:${media.crop.height}:${media.crop.x}:${media.crop.y},scale=${width}:${height}:force_divisible_by=2`;

  const parts = [
    // The mirror belongs to the media, not the fill behind it, so it is applied
    // before the overlay and before the display's turn.
    `[0:v]${picture},setsar=1${flipFilter(placement)}[media]`,
    `${fillSource(placement.fill, box.width, box.height)}[fill]`,
  ];

  // A centred band has two ramps. `alphamerge` replaces the alpha it is given,
  // so applying them one after another would keep only the last; multiply the
  // grayscale masks first, which is the DOM's `intersect`.
  let overlayInput = "media";
  // A ramp the box cannot see fades nothing the box shows, so it is dropped
  // before it can become a zero-length gradient.
  const masks = composition.masks
    .map((mask) => maskSource(mask, x, y, width, height))
    .filter((source): source is string => source !== undefined);
  if (masks.length > 0) {
    for (const [index, mask] of masks.entries()) {
      parts.push(`${mask}[mask${String(index)}]`);
    }

    // `alphamerge` copies luma into the alpha channel, so merging one mask per
    // source would leave only the last ramp. Multiply the grayscale masks into
    // one first: a centred box fades into the fill on both opposite gaps.
    let maskInput = "mask0";
    for (let index = 1; index < masks.length; index += 1) {
      const combined = `masks${String(index)}`;
      parts.push(
        `[${maskInput}][mask${String(index)}]blend=all_mode=multiply[${combined}]`,
      );
      maskInput = combined;
    }

    parts.push(
      // The mask never ends; the source does. Without `shortest` the merge
      // repeats the last frame forever and only `-t` stops the encode.
      `[${overlayInput}][${maskInput}]alphamerge=shortest=1[composed]`,
    );
    overlayInput = "composed";
  }

  const turnStep = turnOf(rotation, box);
  parts.push(
    `[fill][${overlayInput}]overlay=x=${x}:y=${y}:shortest=1[turned]`,
    `[turned]${turnStep === "" ? "null" : turnStep.slice(1)}[out]`,
  );
  return parts.join(";");
}

/**
 * A solid or linear-gradient source covering the whole box.
 *
 * **The ramp is computed per pixel, not by `gradients`.** That source spaces
 * its colours evenly and accepts at most eight, so authored stop offsets and
 * the alpha ramp of a scrim came out as different bands and a different fade.
 * `geq` can read the authored stops directly, which makes the baked fill the
 * one the page draws.
 */
function fillSource(
  fill: PalettePaint | undefined,
  width: number,
  height: number,
): string {
  if (fill === undefined) return `color=c=0x000000:s=${width}x${height}`;
  if (fill.kind === "solid")
    return `color=c=${ffmpegColor(fill.color)}:s=${width}x${height}`;
  return gradientSource(fill, width, height);
}

interface GradientStop {
  readonly offset: number;
  readonly rgb: readonly [number, number, number];
  readonly alpha: number;
}

/** `#rgb`, `#rrggbb` and `#rrggbbaa` are the forms the editor writes. */
function stopOf(stop: {
  readonly offset: number;
  readonly color: string;
}): GradientStop | undefined {
  const hex = stop.color.startsWith("#") ? stop.color.slice(1) : undefined;
  const expanded =
    hex?.length === 3
      ? [...hex].map((digit) => `${digit}${digit}`).join("")
      : hex;
  if (
    expanded === undefined ||
    !(expanded.length === 6 || expanded.length === 8) ||
    !/^[0-9a-fA-F]+$/.test(expanded)
  )
    return undefined;

  const value = (from: number): number =>
    Number.parseInt(expanded.slice(from, from + 2), 16) / 255;
  return {
    offset: Math.min(1, Math.max(0, stop.offset)),
    rgb: [value(0), value(2), value(4)],
    alpha: expanded.length === 8 ? value(6) : 1,
  };
}

function gradientSource(
  fill: {
    readonly angle: number;
    readonly stops: readonly {
      readonly offset: number;
      readonly color: string;
    }[];
  },
  width: number,
  height: number,
): string {
  const stops = fill.stops
    .map(stopOf)
    .filter((stop): stop is GradientStop => stop !== undefined)
    .sort((first, second) => first.offset - second.offset);

  if (stops.length === 0) return `color=c=0x000000:s=${width}x${height}`;
  if (stops.length === 1)
    return `color=c=${ffmpegColor(fill.stops[0]!.color)}:s=${width}x${height}`;

  const line = artboardGradientLine(fill, width, height);
  const dx = line.x2 - line.x1;
  const dy = line.y2 - line.y1;
  const length = dx * dx + dy * dy;
  const position =
    Number.isFinite(length) && length > 0
      ? `clip(((X-${number(line.x1)})*${number(dx)}+(Y-${number(line.y1)})*${number(dy)})/${number(length)},0,1)`
      : "0";

  const alpha = piecewise(stops, position, (stop) => stop.alpha);
  // CSS and the canvas interpolate a gradient in premultiplied alpha; doing the
  // same keeps a translucent stop from pulling its neighbours toward black.
  const channel = (index: 0 | 1 | 2): string =>
    piecewise(stops, position, (stop) => stop.rgb[index] * stop.alpha, alpha);

  return (
    `color=c=black@0.0:s=${width}x${height},format=rgba,` +
    `geq=r='255*${channel(0)}':g='255*${channel(1)}':b='255*${channel(2)}':a='255*${alpha}'`
  );
}

/**
 * The stops as one nested ffmpeg expression over `position`, clamped at both
 * ends.
 *
 * `value` is interpolated straight between neighbouring stops. When `divisor`
 * is given the interpolated value is premultiplied colour, divided by the
 * interpolated alpha it was weighted by; the alpha channel passes no divisor.
 */
function piecewise(
  stops: readonly GradientStop[],
  position: string,
  value: (stop: GradientStop) => number,
  divisor?: string,
): string {
  const lerp = (first: GradientStop, second: GradientStop): string => {
    const span = second.offset - first.offset;
    const ratio =
      span > 0
        ? `clip((${position}-${number(first.offset)})/${number(span)},0,1)`
        : "1";
    const from = value(first);
    const to = value(second);
    const mixed = `${number(from)}+(${number(to)}-${number(from)})*${ratio}`;
    if (divisor === undefined) return `(${mixed})`;
    return `if(gt(${divisor},0),(${mixed})/(${divisor}),0)`;
  };

  let expression = number(value(stops[stops.length - 1]!));
  for (let index = stops.length - 2; index >= 0; index -= 1) {
    const first = stops[index]!;
    const second = stops[index + 1]!;
    expression = `if(lt(${position},${number(second.offset)}),${lerp(first, second)},${expression})`;
  }
  return expression;
}

/** A finite number as an ffmpeg expression literal. */
function number(value: number): string {
  return Number.isFinite(value)
    ? String(Math.round(value * 10000) / 10000)
    : "0";
}

function ffmpegColor(color: string): string {
  return color.startsWith("#") ? `0x${color.slice(1)}` : color;
}

/**
 * One alpha ramp, in the frame the media is laid in, or nothing when the box
 * cannot see the ramp at all.
 *
 * The ramp belongs to the media's area, whose edges may lie outside the box. A
 * ramp that lies wholly outside fades nothing the box shows, and ffmpeg draws a
 * zero-length gradient as black — `alphamerge` then erases the picture instead
 * of fading it. A ramp the box cuts keeps the alpha its visible end already
 * needs, so the baked fade is the one the page draws. The stops are the shared
 * eased ramp in grayscale. The source turns by default, so it is held still.
 */
function maskSource(
  mask: BackgroundMask,
  x: number,
  y: number,
  width: number,
  height: number,
): string | undefined {
  const vertical = mask.x1 === mask.x2;
  const size = vertical ? height : width;
  const from = (vertical ? mask.y1 : mask.x1) - (vertical ? y : x);
  const to = (vertical ? mask.y2 : mask.x2) - (vertical ? y : x);
  const ramp = visibleRamp(from, to, size);
  if (ramp === undefined) return undefined;

  const colors = Array.from({ length: BLEND_RAMP_STOPS }, (_, index) => {
    const fraction =
      ramp.t0 + ((ramp.t1 - ramp.t0) * index) / (BLEND_RAMP_STOPS - 1);
    const value = Math.round(blendRamp(fraction) * 255)
      .toString(16)
      .padStart(2, "0");
    return `c${String(index)}=0x${value}${value}${value}`;
  }).join(":");
  const head = `gradients=s=${width}x${height}:${colors}:nb_colors=${String(
    BLEND_RAMP_STOPS,
  )}`;
  const across = point(
    vertical ? mask.x1 - x : mask.y1 - y,
    vertical ? width : height,
  );
  const start = point(ramp.start, size);
  const end = point(ramp.end, size);

  return vertical
    ? `${head}:x0=${across}:y0=${start}:x1=${across}:y1=${end},${FROZEN}`
    : `${head}:x0=${start}:y0=${across}:x1=${end}:y1=${across},${FROZEN}`;
}

/** The part of a ramp that lies inside a frame, with the ramp fraction it
 *  covers. The frame is read as `0..size` here: a ramp that ends on the far
 *  edge spans the whole curve, and only its emitted coordinate is pulled inside
 *  the pixel grid (`point`). */
function visibleRamp(
  from: number,
  to: number,
  size: number,
):
  | {
      readonly start: number;
      readonly end: number;
      readonly t0: number;
      readonly t1: number;
    }
  | undefined {
  const span = to - from;
  if (size <= 0 || Math.abs(span) < 1e-9) return undefined;
  const at = (value: number): number => (value - from) / span;
  const t0 = span > 0 ? Math.max(0, at(0)) : Math.max(0, at(size));
  const t1 = span > 0 ? Math.min(1, at(size)) : Math.min(1, at(0));
  if (!(t1 > t0)) return undefined;
  return { start: from + span * t0, end: from + span * t1, t0, t1 };
}

/**
 * A gradient line endpoint inside the source.
 *
 * **ffmpeg's `gradients` reads the line as coordinates, not fractions.** An
 * endpoint exactly on the far edge (`width` or `height`) is outside the frame,
 * and the source then paints the whole ramp wrong — the eased mask's own start
 * sits on the media's edge, which showed fill where the picture should be.
 */
function point(value: number, size: number): number {
  return Math.min(size - 1, Math.max(0, Math.round(value)));
}

/** Holds a generated source on its first frame; `gradients` animates by
 *  default and accepts no zero speed. */
const FROZEN = "loop=loop=-1:size=1:start=0";

/** A clip length the caller can bound a never-ending fill source with. */
export function composedSeconds(
  source: VideoSourceFacts | undefined,
): number | undefined {
  if (
    source === undefined ||
    !(source.durationMs !== undefined && source.durationMs > 0)
  )
    return undefined;
  return source.durationMs / 1000;
}
