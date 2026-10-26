import type { FabricPalette } from "../theme/fabric-envelope.js";
import type { ChartPaint, Fill, Sample } from "../types.js";
import { hasPlottableValue } from "../types.js";
import {
  type AnimationSettings,
  type EngineAnimation,
  toEngineAnimation,
} from "./animation.js";
import { NO_INK, NO_PAINT, resolveChartPaint } from "./chart-paint.js";
import {
  colorAt,
  type EngineColor,
  type GradientDirection,
  normalizePosition,
  resolveFlatColor,
  toLinearGradient,
} from "./fill.js";
import { type CartesianGrid, cartesianGrid } from "./grid.js";
import {
  SEGMENT_GAP_RATIO,
  SEGMENT_SPACING_PERCENT_DEFAULT,
  type SegmentFill,
  segmentCount,
  segmentDivisorOf,
} from "./segments.js";

/**
 * Bar/progress adapter. Thresholds are native per bar; one-category bars with a
 * track are progress bars. Missing samples emit `null`, never zero (§83).
 */

export type BarOrientation = "horizontal" | "vertical";

export interface BarSettings {
  readonly orientation: BarOrientation;
  readonly min: number;
  readonly max: number;
  readonly barWidth?: number;
  /** Gap between category slots, as a percentage. */
  readonly categoryGapPercent: number;
  readonly cornerRadius: number;
  readonly fill: ChartPaint;
  /** Unfilled remainder; present makes this a progress bar. */
  readonly track?: ChartPaint;
  /**
   * The track's own corner radius, independent of the bar's.
   *
   * The two ends of a progress bar are drawn by two different ECharts
   * properties — the bar's `itemStyle.borderRadius`, the track's
   * `backgroundStyle.borderRadius` — so one authorable value each is what makes
   * them independent. Absent means square, as a track has always been.
   */
  readonly trackCornerRadius?: number;
  /** How many slices the fill is cut into; 100 is one continuous bar. */
  readonly segmentDivisor: number;
  /** Gap between slices, as a share of the chart's smaller drawn edge. */
  readonly segmentSpacingPercent?: number;
  /** Whether the reading lights a whole slice or stops at its own value. */
  readonly segmentFill?: SegmentFill;
  readonly showAxes: boolean;
  readonly animation?: AnimationSettings;
}

export const defaultBarSettings: BarSettings = {
  orientation: "horizontal",
  min: 0,
  max: 100,
  barWidth: 14,
  categoryGapPercent: 40,
  cornerRadius: 7,
  fill: { kind: "solid", color: "#00b8d9" },
  track: { kind: "solid", color: "#2a2f3a" },
  // Matches the bar by default, because the two share one slot's geometry — but
  // it is its own value, so a theme can round one and not the other.
  trackCornerRadius: 7,
  segmentDivisor: 100,
  segmentSpacingPercent: SEGMENT_SPACING_PERCENT_DEFAULT,
  // A bar's reading already maps to a distance along it, so stopping the fill
  // where the reading lands is what a bar means; a gauge's reading has no such
  // length and lights its whole slice.
  segmentFill: "partial",
  showAxes: false,
};

/**
 * What both bar families carry for paint and data.
 *
 * A polar bar has no orientation, so the helpers below ask whether one is
 * present rather than forcing a cartesian growth direction onto it (§E1).
 */
export type BarPaintSettings =
  | BarSettings
  | Omit<BarSettings, "orientation" | "segmentDivisor">;

export interface BarInput {
  readonly sensorId: string;
  readonly sample: Sample | undefined;
  readonly label?: string;
}

export interface BarDataItem {
  readonly value: number | null;
  readonly itemStyle: {
    readonly color: EngineColor;
    readonly borderRadius: number;
  };
}

interface CategoryAxis {
  readonly type: "category";
  readonly show: boolean;
  readonly data: readonly string[];
  readonly axisTick: { readonly show: false };
  readonly axisLine: { readonly show: false };
  readonly axisLabel: { readonly show: false };
  readonly boundaryGap: true;
  /** ECharts y categories run bottom-up; invert horizontal bars to authored order. */
  readonly inverse: boolean;
}

