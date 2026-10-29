import type { FabricPalette } from "../theme/fabric-envelope.js";
import type { ChartPaint, Fill, Sample } from "../types.js";
import { hasPlottableValue } from "../types.js";
import {
  type AnimationSettings,
  type EngineAnimation,
  toEngineAnimation,
} from "./animation.js";
import { NO_INK, resolveChartPaint } from "./chart-paint.js";
import type { EngineColor, LinearGradientColor } from "./fill.js";
import { clamp01, resolveThresholdColor, toLinearGradient } from "./fill.js";
import { type CartesianGrid, cartesianGrid } from "./grid.js";

// Preserved public exports; implementation moved to fill.ts.
export type { EngineColor, LinearGradientColor };

/**
 * Line/area/sparkline adapter. A missing reading is skipped and the readings
 * either side are joined, so a line has no break and no blank edge — the
 * line-only exception to §83. A missing reading is still never zero.
 */

export type Interpolation = "linear" | "step" | "smooth";
type DashPattern = "solid" | "dashed" | "dotted";
export type SeriesPoint = readonly [number, number | null];

export interface LineSettings {
  readonly lineWidth: number;
  readonly interpolation: Interpolation;
  /** First-series stroke and palette fallback. */
  readonly stroke: ChartPaint;
  /** Per-series strokes, cycled by index. */
  readonly palette?: readonly ChartPaint[];
  readonly dash?: DashPattern;
  /** Independent area fill; omit for a plain line. */
  readonly area?: ChartPaint;
  readonly showMarkers: boolean;
  readonly markerSize: number;
  readonly windowSeconds: number;
  /** Hard point cap; oldest points are dropped without interpolation (§122). */
  readonly maxPoints: number;
  readonly min?: number;
  readonly max?: number;
  readonly showAxes: boolean;
  /** Render-time downsampling; retained samples are unchanged. */
  readonly sampling?: "lttb" | "average" | "none";
  readonly animation?: AnimationSettings;
}

export const defaultLineSettings: LineSettings = {
  lineWidth: 2,
  interpolation: "linear",
  stroke: { kind: "solid", color: "#00b8d9" },
  area: {
    kind: "gradient",
    stops: [
      { offset: 0, color: "#00b8d9" },
      { offset: 1, color: "#00b8d900" },
    ],
  },
  showMarkers: false,
  markerSize: 4,
  windowSeconds: 60,
  maxPoints: 600,
  showAxes: true,
  sampling: "none",
};

export interface SeriesInput {
  readonly sensorId: string;
  readonly samples: readonly Sample[];
  readonly label?: string;
}

/** Local emitted shape keeps raw engine options out of the theme model (§87). */
export interface LineOption extends EngineAnimation {
  readonly grid: CartesianGrid;
  readonly xAxis: {
    readonly type: "time";
    readonly show: boolean;
    readonly axisLabel: { readonly show: false };
    readonly min: number;
    readonly max: number;
  };
  readonly yAxis: {
    readonly type: "value";
    readonly show: boolean;
    readonly axisLabel: { readonly show: false };
    readonly min?: number;
    readonly max?: number;
  };
  readonly series: readonly {
    readonly type: "line";
    readonly name: string;
    readonly data: readonly SeriesPoint[];
    readonly showSymbol: boolean;
    readonly symbolSize: number;
    readonly smooth: boolean;
    readonly step: "end" | false;
    readonly connectNulls: false;
    readonly lineStyle: {
      readonly width: number;
      /** Absent when `visualMap` colours the segments per value (§85). */
      readonly color?: EngineColor;
      readonly type: DashPattern;
    };
    readonly areaStyle?: { readonly color: EngineColor };
    readonly sampling?: "lttb" | "average";
    readonly silent: true;
  }[];
  /**
   * Per-value line colouring for a threshold stroke. Emitted only when the
   * settings declare the range the authored fractions map onto (§85).
   */
  readonly visualMap?: {
    readonly show: false;
    readonly type: "piecewise";
    readonly dimension: 1;
    readonly seriesIndex: 0;
    readonly pieces: readonly {
      readonly min: number;
      readonly max: number;
      readonly color: string;
    }[];
  };
}

