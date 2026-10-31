import { snapRotation } from "@yunari/renderer-core";
import { describe, expect, it } from "vitest";
import { snapQuarterTurn } from "../public/rotation.js";

/**
 * The pairing page has no build step, so it carries a browser copy of the
 * quarter-turn rounding. This is what keeps that copy the same rule as
 * renderer-core's owner: a change to either side that moves one angle fails
 * here (`vg-760`).
 */
describe("the pairing page's quarter-turn helper", () => {
  it("lands every angle where renderer-core's rule does", () => {
    const angles = [
      0, 1, 44, 45, 46, 89, 90, 134, 135, 180, 225, 269, 270, 315, 350, 359,
      360, 361, 450,
    ];

    expect(angles.map((degrees) => snapQuarterTurn(degrees))).toEqual(
      angles.map((degrees) => snapRotation("rect", degrees)),
    );
  });
});
