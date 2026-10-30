import { deflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { decodePngRgba } from "./png-raster.js";

/**
 * The decoder reads what Chromium's screenshot writes: 8-bit truecolour with
 * or without alpha. The fixtures are generated here so every row filter can be
 * asked for, including the ones a hand-picked sample would miss.
 */

function chunk(kind: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  new DataView(out.buffer).setUint32(0, data.length);
  for (let index = 0; index < 4; index += 1) {
    out[4 + index] = kind.charCodeAt(index);
  }
  out.set(data, 8);
  // The checksum is not read: this decoder takes lengths and names, and a zero
  // CRC keeps the fixture independent of a second implementation.
  return out;
}

function paeth(left: number, up: number, corner: number): number {
  const estimate = left + up - corner;
  const toLeft = Math.abs(estimate - left);
  const toUp = Math.abs(estimate - up);
  const toCorner = Math.abs(estimate - corner);

  if (toLeft <= toUp && toLeft <= toCorner) return left;
  return toUp <= toCorner ? up : corner;
}

function pngOf(
  width: number,
  height: number,
  channels: number,
  pixels: Uint8Array,
  filters: readonly number[],
  header = { colour: channels === 4 ? 6 : 2, interlace: 0 },
): Uint8Array {
  const stride = width * channels;
  const raw = new Uint8Array((stride + 1) * height);

  for (let y = 0; y < height; y += 1) {
    const filter = filters[y] ?? 0;
    raw[y * (stride + 1)] = filter;

    for (let x = 0; x < stride; x += 1) {
      const value = pixels[y * stride + x] ?? 0;
      const left = x >= channels ? (pixels[y * stride + x - channels] ?? 0) : 0;
      const up = y > 0 ? (pixels[(y - 1) * stride + x] ?? 0) : 0;
      const corner =
        x >= channels && y > 0
          ? (pixels[(y - 1) * stride + x - channels] ?? 0)
          : 0;
      const predicted =
        filter === 1
          ? left
          : filter === 2
            ? up
            : filter === 3
              ? (left + up) >> 1
              : filter === 4
                ? paeth(left, up, corner)
                : 0;

      raw[y * (stride + 1) + 1 + x] = value - predicted;
    }
  }

  const head = new Uint8Array(13);
  const view = new DataView(head.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  head[8] = 8;
  head[9] = header.colour;
  head[12] = header.interlace;

  const body = deflateSync(raw);
  return Uint8Array.from([
    137,
    80,
    78,
    71,
    13,
    10,
    26,
    10,
    ...chunk("IHDR", head),
    ...chunk("IDAT", body),
    ...chunk("IEND", new Uint8Array(0)),
  ]);
}

const pixelsOf = (width: number, height: number, channels: number) => {
  const bytes = new Uint8Array(width * height * channels);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = (index * 37 + 11) & 0xff;
  }
  return bytes;
};

describe("the PNG frame decoder", () => {
  it("undoes every row filter in an RGBA capture", () => {
    const pixels = pixelsOf(4, 5, 4);
    const png = pngOf(4, 5, 4, pixels, [0, 1, 2, 3, 4]);

    expect(Array.from(decodePngRgba(png, 4, 5))).toEqual(Array.from(pixels));
  });

  it("widens an RGB capture with opaque alpha", () => {
    const pixels = pixelsOf(3, 2, 3);
    const rgba = decodePngRgba(pngOf(3, 2, 3, pixels, [0, 4]), 3, 2);

    for (let pixel = 0; pixel < 6; pixel += 1) {
      expect(Array.from(rgba.subarray(pixel * 4, pixel * 4 + 4))).toEqual([
        pixels[pixel * 3],
        pixels[pixel * 3 + 1],
        pixels[pixel * 3 + 2],
        255,
      ]);
    }
  });

  it("refuses a palette image rather than decoding it as truecolour", () => {
    const png = pngOf(2, 1, 3, pixelsOf(2, 1, 3), [0], {
      colour: 3,
      interlace: 0,
    });

    expect(() => decodePngRgba(png, 2, 1)).toThrow("colour type 3");
  });

  it("refuses an interlaced image rather than decoding it row by row", () => {
    const png = pngOf(2, 1, 3, pixelsOf(2, 1, 3), [0], {
      colour: 2,
      interlace: 1,
    });

    expect(() => decodePngRgba(png, 2, 1)).toThrow("non-interlaced");
  });

  it("refuses a capture that is not the size the panel asked for", () => {
    const png = pngOf(2, 1, 3, pixelsOf(2, 1, 3), [0]);

    expect(() => decodePngRgba(png, 4, 1)).toThrow("2x1");
  });

  it("refuses bytes that are not a PNG at all", () => {
    expect(() => decodePngRgba(Uint8Array.of(1, 2, 3), 1, 1)).toThrow(
      "not a PNG",
    );
  });
});