interface ValueAxis {
  readonly type: "value";
  readonly show: boolean;
  readonly min: number;
  readonly max: number;
  readonly axisLabel: { readonly show: false };
  readonly splitLine: { readonly show: boolean };
}

export interface ContinuousBarSeries {
  readonly type: "bar";
  readonly data: readonly BarDataItem[];
  readonly barWidth?: number;
  readonly barCategoryGap: string;
  readonly showBackground: boolean;
  readonly backgroundStyle?: {
    readonly color: EngineColor;
    readonly borderRadius?: number;
  };
  readonly silent: true;
}

/** One `[categoryIndex, value]` per binding; `null` draws no fill. */
export type SegmentedBarDatum = readonly [number, number | null];

export interface BarRenderParams {
  readonly dataIndex: number;
}

/** The part of ECharts' render API this renderer uses. */
export interface BarRenderApi {
  coord(point: readonly [number, number]): readonly [number, number];
  size(size: readonly [number, number]): readonly [number, number];
}

export interface BarRect {
  readonly type: "rect";
  /** Which pass drew it; the engine ignores the name, the tests read it. */
  readonly name: "track" | "fill";
  readonly shape: {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
    readonly r?: number;
  };
  readonly style: { readonly fill: string };
  /** The filled rect moves its extent rather than fading in place. */
  readonly transition?: "shape";
  readonly silent: true;
}

export interface BarRectGroup {
  readonly type: "group";
  readonly children: readonly BarRect[];
}

export type BarRenderItem = (
  params: BarRenderParams,
  api: BarRenderApi,
) => BarRectGroup;

export interface SegmentedBarSeries {
  readonly type: "custom";
  readonly coordinateSystem: "cartesian2d";
  readonly data: readonly SegmentedBarDatum[];
  readonly renderItem: BarRenderItem;
  readonly silent: true;
  readonly clip: true;
}

interface BarAxes {
  readonly grid: CartesianGrid;
  readonly xAxis: CategoryAxis | ValueAxis;
  readonly yAxis: CategoryAxis | ValueAxis;
}

export interface ContinuousBarOption extends EngineAnimation, BarAxes {
  readonly series: readonly [ContinuousBarSeries];
}

export interface SegmentedBarOption extends EngineAnimation, BarAxes {
  readonly series: readonly [SegmentedBarSeries];
}

export type BarOption = ContinuousBarOption | SegmentedBarOption;

export function buildBarOption(
  settings: BarSettings,
  inputs: readonly BarInput[],
  animate = true,
  palette?: FabricPalette,
): BarOption {
  const axes = barAxes(settings, inputs);

  if (segmentCount(segmentDivisorOf(settings)) > 1) {
    return buildSegmentedBarOption(settings, inputs, animate, palette, axes);
  }

  return {
    ...toEngineAnimation(settings.animation, animate),
    ...axes,
    series: [
      {
        type: "bar",
        data: inputs.map((input) => toBarDataItem(settings, input, palette)),
        ...(settings.barWidth === undefined
          ? {}
          : { barWidth: settings.barWidth }),
        barCategoryGap: `${clampPercent(settings.categoryGapPercent)}%`,
        showBackground: settings.track !== undefined,
        ...(settings.track === undefined
          ? {}
          : { backgroundStyle: toBackgroundStyle(settings, palette) }),
        silent: true,
      },
    ],
  };
}

function barAxes(settings: BarSettings, inputs: readonly BarInput[]): BarAxes {
  const horizontal = settings.orientation === "horizontal";

  const categoryAxis: CategoryAxis = {
    type: "category",
    show: false,
    data: inputs.map((input) => input.label ?? input.sensorId),
    axisTick: { show: false },
    axisLine: { show: false },
    axisLabel: { show: false },
    boundaryGap: true,
    inverse: horizontal,
  };

  const valueAxis: ValueAxis = {
    type: "value",
    show: settings.showAxes,
    // Keep bar fractions stable instead of auto-rescaling with current data.
    min: settings.min,
    max: settings.max,
    axisLabel: { show: false },
    splitLine: { show: settings.showAxes },
  };

  return {
    grid: cartesianGrid(
      {
        left: settings.showAxes ? 8 : 0,
        right: 0,
        top: 0,
        bottom: settings.showAxes ? 8 : 0,
      },
      false,
    ),
    xAxis: horizontal ? valueAxis : categoryAxis,
    yAxis: horizontal ? categoryAxis : valueAxis,
  };
}

