import type { FabricPalette } from "../theme/fabric-envelope.js";
import type { ChartPaint, Fill, Sample } from "../types.js";
import { hasPlottableValue } from "../types.js";
import {
  type AnimationSettings,
  type EngineAnimation,
  toEngineAnimation,
} from "./animation.js";
import { NO_INK, resolveChartPaint } from "./chart-paint.js";
import { type EngineColor, resolveFlatColor } from "./fill.js";

/**
 * Pie/donut adapter. Composition differs from gauge progress: missing parts must
 * never be treated as zero or silently renormalised without reporting it (§83).
 */

export type PieTotal =
  | { readonly kind: "sum" }
  | { readonly kind: "fixed"; readonly value: number };

export interface PieSettings {
  /** 0 is a pie; values above 0 produce a donut. */
  readonly innerRadiusPercent: number;
  readonly outerRadiusPercent: number;
  readonly startAngle: number;
  readonly endAngle?: number;
  readonly padAngle: number;
  readonly cornerRadius: number;
  /** How many slices each part's fill is cut into; 100 is continuous. */
  readonly segmentDivisor: number;
  readonly total: PieTotal;
  /** Drawn only for fixed totals, where the remainder is measurable. */
  readonly remainderFill?: ChartPaint;
  readonly palette: readonly ChartPaint[];
  readonly animation?: AnimationSettings;
}

export const defaultPieSettings: PieSettings = {
  innerRadiusPercent: 60,
  outerRadiusPercent: 100,
  startAngle: 90,
  padAngle: 2,
  cornerRadius: 4,
  segmentDivisor: 100,
  total: { kind: "sum" },
  palette: [
    { kind: "solid", color: "#00b8d9" },
    { kind: "solid", color: "#6554c0" },
    { kind: "solid", color: "#36b37e" },
    { kind: "solid", color: "#ffab00" },
    { kind: "solid", color: "#ff5630" },
  ],
  remainderFill: { kind: "solid", color: "#2a2f3a" },
};

export interface PieSliceInput {
  readonly sensorId: string;
  readonly sample: Sample | undefined;
  readonly label?: string;
  readonly fill?: Fill;
}

export interface PieSlice {
  readonly sensorId: string;
  readonly label: string;
  readonly value: number;
  readonly share: number;
}

/** Composition facts are returned separately so missing/overflow can be surfaced in text. */
export interface PieComposition {
  readonly slices: readonly PieSlice[];
  readonly missing: readonly string[];
  readonly knownTotal: number;
  readonly whole: number;
  /** Exists only for a non-overflowing fixed total. */
  readonly remainder?: number;
  readonly complete: boolean;
  /** Known parts exceed the authored fixed total. */
  readonly overflow: boolean;
}

export interface PieDataItem {
  readonly name: string;
  readonly value: number;
  readonly itemStyle: {
    readonly color: EngineColor;
    readonly borderRadius: number;
  };
}

export interface PieOption extends EngineAnimation {
  readonly series: readonly [
    {
      readonly type: "pie";
      readonly radius: readonly [string, string];
      readonly center: readonly ["50%", "50%"];
      readonly startAngle: number;
      readonly endAngle?: number;
      readonly padAngle: number;
      readonly label: { readonly show: false };
      readonly labelLine: { readonly show: false };
      readonly avoidLabelOverlap: false;
      readonly data: readonly PieDataItem[];
      readonly silent: true;
    },
  ];
}

/** Resolve samples without fabricating missing or negative parts. */
export function computeComposition(
  settings: PieSettings,
  inputs: readonly PieSliceInput[],
): PieComposition {
  const present: { input: PieSliceInput; value: number }[] = [];
  const missing: string[] = [];

  for (const input of inputs) {
    if (hasPlottableValue(input.sample)) {
      // Negative composition parts have no meaningful angle; treat as unknown.
      if (input.sample.value < 0) {
        missing.push(input.sensorId);
        continue;
      }
      present.push({ input, value: input.sample.value });
    } else {
      missing.push(input.sensorId);
    }
  }

  const knownTotal = present.reduce((sum, p) => sum + p.value, 0);

  const fixedTotal =
    settings.total.kind === "fixed"
      ? Math.max(0, settings.total.value)
      : undefined;
  const overflow = fixedTotal !== undefined && knownTotal > fixedTotal;

  // Keep geometry coherent on overflow and expose the misconfiguration separately.
  const whole = fixedTotal === undefined || overflow ? knownTotal : fixedTotal;

  const slices = present.map(({ input, value }) => ({
    sensorId: input.sensorId,
    label: input.label ?? input.sensorId,
    value,
    share: whole === 0 ? 0 : value / whole,
  }));

  const remainder =
    fixedTotal !== undefined && !overflow ? fixedTotal - knownTotal : undefined;

  return {
    slices,
    missing,
    knownTotal,
    whole,
    ...(remainder === undefined ? {} : { remainder }),
    complete: missing.length === 0,
    overflow,
  };
}

export function buildPieOption(
  settings: PieSettings,
  inputs: readonly PieSliceInput[],
  animate = true,
  palette?: FabricPalette,
): PieOption {
  const composition = computeComposition(settings, inputs);
  const borderRadius = Math.max(0, settings.cornerRadius);

  const data: PieDataItem[] = composition.slices.map((slice, index) => {
    const declared = inputs.find((i) => i.sensorId === slice.sensorId)?.fill;
    const fill =
      declared ??
      resolveChartPaint(paletteAt(settings.palette, index), palette);

    return {
      name: slice.label,
      value: slice.value,
      itemStyle: {
        // A slice whose colour failed to resolve keeps its share: dropping it
        // would renumber the composition around a paint failure, which §83
        // forbids. The face shows no ink, so it shows no number either (0007).
        color:
          fill === undefined ? NO_INK : resolveFlatColor(fill, slice.share),
        borderRadius,
      },
    };
  });

  if (composition.remainder !== undefined && composition.remainder > 0) {
    const remainder = resolveChartPaint(
      settings.remainderFill ?? { kind: "solid", color: "#2a2f3a" },
      palette,
    );
    data.push({
      name: "remainder",
      value: composition.remainder,
      itemStyle: {
        color:
          remainder === undefined ? NO_INK : resolveFlatColor(remainder, 1),
        borderRadius,
      },
    });
  }

  return {
    ...toEngineAnimation(settings.animation, animate),
    series: [
      {
        type: "pie",
        radius: [
          `${clampPercent(settings.innerRadiusPercent)}%`,
          `${clampPercent(settings.outerRadiusPercent)}%`,
        ],
        center: ["50%", "50%"],
        startAngle: settings.startAngle,
        ...(settings.endAngle === undefined
          ? {}
          : { endAngle: settings.endAngle }),
        padAngle: Math.max(0, settings.padAngle),
        label: { show: false },
        labelLine: { show: false },
        // Preserve authored order; composition order can carry meaning.
        avoidLabelOverlap: false,
        data,
        silent: true,
      },
    ],
  };
}

function paletteAt(palette: readonly ChartPaint[], index: number): ChartPaint {
  if (palette.length === 0) {
    return { kind: "solid", color: "#8993a4" };
  }
  return palette[index % palette.length]!;
}

function clampPercent(value: number): number {
  return Math.min(Math.max(value, 0), 100);
}
