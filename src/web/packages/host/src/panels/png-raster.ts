import { inflateSync } from "node:zlib";

/**
 * A PNG as straight RGBA, for the frame path that cannot afford a subprocess.
 *
 * **This decodes the rasteriser's own output, not a file a person picked.**
 * Chromium's `Page.captureScreenshot` writes 8-bit truecolour PNGs —
 * `RGB` or `RGBA`, no interlacing, no palette — and the panel pipeline needs
 * those pixels in milliseconds. Everything else is refused by name rather than
 * guessed at; theme video goes through ffmpeg, which owns files and streams.
 *
 * Node's own `zlib` does the decompression: a PNG's IDAT stream is a zlib
 * stream, and the only work left is undoing the per-row filter.
 */

const SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

/** Big-endian length or dimension; PNG stores these the other way from x86. */
function word(bytes: Uint8Array, at: number): number {
  return (
    ((bytes[at] ?? 0) << 24) |
    ((bytes[at + 1] ?? 0) << 16) |
    ((bytes[at + 2] ?? 0) << 8) |
    (bytes[at + 3] ?? 0)
  );
}

/**
 * `png` as `width` x `height` straight RGBA, 4 bytes per pixel.
 *
 * The PNG must already be that size: the caller asked the browser for exactly
 * that capture, and a mismatch means the frame is not the one the panel expects.
 */
export function decodePngRgba(
  png: Uint8Array,
  width: number,
  height: number,
): Uint8Array {
  if (png.length < 8 || SIGNATURE.some((value, at) => png[at] !== value)) {
    throw new Error("That frame is not a PNG.");
  }

  let at = 8;
  let seenHeader = false;
  let pngWidth = 0;
  let pngHeight = 0;
  let channels = 0;
  const data: Uint8Array[] = [];

  while (at + 8 <= png.length) {
    const length = word(png, at);
    const kind = String.fromCharCode(
      png[at + 4] ?? 0,
      png[at + 5] ?? 0,
      png[at + 6] ?? 0,
      png[at + 7] ?? 0,
    );
    const start = at + 8;
    const end = start + length;
    if (end + 4 > png.length) {
      throw new Error("That PNG ends in the middle of a chunk.");
    }

    if (kind === "IHDR") {
      seenHeader = true;
      pngWidth = word(png, start);
      pngHeight = word(png, start + 4);
      const depth = png[start + 8] ?? 0;
      const colour = png[start + 9] ?? 0;
      const compression = png[start + 10] ?? 0;
      const filter = png[start + 11] ?? 0;
      const interlace = png[start + 12] ?? 0;

      if (depth !== 8 || compression !== 0 || filter !== 0 || interlace !== 0) {
        throw new Error(
          `That PNG is not the 8-bit, non-interlaced form this decoder takes ` +
            `(depth ${depth}, compression ${compression}, filter ${filter}, ` +
            `interlace ${interlace}).`,
        );
      }
      if (colour !== 2 && colour !== 6) {
        throw new Error(
          `That PNG is colour type ${colour}; this decoder takes truecolour ` +
            `with or without alpha.`,
        );
      }
      channels = colour === 6 ? 4 : 3;
    } else if (kind === "IDAT") {
      data.push(png.subarray(start, end));
    } else if (kind === "IEND") {
      break;
    }

    at = end + 4;
  }

  if (!seenHeader || data.length === 0) {
    throw new Error("That PNG has no header or no image data.");
  }
  if (pngWidth !== width || pngHeight !== height) {
    throw new Error(
      `That PNG is ${pngWidth}x${pngHeight}; the panel expects ${width}x${height}.`,
    );
  }

  const stride = width * channels;
  const filtered = inflateSync(
    Buffer.concat(data.map((chunk) => Buffer.from(chunk))),
  );
  const needed = (stride + 1) * height;
  if (filtered.length < needed) {
    throw new Error(
      `That PNG decompresses to ${filtered.length} bytes; ${height} rows of ` +
        `${stride} need ${needed}.`,
    );
  }

  const rgba = new Uint8Array(width * height * 4);
  const rows = unfilter(filtered, width, height, channels);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const from = y * stride + x * channels;
      const to = (y * width + x) * 4;
      rgba[to] = rows[from] ?? 0;
      rgba[to + 1] = rows[from + 1] ?? 0;
      rgba[to + 2] = rows[from + 2] ?? 0;
      rgba[to + 3] = channels === 4 ? (rows[from + 3] ?? 0) : 255;
    }
  }

  return rgba;
}

/** Undoes PNG's per-row filters, which refer to the row above and the left pixel. */
function unfilter(
  filtered: Uint8Array,
  width: number,
  height: number,
  channels: number,
): Uint8Array {
  const stride = width * channels;
  const rows = new Uint8Array(stride * height);
  let at = 0;

  for (let y = 0; y < height; y += 1) {
    const filter = filtered[at] ?? 0;
    at += 1;
    const row = y * stride;
    const above = row - stride;

    for (let x = 0; x < stride; x += 1) {
      const value = filtered[at] ?? 0;
      at += 1;
      const left = x >= channels ? (rows[row + x - channels] ?? 0) : 0;
      const up = y > 0 ? (rows[above + x] ?? 0) : 0;
      const corner =
        x >= channels && y > 0 ? (rows[above + x - channels] ?? 0) : 0;

      rows[row + x] =
        filter === 1
          ? value + left
          : filter === 2
            ? value + up
            : filter === 3
              ? value + ((left + up) >> 1)
              : filter === 4
                ? value + paeth(left, up, corner)
                : value;
    }
  }

  return rows;
}

/** PNG's predictor: whichever neighbour is closest to `left + up - corner`. */
function paeth(left: number, up: number, corner: number): number {
  const estimate = left + up - corner;
  const toLeft = Math.abs(estimate - left);
  const toUp = Math.abs(estimate - up);
  const toCorner = Math.abs(estimate - corner);

  if (toLeft <= toUp && toLeft <= toCorner) return left;
  return toUp <= toCorner ? up : corner;
}
