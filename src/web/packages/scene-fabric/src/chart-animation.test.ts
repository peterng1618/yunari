import { describe, expect, it } from "vitest";
import { chartAnimationFor } from "./chart-animation.js";

describe("chartAnimationFor", () => {
  it.each(["gauge", "bar", "pie"] as const)("animates %s at 30 fps", (family) =>
    expect(chartAnimationFor(family, 30)).toBe(true),
  );
  it("leaves the line static at 30 fps", () => {
    // A line moves with its data, so an engine transition would animate the
    // jump itself (0124).
    expect(chartAnimationFor("line", 30)).toBe(false);
  });
  it.each(["gauge", "line", "bar", "pie"] as const)(
    "zeroes %s at 1 fps",
    (family) => expect(chartAnimationFor(family, 1)).toBe(false),
  );
});
