import { describe, expect, it } from "vitest";
import { chartAnimationFor, chartPlaybackDelayFor } from "./chart-animation.js";

describe("chartAnimationFor", () => {
  it.each(["gauge", "bar", "pie"] as const)("animates %s at 30 fps", (family) =>
    expect(chartAnimationFor(family, 30)).toBe(true),
  );
  it("leaves the line clock-driven at 30 fps", () => {
    expect(chartAnimationFor("line", 30)).toBe(false);
  });
  it.each(["gauge", "line", "bar", "pie"] as const)(
    "zeroes %s at 1 fps",
    (family) => expect(chartAnimationFor(family, 1)).toBe(false),
  );
});

describe("chartPlaybackDelayFor", () => {
  it("keeps the source's delay at 30 fps, and no delay when it has none", () => {
    expect(chartPlaybackDelayFor(30, 2_000)).toBe(2_000);
    expect(chartPlaybackDelayFor(30, undefined)).toBe(0);
  });

  it("drops it at 1 fps, where a frame a second leaves no trail to hide", () => {
    expect(chartPlaybackDelayFor(1, 2_000)).toBe(0);
  });
});
