import { describe, expect, it } from "vitest";
import {
  GAUGE_SEGMENT_SPACING_PERCENT_DEFAULT,
  gaugeGap,
  SEGMENT_DIVISORS,
  SEGMENT_SPACING_PERCENT_DEFAULT,
  segmentCount,
  segmentDivisorOf,
  segmentFillOf,
  segmentSpacingPercentOf,
} from "./segments.js";

describe("the segment model", () => {
  it("maps the allowed divisors to whole segment counts", () => {
    expect(SEGMENT_DIVISORS.map(segmentCount)).toEqual([
      100, 50, 25, 20, 10, 5, 4, 2, 1,
    ]);
  });

  it("treats 100 and an unknown divisor as continuous", () => {
    expect(segmentCount(100)).toBe(1);
    expect(segmentCount(33)).toBe(1);
  });

  it("reads a missing setting as 100", () => {
    expect(segmentDivisorOf({})).toBe(100);
    expect(segmentDivisorOf({ segmentDivisor: 10 })).toBe(10);
    expect(segmentDivisorOf({ segmentDivisor: 33 })).toBe(100);
  });

  it("reads an absent spacing as the family default", () => {
    expect(segmentSpacingPercentOf({})).toBe(SEGMENT_SPACING_PERCENT_DEFAULT);
    expect(SEGMENT_SPACING_PERCENT_DEFAULT).toBe(2.5);
    // Zero is authored, not absent: a band with no gap is a choice.
    expect(segmentSpacingPercentOf({ segmentSpacingPercent: 0 })).toBe(0);
  });

  it("reads an absent fill mode as the family's own", () => {
    expect(segmentFillOf({}, "whole")).toBe("whole");
    expect(segmentFillOf({}, "partial")).toBe("partial");
    expect(segmentFillOf({ segmentFill: "whole" }, "partial")).toBe("whole");
    expect(segmentFillOf({ segmentFill: "partial" }, "whole")).toBe("partial");
  });
});

describe("gaugeGap", () => {
  it("reproduces the reference look at the count the defect was reported at", () => {
    // Five bands on the starter's 270° sweep: the slot-relative gap that looked
    // right was 20% of a 54° band, i.e. 10.8°, which is 9.4% of the drawn edge.
    expect(GAUGE_SEGMENT_SPACING_PERCENT_DEFAULT).toBe(9.4);

    const reference = gaugeGap({ thickness: 20, roundCap: true }, 270, 5, 436);
    expect(reference).toBeCloseTo(10.8, 1);
  });

  it("keeps bands touching at zero spacing when the ends are square", () => {
    // The clearance exists only for a round cap: with `roundCap` off a band end
    // is a butt edge, so no drawn edge can widen a zero gap.
    expect(
      gaugeGap(
        { thickness: 18, roundCap: false, segmentSpacingPercent: 0 },
        270,
        5,
        200,
      ),
    ).toBe(0);
  });

  it("closes a zero gap by the caps when the ends are round", () => {
    expect(
      gaugeGap(
        { thickness: 18, roundCap: true, segmentSpacingPercent: 0 },
        270,
        5,
        200,
      ),
    ).toBeGreaterThan(0);
  });

  it("measures the clearance against the backing radius, not the scene edge", () => {
    // ECharts draws the ring into a canvas of edge × render scale, and the
    // option's thickness is in those backing pixels. 20px caps on a 436px
    // backing edge subtend 20/218 rad, not 20/109.
    const clearance = gaugeGap(
      { thickness: 20, roundCap: true, segmentSpacingPercent: 0 },
      270,
      5,
      436,
    );
    expect(clearance).toBeCloseTo((20 / 218) * (180 / Math.PI), 5);
  });

  it("clamps the gap to 45% of a band", () => {
    expect(
      gaugeGap({ thickness: 400, roundCap: true }, 270, 5, 400),
    ).toBeCloseTo(0.45 * 54, 5);
  });
});
