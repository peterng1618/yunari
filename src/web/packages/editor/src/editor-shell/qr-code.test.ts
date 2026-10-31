import jsQR from "jsqr";
import { describe, expect, it } from "vitest";
import { QUIET_ZONE_MODULES, qrMatrix } from "./qr-code.js";

/** The payload this has to carry: what `main.ts` prints for a paired phone —
 *  a LAN address, the host's port, and the six characters `pairing-code.ts`
 *  mints. The URL is arbitrary beyond that shape; the decode is the claim. */
const URL = "http://192.168.1.42:5227/pair?code=ABC234";

/** One block per module, at `scale` pixels a side, as the RGBA bytes a decoder
 *  reads. Written by hand rather than through a canvas: the decode is the claim,
 *  and a rasteriser that could be wrong would be a second thing to distrust. */
function rasterise(
  matrix: readonly (readonly boolean[])[],
  scale: number,
): { data: Uint8ClampedArray; width: number; height: number } {
  const rows = matrix.length;
  const columns = matrix[0]?.length ?? 0;
  const width = columns * scale;
  const height = rows * scale;
  const data = new Uint8ClampedArray(width * height * 4);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const dark =
        matrix[Math.floor(y / scale)]?.[Math.floor(x / scale)] === true;
      const value = dark ? 0 : 255;
      const at = (y * width + x) * 4;
      data[at] = value;
      data[at + 1] = value;
      data[at + 2] = value;
      data[at + 3] = 255;
    }
  }

  return { data, width, height };
}

describe("qrMatrix", () => {
  it("decodes back to the URL it was asked to carry", () => {
    const matrix = qrMatrix(URL);
    const { data, width, height } = rasterise(matrix, 8);

    expect(jsQR(data, width, height)?.data).toBe(URL);
  });

  it("carries the quiet zone the standard requires", () => {
    const matrix = qrMatrix(URL);
    const columns = matrix[0]?.length ?? 0;

    expect(columns).toBeGreaterThan(0);
    // Every row is the same width, and the outer frame is light.
    expect(matrix.every((row) => row.length === columns)).toBe(true);
    for (let i = 0; i < QUIET_ZONE_MODULES; i += 1) {
      expect(matrix[i]?.every((module) => module === false)).toBe(true);
      expect(
        matrix[matrix.length - 1 - i]?.every((module) => module === false),
      ).toBe(true);
      for (const row of matrix) {
        expect(row[i]).toBe(false);
        expect(row[columns - 1 - i]).toBe(false);
      }
    }
  });

  it("sizes the symbol for the payload, not for a guess", () => {
    // 41 bytes at error-correction M is QR version 3: 4 × 3 + 17 = 29 modules.
    expect(qrMatrix(URL).length).toBe(29 + QUIET_ZONE_MODULES * 2);
  });
});
