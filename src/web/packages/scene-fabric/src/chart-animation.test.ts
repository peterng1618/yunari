import { describe, expect, it } from "vitest";
import { chartAnimationFor } from "./chart-animation.js";

describe("chartAnimationFor", () => {
  it.each(["gauge", "bar", "pie"] as const)(
    "animates %s at 30 fps",
    (family) => expect(chartAnimationFor(family, 30)).toBe(true),
  );
  it("leaves the line clock-driven at 30 fps", () => {
    expect(chartAnimationFor("line", 30)).toBe(false);
  });
  it.each(["gauge", "line", "bar", "pie"] as const)(
    "zeroes %s at 1 fps",
    (family) => expect(chartAnimationFor(family, 1)).toBe(false),
  );
});
