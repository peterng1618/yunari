import { describe, expect, it } from "vitest";
import { KRAKEN_FRAME_BYTES, toPalettedFrame } from "./kraken-palette.js";

const SIZE = 320;
const PALETTE_BYTES = 1_024;

function raster(
  paint: (set: (x: number, y: number, rgba: number[]) => void) => void,
) {
  const rgba = new Uint8Array(SIZE * SIZE * 4);
  paint((x, y, values) => {
    rgba.set(values, (y * SIZE + x) * 4);
  });
  return rgba;
}

/** The palette entry holding exactly these channels, or -1. */
function entryOf(frame: Uint8Array, rgba: readonly number[]): number {
  for (let index = 0; index < 256; index += 1) {
    const at = index * 4;
    if (
      frame[at] === rgba[0] &&
      frame[at + 1] === rgba[1] &&
      frame[at + 2] === rgba[2] &&
      frame[at + 3] === 0
    ) {
      return index;
    }
  }
  return -1;
}

function indexAt(frame: Uint8Array, x: number, y: number): number {
  return frame[PALETTE_BYTES + y * SIZE + x] ?? -1;
}

describe("Kraken paletted frame", () => {
  it("is a 256-entry RGBA palette followed by one index per pixel", () => {
    const frame = toPalettedFrame(raster(() => {}));

    expect(frame.length).toBe(KRAKEN_FRAME_BYTES);
    // A flat raster needs one colour, and the fourth byte is padding rather
    // than alpha the firmware reads.
    expect(entryOf(frame, [0, 0, 0])).toBe(0);
    expect(frame.subarray(4, PALETTE_BYTES).every((value) => value === 0)).toBe(
      true,
    );
    expect(frame.subarray(PALETTE_BYTES).every((value) => value === 0)).toBe(
      true,
    );
  });

  it("keeps the channel order the firmware reads", () => {
    const frame = toPalettedFrame(
      raster((set) => {
        set(10, 10, [255, 0, 0, 255]);
        set(11, 10, [0, 255, 0, 255]);
        set(12, 10, [0, 0, 255, 255]);
      }),
    );

    expect(entryOf(frame, [255, 0, 0])).toBeGreaterThanOrEqual(0);
    expect(entryOf(frame, [0, 255, 0])).toBeGreaterThanOrEqual(0);
    expect(entryOf(frame, [0, 0, 255])).toBeGreaterThanOrEqual(0);
  });

  it("keeps each pixel where the capture put it", () => {
    // The mount angle is the display record's, already applied by the player,
    // so the encoder must not turn the plane a second time.
    const marked = raster((set) => {
      set(0, 0, [255, 0, 0, 255]);
      set(SIZE - 1, 0, [0, 0, 255, 255]);
    });
    const frame = toPalettedFrame(marked);

    expect(indexAt(frame, 0, 0)).not.toBe(indexAt(frame, SIZE - 1, 0));
    expect(indexAt(frame, SIZE - 1, 0)).toBe(entryOf(frame, [0, 0, 255]));
  });
});