/**
 * Window, sort and cap a series' readings.
 *
 * A reading that is not `ok` and numeric is skipped, not carried as `null`: the
 * line joins the readings either side and has no break (§83 line exception).
 * The axis window is `[windowStart, endMs]`, and the sample just before
 * it is kept so the line reaches its left edge (`vg-571`).
 */
export function toSeriesPoints(
  samples: readonly Sample[],
  settings: Pick<LineSettings, "windowSeconds" | "maxPoints">,
  endMs: number,
  windowStart = endMs - settings.windowSeconds * 1000,
): SeriesPoint[] {
  const parsed = samples
    .filter(hasPlottableValue)
    .map((sample) => ({ sample, t: sampleTimeMs(sample) }))
    .filter(({ t }) => Number.isFinite(t) && t <= endMs)
    .sort((a, b) => a.t - b.t);

  const firstVisible = parsed.findIndex(({ t }) => t >= windowStart);
  if (firstVisible < 0) return [];

  const first = Math.max(0, firstVisible - 1);
  const points: SeriesPoint[] = parsed
    .slice(first)
    .map(({ sample, t }) => [t, sample.value]);

  if (points.length > settings.maxPoints) {
    if (first === 0 || settings.maxPoints === 1) {
      return points.slice(-settings.maxPoints);
    }
    return [points[0]!, ...points.slice(-(settings.maxPoints - 1))];
  }

  return points;
}

/** The newest plottable reading across a chart's series, if any. */
export function lineEndMs(series: readonly SeriesInput[]): number | undefined {
  let end: number | undefined;

  for (const input of series) {
    for (const sample of input.samples) {
      if (!hasPlottableValue(sample)) continue;
      const t = sampleTimeMs(sample);
      if (Number.isFinite(t) && (end === undefined || t > end)) end = t;
    }
  }

  return end;
}

/**
 * Draw a line with its axis placed by its data.
 *
 * **The axis ends at the newest reading, not at the clock.** Between batches
 * nothing moves; when a batch lands the whole picture shifts left by the gap it
 * covers. That is what makes the right edge exact at every refresh rate and
 * whenever a batch is late or dropped — the old wall clock needed a playback
 * delay larger than the worst gap, and no layer declares that gap.
 *
 * `nowMs` is only the empty-chart fallback: a line with no plottable reading
 * has no data clock to follow.
 */
export function buildLineOption(
  settings: LineSettings,
  series: readonly SeriesInput[],
  nowMs: number,
  animate = true,
  palette?: FabricPalette,
): LineOption {
  const windowMs = settings.windowSeconds * 1000;
  const endMs = lineEndMs(series) ?? nowMs;
  const windowStart = endMs - windowMs;
  const sampling =
    settings.sampling && settings.sampling !== "none"
      ? settings.sampling
      : undefined;
  // A threshold first-series stroke colours line segments by value, which one
  // `lineStyle` colour cannot express; `visualMap` is the engine's mechanism
  // for it. Absent an authored range there is no honest mapping (§85).
  const threshold = thresholdBands(strokeFor(settings, 0), palette, settings);
  return {
    ...toEngineAnimation(settings.animation, animate),
    ...(threshold === undefined
      ? {}
      : {
          visualMap: {
            show: false,
            type: "piecewise" as const,
            dimension: 1,
            seriesIndex: 0,
            pieces: threshold.map((band) => ({
              min: band.min,
              max: band.max,
              color: band.color,
            })),
          },
        }),
    grid: cartesianGrid(
      {
        left: settings.showAxes ? 8 : 0,
        right: settings.showAxes ? 8 : 0,
        top: 8,
        bottom: settings.showAxes ? 8 : 0,
      },
      false,
    ),
    xAxis: {
      type: "time",
      show: settings.showAxes,
      axisLabel: { show: false },
      // The window is placed behind the newest reading, so its right end is
      // always painted.
      min: windowStart,
      max: endMs,
    },
    yAxis: {
      type: "value",
      show: settings.showAxes,
      axisLabel: { show: false },
      ...(settings.min === undefined ? {} : { min: settings.min }),
      ...(settings.max === undefined ? {} : { max: settings.max }),
    },
    series: series.map((input, index) => ({
      type: "line" as const,
      name: input.label ?? input.sensorId,
      data: toSeriesPoints(input.samples, settings, endMs, windowStart),
      showSymbol: settings.showMarkers,
      symbolSize: settings.markerSize,
      // **Smoothing is authored, never implied.** ECharts draws a smooth
      // segment from the points either side of it, so a sample bends its
      // neighbour segments once; with the data clock nothing is held at
      // an advancing edge, so that is the only reshape. Linear and step
      // depend only on their own endpoints.
      smooth: settings.interpolation === "smooth",
      step:
        settings.interpolation === "step" ? ("end" as const) : (false as const),
      connectNulls: false as const,
      lineStyle: {
        width: settings.lineWidth,
        // A threshold stroke is per-segment, so `visualMap` owns its colour.
        ...(thresholdBands(strokeFor(settings, index), palette, settings) ===
        undefined
          ? {
              color: toEngineColor(
                resolveChartPaint(strokeFor(settings, index), palette),
                "stroke",
              ),
            }
          : {}),
        type: settings.dash ?? "solid",
      },
      // Area fill is intentionally limited to the first series for readability.
      ...(settings.area === undefined || index > 0
        ? {}
        : {
            areaStyle: {
              color: toEngineColor(
                resolveChartPaint(settings.area, palette),
                "area",
              ),
            },
          }),
      ...(sampling === undefined ? {} : { sampling }),
      silent: true as const,
    })),
  };
}

