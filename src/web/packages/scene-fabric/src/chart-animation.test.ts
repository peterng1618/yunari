import { describe, expect, it } from "vitest";
import { chartAnimationFor } from "./chart-animation.js";

describe("chartAnimationFor", () => {
  it.each(["gauge", "bar", "pie", "radar", "polarBar"] as const)(
    "animates %s",
    (family) => expect(chartAnimationFor(family)).toBe(true),
  );
  it("leaves the line static", () => {
    // A line moves with its data, so an engine transition would animate the
    // jump itself.
    expect(chartAnimationFor("line")).toBe(false);
  });
});
