import { describe, expect, it } from "vitest";
import { ringLayout } from "./kraken-lighting.js";

describe("ringLayout", () => {
  it("squares a ring to the smallest grid whose perimeter holds its LEDs", () => {
    // perimeter = 4n − 4, so each of these lands exactly on its ring.
    expect(ringLayout(12)).toEqual({ shape: "ring", width: 4, height: 4 });
    expect(ringLayout(24)).toEqual({ shape: "ring", width: 7, height: 7 });
    expect(ringLayout(40)).toEqual({ shape: "ring", width: 11, height: 11 });
  });

  it("rounds up when the count does not fill a perimeter", () => {
    expect(ringLayout(41)).toEqual({ shape: "ring", width: 12, height: 12 });
  });
});
