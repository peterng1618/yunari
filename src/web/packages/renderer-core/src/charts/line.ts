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
 * Line/area/sparkline adapter. Missing samples are explicit `null` points and
 * `connectNulls` stays false so outages remain visible (§83).
 */

export type Interpolation = "linear" | "step";
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

/** Validated renderer-only delay; samples themselves are never held back. */
export function linePlaybackDelayMs(delayMs: number | undefined): number {
  return typeof delayMs === "number" &&
    Number.isFinite(delayMs) &&
    delayMs > 0 &&
    delayMs <= 5_000
    ? delayMs
    : 0;
}

/**
 * Seconds of history a line must be handed, for the axis this file draws.
 *
 * **The axis window plus one playback delay.** The axis ends at the delayed
 * render clock and begins one window earlier, while `toSeriesPoints` keeps the
 * sample before that start. The source now returns that predecessor itself, so
 * the request is the axis window plus the delay that moves the clock — no
 * second delay to compensate for a missing sample (`vg-571`).
 */
export function lineHistorySeconds(
  windowSeconds: number,
  chartPlaybackDelayMs: number | undefined,
): number {
  return windowSeconds + linePlaybackDelayMs(chartPlaybackDelayMs) / 1000;
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

/** Window, sort and cap samples while preserving missing-data gaps. */
export function toSeriesPoints(
  samples: readonly Sample[],
  settings: Pick<LineSettings, "windowSeconds" | "maxPoints">,
  nowMs: number,
  windowStart = nowMs - settings.windowSeconds * 1000,
): SeriesPoint[] {
  const points: SeriesPoint[] = [];

  const parsed = samples
    .map((sample) => ({ sample, t: sampleTimeMs(sample) }))
    .filter(({ t }) => Number.isFinite(t) && t <= nowMs)
    .sort((a, b) => a.t - b.t);
  const firstVisible = parsed.findIndex(({ t }) => t >= windowStart);
  if (firstVisible < 0) return [];
  const hasPredecessor = firstVisible > 0;

  const first = Math.max(0, firstVisible - 1);
  for (const { sample, t } of parsed.slice(first)) {
    points.push([t, hasPlottableValue(sample) ? sample.value : null]);
  }

  if (points.length > settings.maxPoints) {
    if (!hasPredecessor || settings.maxPoints === 1) {
      return points.slice(-settings.maxPoints);
    }
    return [points[0]!, ...points.slice(-(settings.maxPoints - 1))];
  }

  return points;
}

/**
 * The display's continuity policy for a live line.
 *
 * Between batches the axis clock moves while the newest sample stays where it
 * arrived, so the edge can run past it. Holding the last reading to the edge
 * keeps the line continuous, and it holds for as long as the stall lasts: a
 * gap is more jarring than a flat stretch, and the last reading is still the
 * last thing measured.
 *
 * **A stall that ends must not revise the stretch it painted.** When the next
 * batch arrives after the edge has passed the previous sample, the previous
 * reading is repeated at the new sample's arrival, so the line runs flat to
 * that instant and then changes there — a step for a reading, a break for a
 * reported gap. Everything left of the current edge is then exactly what the
 * previous frame drew. The threshold is the playback delay: the edge can only
 * have passed the sample when the gap is longer than it.
 *
 * **Every gap is decided from the samples, not from the newest pair.** A step
 * that was painted when one stall ended must survive the batches that follow
 * it: re-deciding only the last pair dropped it one batch later and sloped the
 * flat stretch the reader had already seen.
 *
 * A trailing `null` is a reported gap, not a late tick: it is never held
 * forward (§83), but the flat stretch before it is still preserved. A
 * zero-delay source cannot hold or step, because its edge never runs ahead of
 * its data.
 */
export function liveTail(
  points: readonly SeriesPoint[],
  renderNowMs: number,
  delayMs: number,
): readonly SeriesPoint[] {
  const last = points.at(-1);
  if (last === undefined) return points;

  const tail: SeriesPoint[] = [];
  for (const [index, point] of points.entries()) {
    const previous = points[index - 1];
    if (
      delayMs > 0 &&
      previous !== undefined &&
      previous[1] !== null &&
      point[0] - previous[0] > delayMs
    ) {
      tail.push([point[0], previous[1]]);
    }
    tail.push(point);
  }

  if (last[1] === null || delayMs === 0 || renderNowMs <= last[0]) {
    return tail;
  }
  return [...tail, [renderNowMs, last[1]]];
}

export function buildLineOption(
  settings: LineSettings,
  series: readonly SeriesInput[],
  nowMs: number,
  animate = true,
  palette?: FabricPalette,
  chartPlaybackDelayMs?: number,
): LineOption {
  const windowMs = settings.windowSeconds * 1000;
  const delayMs = linePlaybackDelayMs(chartPlaybackDelayMs);
  const renderNowMs = nowMs - delayMs;
  const windowStart = renderNowMs - windowMs;
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
      // Preview history reveals left-to-right; live data fills from render start.
      min: windowStart,
      max: renderNowMs,
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
      data: liveTail(
        toSeriesPoints(input.samples, settings, nowMs, windowStart),
        renderNowMs,
        delayMs,
      ),
      showSymbol: settings.showMarkers,
      symbolSize: settings.markerSize,
      // **Never smoothed.** ECharts draws a smooth segment from the points
      // either side of it, so the stretch a stall holds flat would bend as the
      // edge advances and bend again when the next batch arrives: the history a
      // reader has seen would move. Linear and step segments depend only on
      // their own endpoints, so smoothing is not an authorable choice (0116).
      smooth: false as const,
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

function sampleTimeMs(sample: Sample): number {
  return Date.parse(sample.presentationTimestamp ?? sample.timestamp);
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
  // (0007).
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
