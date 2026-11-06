/**
 * One Kraken Z frame in the format its streaming transfer takes: a 256-entry
 * `R,G,B,A` palette, then one 8-bit palette index per pixel.
 *
 * **This is the wire format, not an image format.** CAM's own stream is this
 * layout, 1,024 palette bytes plus 102,400 indices, and the firmware ignores
 * the fourth palette byte; it is written as 0. The bucket table's 101-slot
 * entry is exactly these bytes.
 *
 * **The palette is rebuilt for every frame and the quantization error is
 * diffused.** CAM's captured stream carries a different palette in almost every
 * frame and its neighbouring index pairs are overwhelmingly low-distance
 * dithered pairs, so a fixed palette would be a different picture: it bands on
 * gradients and it cannot follow a photograph. Floyd–Steinberg is applied in
 * the capture's own orientation, because the display record owns rotation.
 *
 * **A 5-bit histogram is the whole search space.** No pixel is ever compared by
 * exact colour: two colours within 8 of each other share a bin. Median cut then
 * splits the populated bins into at most 256 boxes, and each box's weighted
 * mean becomes a palette entry. `lookup` maps every populated bin straight to
 * its box, so the common pixel costs one array read; a dithered colour that
 * falls outside every populated bin searches the palette once and caches the
 * answer for the rest of the frame.
 */

export const KRAKEN_SIZE = 320;
/** 256 entries of four bytes; the firmware ignores the fourth. */
export const KRAKEN_PALETTE_BYTES = 256 * 4;
export const KRAKEN_FRAME_BYTES =
  KRAKEN_PALETTE_BYTES + KRAKEN_SIZE * KRAKEN_SIZE;

/** 5 bits per channel is the histogram's whole key space. */
const BIN_COUNT = 32 * 32 * 32;
const BOX_COUNT = 256;
const NO_ENTRY = -1;

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
 * The frame the device reads: the palette, then one index per pixel in the
 * capture's own orientation. Rotation is not this module's: the display record
 * owns the mount angle and the player has applied it before the capture.
 */
