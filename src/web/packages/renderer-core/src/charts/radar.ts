import type { FabricPalette } from "../theme/fabric-envelope.js";
import type { Sample } from "../types.js";
import { hasPlottableValue } from "../types.js";
import {
  type AnimationSettings,
  type EngineAnimation,
  toEngineAnimation,
} from "./animation.js";
import { type ChartPaint, NO_INK, resolveChartPaint } from "./chart-paint.js";
import { type EngineColor, resolveFlatColor } from "./fill.js";

/**
 * Radar adapter. One polygon over the bound latest readings on one shared
 * scale: with a single data item ECharts would scale every spoke to full, so
 * the settings' `min`/`max` is the only honest geometry (§D2).
 */

export type RadarShape = "polygon" | "circle";

export interface RadarSettings {
  readonly min: number;
  readonly max: number;
  readonly shape: RadarShape;
  readonly splitNumber: number;
  readonly lineWidth: number;
  readonly showMarkers: boolean;
  readonly markerSize: number;
  readonly showAxes: boolean;
  readonly stroke: ChartPaint;
  readonly area?: ChartPaint;
  readonly animation?: AnimationSettings;
}

export const defaultRadarSettings: RadarSettings = {
  min: 0,
  max: 100,
  shape: "polygon",
  splitNumber: 4,
  lineWidth: 2,
  showMarkers: true,
  markerSize: 4,
  showAxes: true,
  stroke: { kind: "solid", color: "#00b8d9" },
};

export interface RadarInput {
  readonly sensorId: string;
  readonly sample: Sample | undefined;
}

/** Local emitted shape keeps raw engine options out of the theme model (§87). */
export interface RadarOption extends EngineAnimation {
  readonly radar: {
    readonly shape: RadarShape;
    readonly indicator: readonly { name: string; min: number; max: number }[];
    readonly splitNumber: number;
    readonly axisName: { readonly show: false };
    readonly axisLine: { readonly show: boolean };
    readonly splitLine: { readonly show: boolean };
    readonly splitArea: { readonly show: boolean };
  };
  readonly series: readonly {
    readonly type: "radar";
    readonly data: readonly { value: number[] }[];
    readonly symbol: "circle" | "none";
    readonly symbolSize: number;
    readonly lineStyle: { readonly width: number; readonly color: EngineColor };
    readonly areaStyle?: { readonly color: EngineColor };
    readonly silent: true;
  }[];
}

/**
 * A polygon needs three spokes and every reading: with fewer, or with one gap,
 * the frame is drawn and the polygon is not. A missing reading is never drawn
 * as zero (§D1, §D3).
 */
export function buildRadarOption(
  settings: RadarSettings,
  inputs: readonly RadarInput[],
  animate = true,
  palette?: FabricPalette,
): RadarOption {
  const stroke = resolveChartPaint(settings.stroke, palette);
  const area =
    settings.area === undefined
      ? undefined
      : resolveChartPaint(settings.area, palette);
  const values = inputs.map((input) => input.sample);
  const drawable =
    stroke !== undefined &&
    inputs.length >= 3 &&
    values.every((sample) => sample !== undefined && hasPlottableValue(sample));

  return {
    ...toEngineAnimation(settings.animation, animate),
    radar: {
      shape: settings.shape,
      indicator: inputs.map((input) => ({
        name: input.sensorId,
        min: settings.min,
        max: settings.max,
      })),
      splitNumber: settings.splitNumber,
      // No engine text: a caption is a text object (Design C).
      axisName: { show: false },
      axisLine: { show: settings.showAxes },
      splitLine: { show: settings.showAxes },
      splitArea: { show: settings.showAxes },
    },
    series: [
      {
        type: "radar" as const,
        data: drawable
          ? [{ value: values.map((sample) => clamp(sample!.value, settings)) }]
          : [],
        symbol: settings.showMarkers ? ("circle" as const) : ("none" as const),
        symbolSize: settings.markerSize,
        lineStyle: {
          width: settings.lineWidth,
          color: stroke === undefined ? NO_INK : resolveFlatColor(stroke, 1),
        },
        ...(area === undefined
          ? {}
          : { areaStyle: { color: resolveFlatColor(area, 1) } }),
        silent: true as const,
      },
    ],
  };
}

function clamp(
  value: number,
  range: { readonly min: number; readonly max: number },
): number {
  return Math.min(range.max, Math.max(range.min, value));
}
