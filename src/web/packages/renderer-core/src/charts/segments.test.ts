import { describe, expect, it } from "vitest";
import {
  barGapPx,
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
    expect(SEGMENT_SPACING_PERCENT_DEFAULT).toBe(10);
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
  // Five bands on the starter's 270° sweep.
  const BAND = 54;

  it("leaves as much empty space as painted band at 100%", () => {
    // Square ends: the stop gap splits the band in half, so the empty space and
    // the painted band are equal.
    const square = gaugeGap(
      { thickness: 18, roundCap: false, segmentSpacingPercent: 100 },
      270,
      5,
      undefined,
    );
    expect(square).toBeCloseTo(BAND / 2, 5);

    // Round ends: the caps overhang the gap, so the *stop* gap is wider by the
    // clearance — the empty space between the painted ends is still half.
    const edge = 436;
    const clearance = (20 / (edge / 2)) * (180 / Math.PI);
    const round = gaugeGap(
      { thickness: 20, roundCap: true, segmentSpacingPercent: 100 },
      270,
      5,
      edge,
    );
    expect(round).toBeCloseTo(BAND / 2 + clearance, 5);
    expect(round - clearance).toBeCloseTo(BAND - round + clearance, 5);
  });

  it("makes the default an honest tenth of the painted band", () => {
    const edge = 436;
    const clearance = (20 / (edge / 2)) * (180 / Math.PI);
    const gap = gaugeGap({ thickness: 20, roundCap: true }, 270, 5, edge);
    const empty = gap - clearance;
    const painted = BAND - gap + clearance;

    expect(empty / painted).toBeCloseTo(0.1, 5);
  });

  it("keeps bands touching at zero spacing when the ends are square", () => {
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
    // At zero spacing there is no empty space to author: the stop gap is the
    // clearance itself, so the caps meet and the painted band is the whole band.
    const edge = 200;
    const gap = gaugeGap(
      { thickness: 18, roundCap: true, segmentSpacingPercent: 0 },
      270,
      5,
      edge,
    );

    expect(gap).toBeCloseTo((18 / (edge / 2)) * (180 / Math.PI), 5);
    expect(gap - (18 / (edge / 2)) * (180 / Math.PI)).toBeCloseTo(0, 10);
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

  it("never lets the gap take the whole band", () => {
    // Caps wider than the band itself: the stop gap stops at the band, and the
    // adapter then draws no band at all rather than a negative one.
    expect(
      gaugeGap({ thickness: 400, roundCap: true }, 270, 5, 400),
    ).toBeCloseTo(BAND, 5);
  });

  it("scales the empty space with the band at every count", () => {
    const share = (count: number): number => {
      const gap = gaugeGap(
        { thickness: 18, roundCap: false },
        270,
        count,
        undefined,
      );
      return gap / (Math.abs(270) / count);
    };

    expect(share(5)).toBeCloseTo(1 / 11, 5);
    expect(share(20)).toBeCloseTo(1 / 11, 5);
  });
});

describe("barGapPx", () => {
  it("leaves the authored share of the band empty", () => {
    expect(barGapPx(100, 10)).toBeCloseTo(100 / 11, 5);
    expect(barGapPx(10, 10)).toBeCloseTo(10 / 11, 5);
  });

  it("leaves half the band at 100%", () => {
    expect(barGapPx(100, 100)).toBeCloseTo(50, 5);
  });

  it("draws no gap on a zero band or for zero spacing", () => {
    expect(barGapPx(0, 100)).toBe(0);
    expect(barGapPx(100, 0)).toBe(0);
  });
});
