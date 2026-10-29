import { crc32, deflateSync } from "node:zlib";

/**
 * The panel's second layer, and the PNG that empties it.
 *
 * L-Connect composites its sensor dashboard on a PNG layer over the JPEG
 * background, and that layer keeps its last picture after L-Connect exits — a
 * Yunari theme renders underneath it. A fully transparent PNG over the same
 * geometry replaces it, which is how L-Connect itself clears a theme's widgets
 * (see.md).
 */

const SIGNATURE = Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);

/**
 * One PNG chunk: the data length, the type, the data, then the CRC over
 * type+data. The length counts the data only — a length that included the type
 * is accepted by some decoders and refused by this panel.
 */
function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i += 1) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

/**
 * A `width`x`height` PNG with every pixel transparent, which is the clear for
 * the overlay layer.
 */
export function transparentPng(width: number, height: number): Uint8Array {
  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  header[8] = 8; // bit depth
  header[9] = 6; // colour type: RGBA
  // One filter byte (0, none) then RGBA per pixel; zeros are transparent black.
  const pixels = new Uint8Array(height * (1 + width * 4));

  const parts = [
    SIGNATURE,
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(pixels)),
    chunk("IEND", new Uint8Array()),
  ];
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}
