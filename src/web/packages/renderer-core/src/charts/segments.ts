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

/** The share of each slice left empty, so neighbours stay tellable apart. */
export const SEGMENT_GAP_RATIO = 0.2;

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
