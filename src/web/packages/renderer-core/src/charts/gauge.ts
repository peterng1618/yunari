import type { FabricPalette } from "../theme/fabric-envelope.js";
import type { Fill, GaugeSettings, GradientStop, Sample } from "../types.js";
import { hasPlottableValue } from "../types.js";
import { type EngineAnimation, toEngineAnimation } from "./animation.js";
import { NO_PAINT, resolveChartPaint } from "./chart-paint.js";
import {
  colorAt,
  type EngineColor,
  normalizePosition,
  resolveFlatColor,
} from "./fill.js";
import {
  SEGMENT_GAP_RATIO,
  segmentCount,
  segmentDivisorOf,
} from "./segments.js";

// Preserved public export; implementation moved to fill.ts.
export { mixHex } from "./fill.js";

/**
 * Gauge adapter. ECharts supports arbitrary sweeps, and gauge track/progress
 * paint accepts arc segments, so a gradient follows the ring rather than a
 * cartesian axis.
 */

type ColorSegment = [number, string];

/** Local emitted shape keeps raw ECharts options out of the theme model (§87). */
export interface GaugeOption {
  series: [
    {
      type: "gauge";
      startAngle: number;
      endAngle: number;
      min: number;
      max: number;
      radius: string;
      splitNumber: number;
      axisLine: {
        roundCap: boolean;
        lineStyle: { width: number; color: ColorSegment[] };
      };
      progress: {
        show: boolean;
        width: number;
        roundCap: boolean;
        /** ECharts applies progress colour across the swept arc, so a gradient
         * is expressed as arc segments exactly like the track. */
        itemStyle: { color: EngineColor | ColorSegment[] };
      };
      pointer: { show: false };
      axisTick: { show: false };
      splitLine: { show: false };
      axisLabel: { show: false };
      detail: { show: false };
      data: { value: number }[];
      silent: true;
    } & EngineAnimation,
  ];
}

export function buildGaugeOption(
  settings: GaugeSettings,
  sample: Sample | undefined,
  animate = true,
  palette?: FabricPalette,
): GaugeOption {
  const plottable = hasPlottableValue(sample);
  const track = resolveChartPaint(settings.track, palette);
  const progress = resolveChartPaint(settings.progress, palette);

  // One condition for the whole arc. Missing samples show only the track,
  // never a false zero (§83); a paint that resolves to nothing is the same
  // absence, an arc the author cannot see the value in (0007).
  const arcDrawn = plottable && progress !== undefined;

  // Clamp only the drawn arc; preserve the raw reading elsewhere (§83).
  const displayValue = plottable
    ? clamp(sample.value, settings.min, settings.max)
    : settings.min;

  // A segmented gauge draws the ring as colour bands and leaves `progress` out
  // entirely: two fills over the same arc cannot both own the slices.
  const bands = segmentedBands(
    segmentCount(segmentDivisorOf(settings)),
    plottable && progress !== undefined,
    normalizePosition(displayValue, settings.min, settings.max),
    track,
    progress,
  );

  return {
    series: [
      {
        type: "gauge",
        startAngle: settings.startAngle,
        endAngle: settings.endAngle,
        min: settings.min,
        max: settings.max,
        radius: "100%",
        splitNumber: 1,
        axisLine: {
          roundCap: settings.roundCap,
          lineStyle: {
            width: settings.thickness,
            color: bands ?? toColorSegments(track ?? NO_PAINT, settings),
          },
        },
        progress: {
          show: bands === undefined && arcDrawn,
          width: settings.thickness,
          roundCap: settings.roundCap,
          ...progressItemStyle(progress ?? NO_PAINT, settings, displayValue),
        },
        // Chart typography is rendered by shared text elements (§91).
        pointer: { show: false },
        axisTick: { show: false },
        splitLine: { show: false },
        axisLabel: { show: false },
        detail: { show: false },
        // No arc, no datum. ECharts reads its own previous progress element
        // inside the data-diff update callback and only fills it after a render
        // that drew an arc, so a datum outliving `progress.show: false` throws
        // inside its renderer (0008).
        data: bands === undefined && arcDrawn ? [{ value: displayValue }] : [],
        silent: true,
        ...toEngineAnimation(settings.animation, animate),
      },
    ],
  };
}

/** Convert a fill to ECharts `[proportion, color]` ring segments. */
export function toColorSegments(
  fill: Fill,
  settings: GaugeSettings,
): ColorSegment[] {
  switch (fill.kind) {
    case "solid":
      return [[1, fill.color]];

    case "thresholds":
      return normalizeBands(fill.bands);

    case "gradient":
      return approximateGradient(fill.stops, settings.gradientSegments ?? 64);
  }
}

