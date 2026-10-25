import {
  buildChartPlan,
  defaultLineSettings,
  LIVE_SOURCE_CHART_PLAYBACK_DELAY_MS,
  type SampleSource,
} from "@yunari/renderer-core";
import { describe, expect, it } from "vitest";
import { createPreviewSource } from "./preview-source.js";

describe("createPreviewSource", () => {
  it("generates deterministic, bounded samples only for requested semantic keys", () => {
    let now = 0;
    const preview = createPreviewSource({ keys: ["cpu.load"], now: () => now });

    expect(preview.source.chartPlaybackDelayMs).toBe(
      LIVE_SOURCE_CHART_PLAYBACK_DELAY_MS,
    );

    const first = preview.source.latest("cpu.load");
    now += 1_000;
    const next = preview.source.latest("cpu.load");

    expect(first?.value).not.toBe(next?.value);
    expect(preview.source.latest("ram.used")).toBeUndefined();

    for (let second = 0; second < 700; second += 1) {
      now += 1_000;
      preview.source.latest("cpu.load");
    }

    expect(preview.source.history("cpu.load", 1_000)).toHaveLength(302);
  });

  it("reads on the source's sampling cadence, not the frame clock", () => {
    // §122: sampling and animation are separate rates. A preview that sampled
    // at the frame's instant would flicker through digits the real host cannot
    // produce — it reports once a second.
    let now = 1_000_000;
    const preview = createPreviewSource({ keys: ["cpu.load"], now: () => now });

    const tick = preview.source.latest("cpu.load");

    for (const frameMs of [1, 16, 17, 500]) {
      now += frameMs;
      expect(preview.source.latest("cpu.load")).toEqual(tick);
    }

    now = 1_001_000;
    expect(preview.source.latest("cpu.load")).not.toEqual(tick);
  });

  it("draws a line straight, the same as the player, with or without a delay", () => {
    // The editor must show what the player will draw. Smoothing is not an
    // authorable choice, so neither surface can disagree about it (0116).
    const now = 60_000;
    const preview = createPreviewSource({ keys: ["cpu.load"], now: () => now });
    const undelayed: SampleSource = {
      latest: (key) => preview.source.latest(key),
      history: (key, seconds) => preview.source.history(key, seconds),
    };
    const smooth = (source: SampleSource): boolean => {
      const chart = buildChartPlan(
        "line",
        {
          family: "line",
          settings: { ...defaultLineSettings, interpolation: "linear" },
        },
        [{ id: "b", semanticKey: "cpu.load" }],
        { source, nowMs: now },
        [],
      );
      if (chart.family !== "line") throw new Error("expected a line chart");
      return chart.option.series[0]!.smooth;
    };

    expect(smooth(preview.source)).toBe(false);
    expect(smooth(undelayed)).toBe(false);
  });
});