/**
 * A threshold stroke as `visualMap` value bands, or undefined when it cannot be
 * expressed. Authored offsets are 0–1 fractions of a range, while `visualMap`
 * pieces are values, so the mapping needs an authored `min`/`max`; without one
 * there is no honest mapping to the visible axis, and the stroke stays a single
 * colour (§85).
 */
function thresholdBands(
  paint: ChartPaint,
  palette: FabricPalette | undefined,
  range: { readonly min?: number; readonly max?: number },
): readonly { min: number; max: number; color: string }[] | undefined {
  if (range.min === undefined || range.max === undefined) {
    return undefined;
  }

  const span = range.max - range.min;
  if (!(span > 0)) {
    return undefined;
  }

  const fill = resolveChartPaint(paint, palette);
  if (
    fill === undefined ||
    fill.kind !== "thresholds" ||
    fill.bands.length === 0
  ) {
    return undefined;
  }

  const sorted = [...fill.bands].sort((a, b) => a.offset - b.offset);
  const valueAt = (offset: number): number =>
    range.min! + clamp01(offset) * span;

  // `resolveThresholdColor` picks the first band whose offset reaches the value,
  // so each piece runs from the previous boundary up to its own. The first is
  // open below and the last open above, covering the whole axis.
  return sorted.map((band, index) => ({
    min: index === 0 ? -Infinity : valueAt(sorted[index - 1]!.offset),
    max: index === sorted.length - 1 ? Infinity : valueAt(band.offset),
    color: band.color,
  }));
}

/**
 * The reading's own clock, not the browser's receive time.
 *
 * A queued batch can be delivered minutes after it was sampled; placing it by
 * its arrival would collapse every reading in the burst onto one x. A constant
 * skew between the host's clock and the display's cancels, because the axis is
 * anchored to the same samples.
 */
function sampleTimeMs(sample: Sample): number {
  return Date.parse(sample.timestamp);
}

/** Palette entry for one series, falling back to `stroke`. */
function strokeFor(settings: LineSettings, index: number): ChartPaint {
  const palette = settings.palette;

  if (palette === undefined || palette.length === 0) {
    return settings.stroke;
  }

  return palette[index % palette.length] ?? settings.stroke;
}

/**
 * Convert a fill to one line/area engine colour. Per-value threshold colouring
 * is unavailable for one line series, so thresholds resolve to the top band (§85).
 */
export function toEngineColor(
  fill: Fill | undefined,
  usage: "stroke" | "area",
): EngineColor {
  // A stroke that resolves to nothing draws no ink, so the series shows no
  // number it cannot colour; the points and axes still say a series is there
  //.
  if (fill === undefined) return NO_INK;
  switch (fill.kind) {
    case "solid":
      return fill.color;

    case "gradient":
      return toLinearGradient(
        fill.stops,
        usage === "area" ? "to-bottom" : "to-right",
      );

    case "thresholds":
      return resolveThresholdColor(fill.bands, 1);
  }
}
