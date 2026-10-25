import type { FabricPalette } from "../theme/fabric-envelope.js";
import { type EngineAnimation, toEngineAnimation } from "./animation.js";
import {
  type BarInput,
  type BarPaintSettings,
  type BarSettings,
  defaultBarSettings,
  toBackgroundStyle,
  toBarDataItem,
} from "./bar.js";
import type { EngineColor } from "./fill.js";

/**
 * Polar bar adapter. A bar around an angle axis: one category per binding, the
 * reading as the radius. It is its own family because its settings differ from
 * a cartesian bar's — no orientation, a start angle, two radii — and it reuses
 * the bar's paint and data helpers, which it hands `to-top` gradients (§E1).
 */

export type PolarBarSettings = Omit<
  BarSettings,
  "orientation" | "segmentDivisor"
> & {
  readonly startAngle: number;
  readonly innerRadiusPercent: number;
  readonly outerRadiusPercent: number;
};

const {
  orientation: _orientation,
  segmentDivisor: _segmentDivisor,
  // A polar bar's width is an angle, not the cartesian bar's pixel default:
  // leaving it unset is what lets `categoryGapPercent` size the bar (§E1).
  barWidth: _barWidth,
  ...barDefaults
} = defaultBarSettings;

export const defaultPolarBarSettings: PolarBarSettings = {
  ...barDefaults,
  startAngle: 90,
  innerRadiusPercent: 20,
  outerRadiusPercent: 80,
};

/** Local emitted shape keeps raw engine options out of the theme model (§87). */
export interface PolarBarOption extends EngineAnimation {
  readonly polar: { readonly radius: [string, string] };
  readonly angleAxis: {
    readonly type: "category";
    readonly data: readonly string[];
    readonly startAngle: number;
    readonly clockwise: true;
    readonly show: boolean;
    readonly axisLabel: { readonly show: false };
  };
  readonly radiusAxis: {
    readonly type: "value";
    readonly min: number;
    readonly max: number;
    readonly show: boolean;
    readonly axisLabel: { readonly show: false };
  };
  readonly series: readonly {
    readonly type: "bar";
    readonly coordinateSystem: "polar";
    readonly data: ReturnType<typeof toBarDataItem>[];
    readonly barWidth?: number;
    readonly barCategoryGap: string;
    readonly showBackground: boolean;
    readonly backgroundStyle?: {
      readonly color: EngineColor;
      readonly borderRadius?: number;
    };
    readonly silent: true;
  }[];
}

export function buildPolarBarOption(
  settings: PolarBarSettings,
  inputs: readonly BarInput[],
  animate = true,
  palette?: FabricPalette,
): PolarBarOption {
  const paint: BarPaintSettings = settings;

  return {
    ...toEngineAnimation(settings.animation, animate),
    polar: {
      radius: [
        `${clampPercent(settings.innerRadiusPercent)}%`,
        `${clampPercent(settings.outerRadiusPercent)}%`,
      ],
    },
    angleAxis: {
      type: "category",
      data: inputs.map((input) => input.sensorId),
      startAngle: settings.startAngle,
      clockwise: true,
      show: settings.showAxes,
      // No engine text: a caption is a text object (Design C).
      axisLabel: { show: false },
    },
    radiusAxis: {
      type: "value",
      min: settings.min,
      max: settings.max,
      show: settings.showAxes,
      axisLabel: { show: false },
    },
    series: [
      {
        type: "bar" as const,
        coordinateSystem: "polar" as const,
        data: inputs.map((input) => toBarDataItem(paint, input, palette)),
        ...(settings.barWidth === undefined
          ? {}
          : { barWidth: settings.barWidth }),
        barCategoryGap: `${settings.categoryGapPercent}%`,
        showBackground: settings.track !== undefined,
        ...(settings.track === undefined
          ? {}
          : { backgroundStyle: toBackgroundStyle(paint, palette) }),
        silent: true as const,
      },
    ],
  };
}

function clampPercent(value: number): number {
  return Math.min(Math.max(value, 0), 100);
}
