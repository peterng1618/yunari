import { crc32, inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { transparentPng } from "./tur-usb-overlay.js";

/**
 * The panel refuses a PNG whose chunk length counts the type as well as the
 * data, and `System.Drawing` does not — so a hand-built image must be checked
 * against the format, not against a decoder that happens to be lenient.
 */
function parts(png: Uint8Array): {
  readonly type: string;
  readonly length: number;
  readonly data: Uint8Array;
  readonly crc: number;
  readonly at: number;
}[] {
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  const found = [];
  let at = 8;

  while (at < png.length) {
    const length = view.getUint32(at);
    const type = String.fromCharCode(...png.subarray(at + 4, at + 8));
    found.push({
      type,
      length,
      data: png.subarray(at + 8, at + 8 + length),
      crc: view.getUint32(at + 8 + length),
      at,
    });
    at += 12 + length;
  }

  return found;
}

describe("transparentPng", () => {
  const width = 4;
  const height = 3;
  const png = transparentPng(width, height);
  const chunks = parts(png);

  it("is a PNG with IHDR, one IDAT and IEND, and nothing after it", () => {
    expect([...png.subarray(0, 8)]).toEqual([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ]);
    expect(chunks.map((part) => part.type)).toEqual(["IHDR", "IDAT", "IEND"]);
  });

  it("declares RGBA at the requested size", () => {
    const header = chunks[0];
    expect(header?.length).toBe(13);
    const data = header?.data ?? new Uint8Array();
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);

    expect(view.getUint32(0)).toBe(width);
    expect(view.getUint32(4)).toBe(height);
    expect([...data.subarray(8)]).toEqual([8, 6, 0, 0, 0]);
  });

  it("carries one CRC per type and data, which the format checks", () => {
    for (const part of chunks) {
      expect(part.crc).toBe(
        crc32(png.subarray(part.at + 4, part.at + 8 + part.length)),
      );
    }
  });

  it("inflates to filter bytes and RGBA of zero, i.e. nothing drawn", () => {
    const pixels = inflateSync(chunks[1]?.data ?? new Uint8Array());

    expect(pixels.length).toBe(height * (1 + width * 4));
    expect(pixels.every((byte) => byte === 0)).toBe(true);
  });
});
