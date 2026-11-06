import {
  artboardGradientLine,
  type BackgroundMask,
  blendRampStops,
  type PalettePaint,
  resolveBackgroundComposition,
} from "@yunari/renderer-core";
import { placement } from "@yunari/scene-fabric";
import type { PanelVideoPlacement } from "./panel-device.js";
import {
  angleFilter,
  flipFilter,
  type PanelVideoRotation,
  turnFilter,
} from "./panel-video-turn.js";

/**
 * The composed background graph both device-played panel families bake.
 *
 * The TURZX and the TUR USB differ in wire geometry and encoder flags, not in
 * what a composition looks like. One graph here keeps the fill, the media
 * region and the eased fade identical on every panel, and lets the caller turn
 * the finished picture onto its own wire frame last.
 */

/** The source-pixel window a panel's box sees, from `scene-fabric`'s placement. */
export interface PanelCrop {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** The source facts a region's cover and a finite output need. */
export interface VideoSourceFacts {
  readonly width: number;
  readonly height: number;
  readonly durationMs?: number;
}

export function panelCrop(
  source: { readonly width: number; readonly height: number },
  offsetX: number,
  offsetY: number,
  box: { readonly width: number; readonly height: number },
  scale?: number,
): PanelCrop {
  const rect = placement({
    box,
    source,
    offsetX: Number.isFinite(offsetX) ? offsetX : 0,
    offsetY: Number.isFinite(offsetY) ? offsetY : 0,
    ...(scale === undefined ? {} : { scale }),
  });

  const scaleX = rect.width / source.width;
  const scaleY = rect.height / source.height;
  const width = Math.max(1, Math.round(box.width / scaleX));
  const height = Math.max(1, Math.round(box.height / scaleY));

  return {
    x: clamp(
      Math.round(-rect.left / scaleX),
      0,
      Math.max(0, source.width - width),
    ),
    y: clamp(
      Math.round(-rect.top / scaleY),
      0,
      Math.max(0, source.height - height),
    ),
    width,
    height,
  };
}

function clamp(value: number, low: number, high: number): number {
  return Math.max(low, Math.min(high, value));
}

/**
 * The composed graph, in `box` and with the turn applied last.
 *
 * The fill covers the whole box; the media is cropped to the region's cover,
 * scaled to the region, masked, and laid over the fill at the region's offset.
 * The resolver's own geometry is used rather than re-deriving the ramp, so the
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
  );
  const region = composition.region;
  const width = Math.max(1, Math.round(region.width));
  const height = Math.max(1, Math.round(region.height));
  const x = Math.max(0, Math.round(region.left));
  const y = Math.max(0, Math.round(region.top));

  const media =
    source === undefined || source.width <= 0 || source.height <= 0
      ? `scale=${width}:${height}:force_original_aspect_ratio=increase:force_divisible_by=2,crop=${width}:${height}`
      : (() => {
          const crop = panelCrop(
            { width: source.width, height: source.height },
            placement.offsetX,
            placement.offsetY,
            { width: region.width, height: region.height },
            placement.scale,
          );
          return `crop=${crop.width}:${crop.height}:${crop.x}:${crop.y},scale=${width}:${height}`;
        })();

  const parts = [
    // The mirror belongs to the media, not the fill behind it, so it is applied
    // before the overlay and before the display's turn.
    `[0:v]${media}${flipFilter(placement)}[media]`,
    `${fillSource(placement.fill, box.width, box.height)}[fill]`,
  ];

  // A centred band has two ramps. `alphamerge` replaces the alpha it is given,
  // so applying them one after another would keep only the last; multiply the
  // grayscale masks first, which is the DOM's `intersect`.
  let overlayInput = "media";
  if (composition.masks.length > 0) {
    for (const [index, mask] of composition.masks.entries()) {
      parts.push(
        `${maskSource(mask, x, y, width, height)}[mask${String(index)}]`,
      );
    }

    // `alphamerge` copies luma into the alpha channel, so merging one mask per
    // source would leave only the last ramp. Multiply the grayscale masks into
    // one first: a centred box fades into the fill on both opposite gaps.
    let maskInput = "mask0";
    for (let index = 1; index < composition.masks.length; index += 1) {
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

  const turnStep =
    rotation.kind === "turn"
      ? turnFilter(rotation.turn)
      : angleFilter(rotation.degrees, box);
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
 * One alpha ramp, sized to the region and shifted by the region's own offset.
 * The stops are the shared eased ramp in grayscale, so the bake draws the same
 * curve as the DOM and the glass instead of a linear ramp with visible ends.
 * The source turns by default, so its first frame is looped still.
 */
function maskSource(
  mask: BackgroundMask,
  x: number,
  y: number,
  width: number,
  height: number,
): string {
  const stops = blendRampStops();
  const colors = stops
    .map((stop, index) => {
      const value = Math.round(stop.alpha * 255)
        .toString(16)
        .padStart(2, "0");
      return `c${String(index)}=0x${value}${value}${value}`;
    })
    .join(":");
  return (
    `gradients=s=${width}x${height}:${colors}:nb_colors=${String(stops.length)}` +
    `:x0=${point(mask.x1 - x, width)}:y0=${point(mask.y1 - y, height)}` +
    `:x1=${point(mask.x2 - x, width)}:y1=${point(mask.y2 - y, height)},${FROZEN}`
  );
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
