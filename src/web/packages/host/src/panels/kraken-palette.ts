/**
 * One Kraken Z frame in the format its streaming transfer takes: a 256-entry
 * `R,G,B,A` palette, then one 8-bit palette index per pixel.
 *
 * **This is a wire format, not an image format.** The panel validates the
 * payload length and reads the fourth palette byte as padding, so the encoder
 * writes it as 0 rather than carrying alpha the firmware drops.
 *
 * **Why quantise at all.** CAM's own stream is this layout: 1,024 palette bytes
 * plus 102,400 indices, a quarter of the 409,600 bytes a raw still costs. The
 * device is 320x320 and 8-bit indexed, so the alternative is spending 4x the
 * wire time to send colours it cannot show.
 *
 * The histogram buckets colour at 5 bits per channel, so no pixel is ever
 * compared by exact value: two colours that differ by less than 8 are the same
 * bucket, and the palette entry is the weighted mean of its bucket's colours.
 * That is the same trade a 256-colour median cut makes, with a table small
 * enough to map every pixel without searching the palette.
 */

export const KRAKEN_SIZE = 320;
/** 256 entries of four bytes; the firmware ignores the fourth. */
export const KRAKEN_PALETTE_BYTES = 256 * 4;
export const KRAKEN_FRAME_BYTES =
  KRAKEN_PALETTE_BYTES + KRAKEN_SIZE * KRAKEN_SIZE;

/** 5 bits per channel is the histogram's whole key space. */
const BIN_COUNT = 32 * 32 * 32;
const BOX_COUNT = 256;

interface Point {
  readonly key: number;
  readonly count: number;
  readonly red: number;
  readonly green: number;
  readonly blue: number;
}

interface Box {
  /** Half-open range into the points array. */
  start: number;
  end: number;
  count: number;
  /** 0 = red, 1 = green, 2 = blue. */
  axis: number;
  range: number;
}

/**
 * The frame the device reads, rotated clockwise by `quarterTurns` so the
 * picture is upright for the mount the panel reported.
 */
export function toPalettedFrame(
  rgba: Uint8Array,
  quarterTurns: number,
): Uint8Array {
  const histogram = new Uint32Array(BIN_COUNT);

  for (let pixel = 0; pixel < KRAKEN_SIZE * KRAKEN_SIZE; pixel += 1) {
    const at = pixel * 4;
    const bin = binOf(rgba[at] ?? 0, rgba[at + 1] ?? 0, rgba[at + 2] ?? 0);
    histogram[bin] = (histogram[bin] ?? 0) + 1;
  }

  const points: Point[] = [];
  for (let key = 0; key < BIN_COUNT; key += 1) {
    const count = histogram[key] ?? 0;
    if (count === 0) continue;
    points.push({
      key,
      count,
      red: (key >> 10) & 0x1f,
      green: (key >> 5) & 0x1f,
      blue: key & 0x1f,
    });
  }

  const boxes = medianCut(points);
  const frame = new Uint8Array(KRAKEN_FRAME_BYTES);
  const lookup = new Uint8Array(BIN_COUNT);

  boxes.forEach((box, index) => {
    const at = index * 4;
    const mean = meanOf(points.slice(box.start, box.end));
    frame[at] = mean[0];
    frame[at + 1] = mean[1];
    frame[at + 2] = mean[2];
    frame[at + 3] = 0;

    for (let point = box.start; point < box.end; point += 1) {
      lookup[points[point]?.key ?? 0] = index;
    }
  });

  const quarter = ((quarterTurns % 4) + 4) % 4;
  for (let y = 0; y < KRAKEN_SIZE; y += 1) {
    for (let x = 0; x < KRAKEN_SIZE; x += 1) {
      const pixel = sourcePixel(x, y, quarter);
      const at = pixel * 4;
      frame[KRAKEN_PALETTE_BYTES + y * KRAKEN_SIZE + x] =
        lookup[binOf(rgba[at] ?? 0, rgba[at + 1] ?? 0, rgba[at + 2] ?? 0)] ?? 0;
    }
  }

  return frame;
}

function binOf(red: number, green: number, blue: number): number {
  return ((red >> 3) << 10) | ((green >> 3) << 5) | (blue >> 3);
}

function pointAt(points: readonly Point[], index: number): Point {
  return points[index] ?? { key: 0, count: 0, red: 0, green: 0, blue: 0 };
}