/**
 * The segmented bar as a custom series, because a bar series can draw one rect
 * per category and a segmented fill needs one per band.
 *
 * **Bands are geometry, not data.** The reading still decides how far the fill
 * reaches; the bands only decide where the cuts fall. A partial band is
 * shortened proportionally, so the reading's own fraction survives the cuts
 * rather than snapping to a slice boundary.
 */
export function buildSegmentedBarOption(
  settings: BarSettings,
  inputs: readonly BarInput[],
  animate = true,
  palette?: FabricPalette,
  axes: BarAxes = barAxes(settings, inputs),
): SegmentedBarOption {
  const count = segmentCount(segmentDivisorOf(settings));
  const data: SegmentedBarDatum[] = inputs.map((input, index) => {
    if (!hasPlottableValue(input.sample)) return [index, null];
    // A bar whose paint resolved to nothing carries no value either (0007).
    if (resolveChartPaint(settings.fill, palette) === undefined) {
      return [index, null];
    }
    return [
      index,
      Math.min(Math.max(input.sample.value, settings.min), settings.max),
    ];
  });

  return {
    ...toEngineAnimation(settings.animation, animate),
    ...axes,
    series: [
      {
        type: "custom",
        coordinateSystem: "cartesian2d",
        data,
        renderItem: segmentedRenderItem(
          settings,
          count,
          palette,
          data.map((datum) => datum[1]),
        ),
        silent: true,
        clip: true,
      },
    ],
  };
}

function segmentedRenderItem(
  settings: BarSettings,
  count: number,
  palette: FabricPalette | undefined,
  readings: readonly (number | null)[],
): BarRenderItem {
  const horizontal = settings.orientation === "horizontal";
  const gap = SEGMENT_GAP_RATIO;
  const track =
    settings.track === undefined
      ? undefined
      : resolveChartPaint(settings.track, palette);
  const fill = resolveChartPaint(settings.fill, palette);
  const range = settings.max - settings.min;

  return (params, api) => {
    const index = params.dataIndex;
    const reading = readings[index] ?? null;
    const position =
      reading === null || range === 0 ? 0 : (reading - settings.min) / range;

    const [minX, minY] = api.coord([settings.min, index]);
    const [maxX, maxY] = api.coord([settings.max, index]);
    const sign = horizontal ? Math.sign(maxX - minX) : Math.sign(maxY - minY);
    const span = horizontal ? Math.abs(maxX - minX) : Math.abs(maxY - minY);
    const band = span / count;
    const visible = band * (1 - gap);
    const thickness =
      settings.barWidth ??
      (horizontal ? api.size([0, 1])[1] : api.size([1, 0])[0]) *
        (1 - clampPercent(settings.categoryGapPercent) / 100);
    const centre = horizontal ? minY : minX;

    const rect = (
      name: BarRect["name"],
      from: number,
      length: number,
      color: string,
      radius: number | undefined,
    ): BarRect => {
      // A value axis can run either way in pixels — a vertical bar's grows
      // upward — so the rect is built from the two offsets it actually spans,
      // never from an assumed direction.
      const first = sign * from;
      const second = sign * (from + length);
      const along = Math.min(first, second);
      const extent = Math.abs(second - first);
      return {
        type: "rect",
        name,
        shape: horizontal
          ? {
              x: minX + along,
              y: centre - thickness / 2,
              width: extent,
              height: thickness,
              ...(radius === undefined ? {} : { r: radius }),
            }
          : {
              x: centre - thickness / 2,
              y: minY + along,
              width: thickness,
              height: extent,
              ...(radius === undefined ? {} : { r: radius }),
            },
        style: { fill: color },
        ...(name === "fill" ? { transition: "shape" as const } : {}),
        silent: true,
      };
    };

    const children: BarRect[] = [];
    if (track !== undefined) {
      for (let bandIndex = 0; bandIndex < count; bandIndex += 1) {
        children.push(
          rect(
            "track",
            bandIndex * band,
            visible,
            bandColor(track, (bandIndex + 0.5) / count, 1),
            settings.trackCornerRadius,
          ),
        );
      }
    }
    if (fill !== undefined && reading !== null && position > 0) {
      for (let bandIndex = 0; bandIndex < count; bandIndex += 1) {
        const fraction = Math.min(Math.max(position * count - bandIndex, 0), 1);
        if (fraction === 0) continue;
        children.push(
          rect(
            "fill",
            bandIndex * band,
            visible * fraction,
            bandColor(fill, (bandIndex + 0.5) / count, position),
            settings.cornerRadius,
          ),
        );
      }
    }
    return { type: "group", children };
  };
}

