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
 * The gap an author who has not chosen one gets, as a share of the chart's
 * smaller drawn edge.
 *
 * **A share of the slot is not a share of what is seen.** A gap proportional to
 * a slice shrinks with the count twice over — more slices means both a smaller
 * slot and a smaller gap — so a 20-slice gauge whose gaps looked right at one
 * size lost them at half the size. A gap measured against the drawn edge is the
 * same gap to the eye at every size (`ADR 0120`).
 */
export const SEGMENT_SPACING_PERCENT_DEFAULT = 2.5;

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
 * The empty arc an angular band leaves, in degrees.
 *
 * **The spacing term carries no `drawnEdge`.** A gap that is a share of the
 * edge against a radius of half the edge is the same angle at every size, so
 * cancelling the two is what makes the gap look identical on a large chart and a
 * small one. The clearance term is the other half: a round cap extends each band
 * end by `thickness / 2` pixels, and whether that is visible depends on how many
 * pixels the ring has — so a smaller chart gets a wider angle, and a chart whose
 * size is unknown skips the term rather than guessing one.
 *
 * Clamped to 45% of a band: past that the gap stops reading as a gap and starts
 * eating the band, and no author choice should be able to do that.
 */
export function gaugeGap(
  settings: {
    readonly thickness: number;
    readonly segmentSpacingPercent?: number;
  },
  sweepDegrees: number,
  count: number,
  drawnEdge: number | undefined,
): number {
  const bandSweep = Math.abs(sweepDegrees) / Math.max(1, count);
  const spacing =
    ((2 * segmentSpacingPercentOf(settings)) / 100) * (180 / Math.PI);
  const clearance =
    drawnEdge === undefined
      ? 0
      : (settings.thickness / Math.max(1, drawnEdge / 2)) * (180 / Math.PI);

  return Math.min(Math.max(spacing, clearance), 0.45 * bandSweep);
}

/**
 * The empty length a cartesian band leaves, in pixels.
 *
 * A bar draws in pixel space, so the share of the chart's smaller edge is
 * already the gap — no angle and no radius. The 45% clamp is the same one the
 * gauge applies: past it the gap stops reading as a gap.
 */
export function barGapPx(
  edgePx: number,
  bandPx: number,
  spacingPercent: number,
): number {
  const share = (Math.max(0, spacingPercent) / 100) * Math.max(0, edgePx);
  return Math.min(share, 0.45 * bandPx);
}

/**
 * The empty angle a pie leaves between its sub-slices, in degrees.
 *
 * The edge cancels here exactly as it does in the gauge's spacing term: the gap
 * is a share of the whole edge, the drawn radius is `outerRadiusPercent` of half
 * of it, and the quotient is an angle. The pie does not draw at the full edge,
 * so a smaller outer radius widens the gap — which is what keeps it looking the
 * same thickness on a donut's narrower face.
 */
export function pieGap(settings: {
  readonly outerRadiusPercent: number;
  readonly segmentSpacingPercent?: number;
}): number {
  const outer = Math.min(100, Math.max(0, settings.outerRadiusPercent));
  if (outer === 0) return 0;

  return ((2 * segmentSpacingPercentOf(settings)) / outer) * (180 / Math.PI);
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
