import { describe, expect, it } from "vitest";
import {
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
