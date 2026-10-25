import { LIVE_SOURCE_CHART_PLAYBACK_DELAY_MS } from "@yunari/renderer-core";
import { describe, expect, it } from "vitest";
import { DEFAULT_SAMPLE_INTERVAL_MS } from "./server.js";

describe("the sampling cadence and the line's edge", () => {
  it("leaves the edge two cadences behind the newest sample", () => {
    // The visible curve is only stable while the axis edge lags the newest
    // sample by two cadences (design spec §A3): the spline reshapes the segment
    // ending at the newest sample, and that segment starts one cadence back.
    // Raising the host cadence without raising the delay brings back the
    // right-edge self-correction the owner reported.
    expect(LIVE_SOURCE_CHART_PLAYBACK_DELAY_MS).toBeGreaterThanOrEqual(
      2 * DEFAULT_SAMPLE_INTERVAL_MS,
    );
  });
});