/** The box's widest channel and the population it holds. */
function measure(points: readonly Point[], start: number, end: number): Box {
  let redLow = 31;
  let redHigh = 0;
  let greenLow = 31;
  let greenHigh = 0;
  let blueLow = 31;
  let blueHigh = 0;
  let count = 0;

  for (let index = start; index < end; index += 1) {
    const point = pointAt(points, index);
    redLow = Math.min(redLow, point.red);
    redHigh = Math.max(redHigh, point.red);
    greenLow = Math.min(greenLow, point.green);
    greenHigh = Math.max(greenHigh, point.green);
    blueLow = Math.min(blueLow, point.blue);
    blueHigh = Math.max(blueHigh, point.blue);
    count += point.count;
  }

  const spans = [redHigh - redLow, greenHigh - greenLow, blueHigh - blueLow];
  const axis = spans.indexOf(Math.max(...spans));

  return { start, end, count, axis, range: spans[axis] ?? 0 };
}

/**
 * Median cut: split the box with the most pixels along its widest channel until
 * there are 256 boxes, or nothing can be split.
 */
function medianCut(points: Point[]): readonly Box[] {
  const boxes: Box[] = [measure(points, 0, points.length)];

  while (boxes.length < BOX_COUNT) {
    let target = -1;
    for (const [index, box] of boxes.entries()) {
      if (box.range === 0 || box.end - box.start < 2) continue;
      if (
        target === -1 ||
        box.count * box.range > boxes[target]!.count * boxes[target]!.range
      ) {
        target = index;
      }
    }
    if (target === -1) break;

    const box = boxes[target]!;
    // A box holding one dominant colour can reach half its population at its
    // last point, which is still a valid cut: keep one point aside rather than
    // leaving the box whole, or the cut stops at the first flat background.
    const split = Math.min(
      Math.max(splitAt(points, box), box.start + 1),
      box.end - 1,
    );
    boxes.splice(
      target,
      1,
      measure(points, box.start, split),
      measure(points, split, box.end),
    );
  }

  return boxes;
}

/** Sorts the box along its widest channel and returns the weighted middle. */
function splitAt(points: Point[], box: Box): number {
  const channel = box.axis === 0 ? "red" : box.axis === 1 ? "green" : "blue";
  const slice = points
    .slice(box.start, box.end)
    .sort((first, second) => first[channel] - second[channel]);
  for (const [offset, point] of slice.entries())
    points[box.start + offset] = point;

  const half = box.count / 2;
  let seen = 0;
  for (let index = box.start; index < box.end; index += 1) {
    seen += pointAt(points, index).count;
    if (seen >= half) return Math.min(index + 1, box.end);
  }

  return box.end;
}

/** The box's colour as a weighted mean, rounded to 8 bits per channel. */
function meanOf(points: readonly Point[]): readonly [number, number, number] {
  let red = 0;
  let green = 0;
  let blue = 0;
  let count = 0;

  for (const point of points) {
    red += ((point.red << 3) | (point.red >> 2)) * point.count;
    green += ((point.green << 3) | (point.green >> 2)) * point.count;
    blue += ((point.blue << 3) | (point.blue >> 2)) * point.count;
    count += point.count;
  }

  if (count === 0) return [0, 0, 0];
  return [
    Math.round(red / count),
    Math.round(green / count),
    Math.round(blue / count),
  ];
}

/**
 * Where the destination pixel came from after a clockwise quarter turn.
 *
 * Each case is a rotation, not a flip: a turned frame keeps its handedness, so
 * a mirrored picture would be the bug here. The top-left pixel is the check —
 * clockwise it lands top-right, a horizontal mirror would land it there too, so
 * the top-right pixel must land bottom-right.
 */
function sourcePixel(x: number, y: number, quarter: number): number {
  switch (quarter) {
    case 1:
      return (KRAKEN_SIZE - 1 - x) * KRAKEN_SIZE + y;
    case 2:
      return (KRAKEN_SIZE - 1 - y) * KRAKEN_SIZE + (KRAKEN_SIZE - 1 - x);
    case 3:
      return x * KRAKEN_SIZE + (KRAKEN_SIZE - 1 - y);
    default:
      return y * KRAKEN_SIZE + x;
  }
}
