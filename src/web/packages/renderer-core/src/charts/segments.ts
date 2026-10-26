/**
 * Segmentation: a fill drawn as equal slices rather than one continuous shape.
 *
 * The author picks a **divisor** — how many slices a full measure is cut into
 * — and the shape still spans the reading, so the same setting means the same
 * thing for a bar, a gauge arc and a pie slice. `100` is one continuous fill,
 * and the divisor is chosen from the values 100 divides evenly, so every slice
 * is a whole percent of the fill's own range.
 *
 * The value is persisted, so it is the document's: the descriptor table, the
 * envelope validator and every adapter read this list rather than keeping
 * their own copy of it.
 */

/** Every divisor an author can choose, ascending, ending at continuous. */
export const SEGMENT_DIVISORS: readonly [1, 2, 4, 5, 10, 20, 25, 50, 100] = [
  1, 2, 4, 5, 10, 20, 25, 50, 100,
];

/**
 * The gap an author who has not chosen one gets, as a share of the segment it
 * separates.
 *
 * At 100 the empty space is as wide as the painted segment; 10 is the look the
 * owner approved on the reference gauge (`ADR 0121`). Measured against the
 * segment rather than the chart edge, the relationship survives every count and
 * size: a smaller band gets a proportionally smaller gap, and the rounded caps
 * no longer eat the first part of every gap.
 */
export const SEGMENT_SPACING_PERCENT_DEFAULT = 10;

/** The authored spacing, or the family's own when the document carries none. */
export function segmentSpacingPercentOf(settings: {
  readonly segmentSpacingPercent?: number;
}): number {
  return settings.segmentSpacingPercent ?? SEGMENT_SPACING_PERCENT_DEFAULT;
}

/**
 * What the reading's fill does with the slice it lands in.
 *
 * `whole` lights the slice the reading reaches, the way a segmented gauge has
 * always drawn; `partial` stops the fill at the reading itself, so the shape
 * reads like a continuous bar that happens to carry gaps. Absent is the
 * family's choice, not a third mode.
 */
export type SegmentFill = "whole" | "partial";

/** The authored fill mode, or the family's own when the document carries none. */
export function segmentFillOf(
  settings: { readonly segmentFill?: SegmentFill },
  fallback: SegmentFill,
): SegmentFill {
  return settings.segmentFill ?? fallback;
}

/**
 * The **stop** gap an angular band leaves, in degrees.
 *
 * The authored share is of the segment's *painted* width, and a round cap
 * extends each band end by half the thickness — so the empty space between two
 * painted ends is `stopGap - clearance`, not `stopGap`. Writing `q` for the
 * authored share, `b` for the band and `c` for the clearance:
 *
 *     empty = q · painted,  painted = b - stopGap + c
 *     stopGap = (q (b + c) + c) / (1 + q)
 *
 * At `q = 0` the stop gap is the clearance itself, so the caps meet and the
 * painted band is the whole band; at `q = 1` the empty space and the painted
 * band are both `b / 2`. Clamped to the band: a band cannot be negative, and
 * the adapter draws no band when the gap has taken it all.
 *
 * The clearance is measured against the **backing** radius — ECharts draws into
 * `edge × renderScale` and `thickness` is in those pixels — and is zero for
 * square ends or an unknown size, because a butt edge overhangs nothing and a
 * missing size is not a licence to guess one.
 */
export function gaugeGap(
  settings: {
    readonly thickness: number;
    readonly roundCap?: boolean;
    readonly segmentSpacingPercent?: number;
  },
  sweepDegrees: number,
  count: number,
  drawnEdgePx: number | undefined,
): number {
  const band = Math.abs(sweepDegrees) / Math.max(1, count);
  const q = Math.max(0, segmentSpacingPercentOf(settings)) / 100;
  const clearance =
    drawnEdgePx === undefined || settings.roundCap === false
      ? 0
      : (settings.thickness / Math.max(1, drawnEdgePx / 2)) * (180 / Math.PI);
  const gap = (q * (band + clearance) + clearance) / (1 + q);

  return Math.min(Math.max(0, gap), band);
}

/**
 * The empty length a cartesian band leaves, in pixels.
 *
 * A bar has nothing overhanging, so the gauge's equation with `clearance = 0`
 * gives `gap = q · band / (1 + q)`. The gap is a function of the band alone: no
 * drawn box, no angle, and halving the chart halves the band and the gap
 * together.
 */
export function barGapPx(bandPx: number, spacingPercent: number): number {
  const q = Math.max(0, spacingPercent) / 100;
  return (q * Math.max(0, bandPx)) / (1 + q);
}

/**
 * How many slices a full measure is cut into.
 *
 * A divisor the list does not carry draws continuously: it cannot come from a
 * control, and refusing it here would make a hand-edited document fail to draw
 * rather than draw the shape its reading still describes.
 */
export function segmentCount(divisor: number): number {
  return isSegmentDivisor(divisor) ? 100 / divisor : 1;
}

/** The authored divisor, or continuous when the document carries none. */
export function segmentDivisorOf(settings: {
  readonly segmentDivisor?: number;
}): number {
  const divisor = settings.segmentDivisor;
  return divisor !== undefined && isSegmentDivisor(divisor) ? divisor : 100;
}

function isSegmentDivisor(value: number): boolean {
  return (SEGMENT_DIVISORS as readonly number[]).includes(value);
}