export function toPalettedFrame(rgba: Uint8Array): Uint8Array {
  const histogram = new Uint32Array(BIN_COUNT);
  // **Exact channel sums, not the bin centre.** A flat colour has no exact
  // neighbour once the bin is coarsened to 5 bits, and Floyd–Steinberg's
  // weights sum to 1: a palette entry that is off by even one ramp the error
  // without bound until the nearest entry flips, which shows as speckles in a
  // flat fill. Summing the real bytes makes a flat region's mean its own
  // colour, so its error is zero.
  const redSum = new Uint32Array(BIN_COUNT);
  const greenSum = new Uint32Array(BIN_COUNT);
  const blueSum = new Uint32Array(BIN_COUNT);

  for (let pixel = 0; pixel < KRAKEN_SIZE * KRAKEN_SIZE; pixel += 1) {
    const at = pixel * 4;
    const red = rgba[at] ?? 0;
    const green = rgba[at + 1] ?? 0;
    const blue = rgba[at + 2] ?? 0;
    const bin = binOf(red, green, blue);
    histogram[bin] = (histogram[bin] ?? 0) + 1;
    redSum[bin] = (redSum[bin] ?? 0) + red;
    greenSum[bin] = (greenSum[bin] ?? 0) + green;
    blueSum[bin] = (blueSum[bin] ?? 0) + blue;
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
  // A bin outside every box is -1 until a dithered colour asks for it.
  const lookup = new Int16Array(BIN_COUNT).fill(NO_ENTRY);

  boxes.forEach((box, index) => {
    const at = index * 4;
    const [red, green, blue] = meanOf(points, box, redSum, greenSum, blueSum);
    frame[at] = red;
    frame[at + 1] = green;
    frame[at + 2] = blue;
    // Alpha is the firmware's padding, not the captured alpha.
    frame[at + 3] = 0;

    for (let point = box.start; point < box.end; point += 1) {
      lookup[points[point]?.key ?? 0] = index;
    }
  });

  const palette = frame.subarray(0, KRAKEN_PALETTE_BYTES);
  const plane = frame.subarray(KRAKEN_PALETTE_BYTES);
  diffuse(rgba, plane, palette, lookup, boxes.length);

  return frame;
}

/** Every pixel's palette index, after Floyd–Steinberg diffusion. */
function diffuse(
  rgba: Uint8Array,
  plane: Uint8Array,
  palette: Uint8Array,
  lookup: Int16Array,
  paletteSize: number,
): void {
  const error = new Float32Array(KRAKEN_SIZE * KRAKEN_SIZE * 3);

  for (let y = 0; y < KRAKEN_SIZE; y += 1) {
    for (let x = 0; x < KRAKEN_SIZE; x += 1) {
      const pixel = y * KRAKEN_SIZE + x;
      const at = pixel * 4;
      const carry = pixel * 3;
      const red = clamp((rgba[at] ?? 0) + (error[carry] ?? 0));
      const green = clamp((rgba[at + 1] ?? 0) + (error[carry + 1] ?? 0));
      const blue = clamp((rgba[at + 2] ?? 0) + (error[carry + 2] ?? 0));
      const bin = binOf(red, green, blue);

      let index = lookup[bin] ?? NO_ENTRY;
      if (index === NO_ENTRY) {
        index = nearest(palette, paletteSize, red, green, blue);
        lookup[bin] = index;
      }
      plane[pixel] = index;

      const entry = index * 4;
      diffuseError(
        error,
        pixel,
        x,
        y,
        red - (palette[entry] ?? 0),
        green - (palette[entry + 1] ?? 0),
        blue - (palette[entry + 2] ?? 0),
      );
    }
  }
}

/** Clamps a channel to a byte after the diffusion error is added. */
function clamp(value: number): number {
  return value < 0 ? 0 : value > 255 ? 255 : value;
}

/**
 * Floyd–Steinberg's 7/16, 3/16, 5/16 and 1/16 weights, in place. The error is
 * held per channel so a later pixel's clamp sees the same value CAM's renderer
 * would have produced.
 */
function diffuseError(
  error: Float32Array,
  pixel: number,
  x: number,
  y: number,
  red: number,
  green: number,
  blue: number,
): void {
  const right = (pixel + 1) * 3;
  if (x + 1 < KRAKEN_SIZE) {
    add(error, right, red, green, blue, 7 / 16);
  }
  if (y + 1 >= KRAKEN_SIZE) return;

  if (x > 0) {
    add(error, (pixel + KRAKEN_SIZE - 1) * 3, red, green, blue, 3 / 16);
  }
  add(error, (pixel + KRAKEN_SIZE) * 3, red, green, blue, 5 / 16);
  if (x + 1 < KRAKEN_SIZE) {
    add(error, (pixel + KRAKEN_SIZE + 1) * 3, red, green, blue, 1 / 16);
  }
}

function add(
  error: Float32Array,
  at: number,
  red: number,
  green: number,
  blue: number,
  weight: number,
): void {
  error[at] = (error[at] ?? 0) + red * weight;
  error[at + 1] = (error[at + 1] ?? 0) + green * weight;
  error[at + 2] = (error[at + 2] ?? 0) + blue * weight;
}

/** The nearest palette entry, by squared distance in RGB. */
function nearest(
  palette: Uint8Array,
  paletteSize: number,
  red: number,
  green: number,
  blue: number,
): number {
  let best = 0;
  let distance = Number.POSITIVE_INFINITY;

  for (let index = 0; index < paletteSize; index += 1) {
    const at = index * 4;
    const dr = red - (palette[at] ?? 0);
    const dg = green - (palette[at + 1] ?? 0);
    const db = blue - (palette[at + 2] ?? 0);
    const candidate = dr * dr + dg * dg + db * db;

    if (candidate < distance) {
      distance = candidate;
      best = index;
    }
  }

  return best;
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

/** The box's colour as the weighted mean of its real pixels, rounded to 8 bits
 *  per channel. The 5-bit bin only groups; the sums are the true bytes. */
function meanOf(
  points: readonly Point[],
  box: Box,
  redSum: Uint32Array,
  greenSum: Uint32Array,
  blueSum: Uint32Array,
): readonly [number, number, number] {
  let red = 0;
  let green = 0;
  let blue = 0;
  let count = 0;

  for (let index = box.start; index < box.end; index += 1) {
    const point = pointAt(points, index);
    red += redSum[point.key] ?? 0;
    green += greenSum[point.key] ?? 0;
    blue += blueSum[point.key] ?? 0;
    count += point.count;
  }

  if (count === 0) return [0, 0, 0];
  return [
    Math.round(red / count),
    Math.round(green / count),
    Math.round(blue / count),
  ];
}
