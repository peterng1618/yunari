/** Shared sample and gauge types. */

/** Check status before reading a value; non-ok samples render as gaps, never zero. */
export type SensorStatus = "ok" | "missing" | "stale" | "error" | "unavailable";

export interface Sample {
  readonly sensorId: string;
  readonly timestamp: string;
  /** Browser-local release time for delayed live rendering; never serialized. */
  readonly presentationTimestamp?: string;
  readonly status: SensorStatus;
  /** Raw, unclamped numeric value; absent for non-ok samples. */
  readonly value?: number;
  readonly textValue?: string;
  readonly booleanValue?: boolean;
  readonly unit?: string;
  readonly message?: string;
}

export function hasPlottableValue(
  sample: Sample | undefined,
): sample is Sample & { value: number } {
  return (
    sample?.status === "ok" &&
    typeof sample.value === "number" &&
    Number.isFinite(sample.value)
  );
}

// GaugeSettings remains here historically; animation imports do not form a runtime cycle.
import type { AnimationSettings } from "./charts/animation.js";
import type { ChartPaint } from "./charts/chart-paint.js";
import {
  SEGMENT_SPACING_PERCENT_DEFAULT,
  type SegmentFill,
} from "./charts/segments.js";

export interface GradientStop {
  readonly offset: number;
  readonly color: string;
}

/** Thresholds are semantic bands; gradients are decorative continuous fills. */
export type Fill =
  | { readonly kind: "solid"; readonly color: string }
  | { readonly kind: "thresholds"; readonly bands: readonly GradientStop[] }
  | { readonly kind: "gradient"; readonly stops: readonly GradientStop[] };

export type { ChartPaint } from "./charts/chart-paint.js";

/** Typed gauge settings translated internally to ECharts options. */
export interface GaugeSettings {
  readonly startAngle: number;
  readonly endAngle: number;
  readonly min: number;
  readonly max: number;
  readonly thickness: number;
  readonly track: ChartPaint;
  readonly progress: ChartPaint;
  readonly roundCap: boolean;
  /** How many slices the fill is cut into; 100 is one continuous arc. */
  readonly segmentDivisor: number;
  /** Gap between slices, as a share of the chart's smaller drawn edge. */
  readonly segmentSpacingPercent?: number;
  /** Whether the reading lights a whole slice or stops at its own value. */
  readonly segmentFill?: SegmentFill;
  /** Segment count for approximating angular gradients on the ring. */
  readonly gradientSegments?: number;
  readonly animation?: AnimationSettings;
}

export const defaultGaugeSettings: GaugeSettings = {
  startAngle: 225,
  endAngle: -45,
  min: 0,
  max: 100,
  thickness: 18,
  track: { kind: "solid", color: "#2a2f3a" },
  progress: { kind: "solid", color: "#00b8d9" },
  roundCap: true,
  segmentDivisor: 100,
  segmentSpacingPercent: SEGMENT_SPACING_PERCENT_DEFAULT,
  segmentFill: "whole",
  gradientSegments: 64,
};
