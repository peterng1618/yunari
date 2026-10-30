import { describe, expect, it } from "vitest";
import { quarterTurns } from "./kraken-z3-panel.js";

/**
 * The byte the frame encoder rotates by. `31 01` carries it at `0x1A`; a value
 * the protocol does not define is upright rather than a wild turn.
 */
describe("the LCD orientation byte", () => {
  const report = (value: number): Uint8Array => {
    const bytes = new Uint8Array(64);
    bytes[0x1a] = value;
    return bytes;
  };

  it("reads quarter turns 0 to 3", () => {
    expect([0, 1, 2, 3].map((turns) => quarterTurns(report(turns)))).toEqual([
      0, 1, 2, 3,
    ]);
  });

  it("refuses a value the protocol does not define rather than turning it", () => {
    expect(quarterTurns(report(4))).toBe(0);
    expect(quarterTurns(report(255))).toBe(0);
  });

  it("defaults to upright when the reply is short or missing", () => {
    expect(quarterTurns(new Uint8Array(0))).toBe(0);
  });
});
