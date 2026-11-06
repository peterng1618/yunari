import { describe, expect, it } from "vitest";
import {
  KRAKEN_FRAME_BYTES,
  KRAKEN_PALETTE_BYTES,
  KRAKEN_SIZE,
  toPalettedFrame,
} from "./kraken-palette.js";

function image(
  colour: (x: number, y: number) => readonly [number, number, number],
) {
  const rgba = new Uint8Array(KRAKEN_SIZE * KRAKEN_SIZE * 4);
  for (let y = 0; y < KRAKEN_SIZE; y += 1) {
    for (let x = 0; x < KRAKEN_SIZE; x += 1) {
      const at = (y * KRAKEN_SIZE + x) * 4;
      const [red, green, blue] = colour(x, y);
      rgba[at] = red;
      rgba[at + 1] = green;
      rgba[at + 2] = blue;
      rgba[at + 3] = 255;
    }
  }
  return rgba;
}

/** Mean squared error per channel between the source and the palette colours
 *  the indices name. */
function errorOf(source: Uint8Array, frame: Uint8Array): number {
  const palette = frame.subarray(0, KRAKEN_PALETTE_BYTES);
  const plane = frame.subarray(KRAKEN_PALETTE_BYTES);
  let squared = 0;
  for (let pixel = 0; pixel < plane.length; pixel += 1) {
    const entry = (plane[pixel] ?? 0) * 4;
    for (let channel = 0; channel < 3; channel += 1) {
      const delta =
        (source[pixel * 4 + channel] ?? 0) - (palette[entry + channel] ?? 0);
      squared += delta * delta;
    }
  }
  return squared / (plane.length * 3);
}

describe("toPalettedFrame", () => {
  it("writes the palette and one index per pixel, in CAM's layout", () => {
    const frame = toPalettedFrame(image(() => [0, 0, 0]));
    expect(frame.length).toBe(KRAKEN_FRAME_BYTES);
    expect(frame.length).toBe(1024 + KRAKEN_SIZE * KRAKEN_SIZE);
    // The firmware ignores the fourth palette byte and CAM writes 0.
    for (let entry = 0; entry < 256; entry += 1) {
      expect(frame[entry * 4 + 3]).toBe(0);
    }
  });

  it("keeps one-pixel hairlines instead of dithering them away", () => {
    // A 1 px white rule on black is the shape a chart's gridline takes. The
    // palette must keep a light entry, so the rule's pixels stay light rather
    // than dissolving into the background.
    const lines = image((x) =>
      x % 20 === 0 || x % 20 === 1 ? [255, 255, 255] : [0, 0, 0],
    );
    const frame = toPalettedFrame(lines);
    const palette = frame.subarray(0, KRAKEN_PALETTE_BYTES);
    const plane = frame.subarray(KRAKEN_PALETTE_BYTES);
    let darkestOnLine = 255;

    for (let y = 0; y < KRAKEN_SIZE; y += 1) {
      for (let x = 0; x < KRAKEN_SIZE; x += 1) {
        if (x % 20 > 1) continue;
        const entry = (plane[y * KRAKEN_SIZE + x] ?? 0) * 4;
        darkestOnLine = Math.min(
          darkestOnLine,
          palette[entry] ?? 0,
          palette[entry + 1] ?? 0,
          palette[entry + 2] ?? 0,
        );
      }
    }

    expect(darkestOnLine).toBeGreaterThan(200);
  });

  it("reproduces flat colours exactly and dithers a gradient close", () => {
    const flat = image((x) =>
      x < KRAKEN_SIZE / 2 ? [220, 40, 40] : [20, 90, 200],
    );
    expect(errorOf(flat, toPalettedFrame(flat))).toBe(0);

    const gradient = image((x, y) => [
      Math.round((x * 255) / (KRAKEN_SIZE - 1)),
      Math.round((y * 255) / (KRAKEN_SIZE - 1)),
      Math.round(((x + y) * 255) / (2 * (KRAKEN_SIZE - 1))),
    ]);
    // Floyd–Steinberg spreads a 256-colour palette over 102,400 pixels; the
    // per-channel error must stay well below a visible band (20^2).
    expect(errorOf(gradient, toPalettedFrame(gradient))).toBeLessThan(400);
  });

  it("is deterministic, so a repeated frame is the same bytes", () => {
    const source = image((x, y) => [x % 256, y % 256, (x * y) % 256]);
    expect(toPalettedFrame(source)).toEqual(toPalettedFrame(source));
  });
});