/**
 * The ring as equal bands with transparent gaps, or `undefined` when the
 * divisor asks for one continuous arc.
 *
 * A band is filled when **its own end** reaches the reading, so a partial band
 * never draws half a slice: the boundary is a slice edge, not a percentage. The
 * reading stays out of the tick list entirely — `progress.show` is false — which
 * is what makes the slices independent of the arc's smooth fill.
 */
function segmentedBands(
  count: number,
  filled: boolean,
  position: number,
  track: Fill | undefined,
  progress: Fill | undefined,
): ColorSegment[] | undefined {
  if (count <= 1) return undefined;

  const bands: ColorSegment[] = [];
  for (let index = 0; index < count; index += 1) {
    const end = (index + 1) / count;
    const midpoint = (index + 0.5) / count;
    const reaches = filled && end - SEGMENT_GAP_RATIO / count <= position;
    const paint = reaches ? progress : track;
    bands.push([
      end - SEGMENT_GAP_RATIO / count,
      bandColor(paint ?? NO_PAINT, reaches, position, midpoint),
    ]);
    // The gap belongs to the slice it follows, so the final band reaches the
    // ring's end rather than trailing an unpainted sliver.
    if (index < count - 1) bands.push([end, "transparent"]);
  }
  return bands;
}

/** One band's flat colour, sampled from a paint the author authored. */
function bandColor(
  paint: Fill,
  filled: boolean,
  position: number,
  midpoint: number,
): string {
  if (paint.kind === "gradient") {
    // The band's midpoint, so a gradient still follows the ring rather than
    // repeating one colour per slice.
    return colorAt(paint.stops, midpoint);
  }
  if (paint.kind === "thresholds") {
    // A filled band answers the reading; an unfilled one is the track, whose
    // colour is the top of its own scale — the backstop behind every value.
    return resolveFlatColor(paint, filled ? position : 1);
  }
  return paint.color;
}

/** ECharts needs ascending, unique segment ends covering the full ring. */
function normalizeBands(bands: readonly GradientStop[]): ColorSegment[] {
  if (bands.length === 0) {
    return [[1, "transparent"]];
  }

  const sorted = [...bands]
    .map((b) => ({ offset: clamp(b.offset, 0, 1), color: b.color }))
    .sort((a, b) => a.offset - b.offset);

  const segments: ColorSegment[] = [];

  for (const band of sorted) {
    const previous = segments.at(-1);
    if (previous && previous[0] === band.offset) {
      previous[1] = band.color;
      continue;
    }
    segments.push([band.offset, band.color]);
  }

  const last = segments.at(-1)!;
  if (last[0] < 1) {
    segments.push([1, last[1]]);
  }

  return segments;
}

/** Approximate an angular gradient with bounded flat-colour segments. */
export function approximateGradient(
  stops: readonly GradientStop[],
  segmentCount: number,
): ColorSegment[] {
  if (stops.length === 0) {
    return [[1, "transparent"]];
  }

  if (stops.length === 1) {
    return [[1, stops[0]!.color]];
  }

  const sorted = [...stops]
    .map((s) => ({ offset: clamp(s.offset, 0, 1), color: s.color }))
    .sort((a, b) => a.offset - b.offset);

  const count = Math.max(2, Math.min(256, Math.floor(segmentCount)));
  const segments: ColorSegment[] = [];

  for (let i = 1; i <= count; i++) {
    const proportion = i / count;
    const midpoint = (i - 0.5) / count;
    segments.push([proportion, colorAt(sorted, midpoint)]);
  }

  return segments;
}

/**
 * Resolve the progress arc separately from the track.
 *
 * A gradient fill is expressed as arc segments, because ECharts applies gauge
 * `progress` colour across the swept arc: a cartesian `to-right` gradient would
 * not follow it. A threshold fill stays a flat colour per current value, which
 * is what a threshold means for a progress arc.
 */
function progressItemStyle(
  fill: Fill,
  settings: GaugeSettings,
  value: number,
): { itemStyle: { color: EngineColor | ColorSegment[] } } {
  if (fill.kind === "gradient") {
    return { itemStyle: { color: toColorSegments(fill, settings) } };
  }

  return {
    itemStyle: {
      color: resolveFlatColor(
        fill,
        normalizePosition(value, settings.min, settings.max),
      ),
    },
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
