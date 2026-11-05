import {
  artboardGradientLine,
  type BackgroundMask,
  blendRampStops,
  type PalettePaint,
  resolveBackgroundComposition,
} from "@yunari/renderer-core";
import { placement } from "@yunari/scene-fabric";
import type { PanelVideoPlacement } from "./panel-device.js";
import { type PanelVideoTurn, turnFilter } from "./panel-video-turn.js";

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
  turn: PanelVideoTurn,
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
    `[0:v]${media}[media]`,
    `${fillSource(placement.fill, box.width, box.height)}[fill]`,
  ];

  // A centred band has two ramps. `alphamerge` replaces the alpha it is given,
  // so applying them one after another would keep only the last; multiply the
  // grayscale masks first, which is the DOM's `intersect`.
  let overlayInput = "media";
  if (composition.masks.length > 0) {
    const labels = composition.masks.map((mask, index) => {
      const label = `mask${String(index)}`;
      parts.push(`${maskSource(mask, x, y, width, height)}[${label}]`);
      return label;
    });
    let combined = labels[0]!;
    for (const [index, label] of labels.slice(1).entries()) {
      const next = `mask${String(index + 1)}x`;
      parts.push(`[${combined}][${label}]blend=all_mode=multiply[${next}]`);
      combined = next;
    }
    // The mask never ends; the source does. Without `shortest` the merge
    // repeats the last frame forever and only `-t` stops the encode.
    parts.push(`[media][${combined}]alphamerge=shortest=1[composed]`);
    overlayInput = "composed";
  }

  const turnStep = turnFilter(turn);
  parts.push(
    `[fill][${overlayInput}]overlay=x=${x}:y=${y}:shortest=1[turned]`,
    `[turned]${turnStep === "" ? "null" : turnStep.slice(1)}[out]`,
  );
  return parts.join(";");
}

/**
 * A solid or linear-gradient source covering the whole box.
 *
 * **`gradients` is an animated source.** It turns by default (`speed=0.01`), so
 * an authored fill visibly rotates like a clock hand. Zero is outside the
 * option's accepted range and even the smallest accepted speed still moves, so
 * the first frame is looped instead: the baked picture is the gradient the page
 * shows, held for the clip's whole length.
 */
function fillSource(
  fill: PalettePaint | undefined,
  width: number,
  height: number,
): string {
  if (fill === undefined) return `color=c=0x000000:s=${width}x${height}`;
  if (fill.kind === "solid")
    return `color=c=${ffmpegColor(fill.color)}:s=${width}x${height}`;

  const colors = gradientColors(fill.stops);
  const line = artboardGradientLine(fill, width, height);
  const stops = colors
    .map((color, index) => `c${String(index)}=${color}`)
    .join(":");
  return (
    `gradients=s=${width}x${height}:${stops}:nb_colors=${colors.length}` +
    `:x0=${point(line.x1, width)}:y0=${point(line.y1, height)}` +
    `:x1=${point(line.x2, width)}:y1=${point(line.y2, height)},${FROZEN}`
  );
}

/**
 * ffmpeg's `gradients` spaces its colours evenly and holds at most eight. A
 * longer authored ramp is sampled at eight even positions; a palette gradient
 * with more stops than that is rare and the shape is kept.
 */
function gradientColors(
  stops: readonly { readonly offset: number; readonly color: string }[],
): readonly string[] {
  const ordered = [...stops].sort((a, b) => a.offset - b.offset);
  if (ordered.length <= 8)
    return ordered.map((stop) => ffmpegColor(stop.color));
  return Array.from({ length: 8 }, (_, index) =>
    ffmpegColor(ordered[Math.round((index * (ordered.length - 1)) / 7)]!.color),
  );
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
