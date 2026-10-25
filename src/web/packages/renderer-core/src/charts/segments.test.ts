import { describe, expect, it } from "vitest";
import {
  SEGMENT_DIVISORS,
  SEGMENT_GAP_RATIO,
  segmentCount,
  segmentDivisorOf,
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

  it("leaves a fifth of each segment as the gap", () => {
    expect(SEGMENT_GAP_RATIO).toBe(0.2);
  });
});