/** One band's colour: a gradient follows the value axis, the rest are flat. */
function bandColor(paint: Fill, midpoint: number, reading: number): string {
  if (paint.kind === "gradient") return colorAt(paint.stops, midpoint);
  return resolveFlatColor(paint, paint.kind === "thresholds" ? reading : 0);
}

/** Missing samples return `null`; a zero-length bar would be indistinguishable from real zero. */
export function toBarDataItem(
  settings: BarPaintSettings,
  input: BarInput,
  palette?: FabricPalette,
): BarDataItem {
  const borderRadius = Math.max(0, settings.cornerRadius);

  if (!hasPlottableValue(input.sample)) {
    return {
      value: null,
      itemStyle: { color: NO_INK, borderRadius },
    };
  }

  const raw = input.sample.value;
  // Clamp only what is drawn; preserve the raw reading elsewhere (§83).
  const display = Math.min(Math.max(raw, settings.min), settings.max);
  const position = normalizePosition(raw, settings.min, settings.max);
  const color = toBarColor(settings, position, palette);

  // A bar whose paint resolved to nothing carries no value either: a bar of
  // transparent ink over a live number is the one rendering that looks like
  // data and is not (0007).
  return {
    value: color === undefined ? null : display,
    itemStyle: { color: color ?? NO_INK, borderRadius },
  };
}

/** Resolve per-bar solid/threshold colour or a cartesian growth-direction gradient. */
export function toBarColor(
  settings: BarPaintSettings,
  position: number,
  palette?: FabricPalette,
): EngineColor | undefined {
  const fill = resolveChartPaint(settings.fill, palette);
  if (fill === undefined) return undefined;
  if (fill.kind === "gradient") {
    return toLinearGradient(fill.stops, gradientDirection(settings));
  }

  return resolveFlatColor(fill, position);
}

/**
 * The track rectangle ECharts draws behind the bar.
 *
 * `backgroundStyle.borderRadius` sets the zrender `Rect`'s own `r`, and that
 * rect *is* the track — the full value-axis span of the slot — so a number
 * rounds the two ends of the progress bar rather than the outside of a larger
 * background.
 */
export function toBackgroundStyle(
  settings: BarPaintSettings,
  palette: FabricPalette | undefined,
): { readonly color: EngineColor; readonly borderRadius?: number } {
  const radius = settings.trackCornerRadius;

  return {
    color: toTrackColor(settings, palette),
    // Absent stays absent: ECharts reads a missing key as no radius, and an
    // authored one is clamped the same way the bar's is.
    ...(radius === undefined ? {} : { borderRadius: Math.max(0, radius) }),
  };
}

/** Track gradients span the whole slot; threshold tracks resolve to their top band. */
function toTrackColor(
  settings: BarPaintSettings,
  palette: FabricPalette | undefined,
): EngineColor {
  const track = settings.track;

  if (track === undefined) {
    return "transparent";
  }

  const resolved = resolveChartPaint(track, palette) ?? NO_PAINT;
  if (resolved.kind === "gradient") {
    return toLinearGradient(resolved.stops, gradientDirection(settings));
  }

  return resolveFlatColor(resolved, 1);
}

/** A cartesian bar reads its orientation; a polar bar grows to the top. */
function gradientDirection(settings: BarPaintSettings): GradientDirection {
  return "orientation" in settings && settings.orientation === "horizontal"
    ? "to-right"
    : "to-top";
}

function clampPercent(value: number): number {
  return Math.min(Math.max(value, 0), 100);
}
