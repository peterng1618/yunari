import { FakeSampleSource } from "@yunari/fake-source";
import {
  LIVE_SOURCE_CHART_PLAYBACK_DELAY_MS,
  type SampleSource,
} from "@yunari/renderer-core";

const PREVIEW_HISTORY_SECONDS = 300;

export function createPreviewSource(options: {
  readonly keys: readonly string[];
  readonly now: () => number;
}): { readonly source: SampleSource } {
  const keys = new Set(options.keys);
  const waveform = new FakeSampleSource(0);

  return {
    source: {
      revision: 0,
      chartPlaybackDelayMs: LIVE_SOURCE_CHART_PLAYBACK_DELAY_MS,
      latest(key) {
        if (!keys.has(key)) return undefined;
        const now = options.now();
        if (!Number.isFinite(now)) return undefined;
        // Through the source's own clock, so a reading holds still between its
        // ticks (§122) instead of re-sampling at the frame's instant — the
        // source ticks at the host's one-second reporting interval.
        waveform.setNow(now);
        return waveform.latest(key);
      },
      history(key, windowSeconds) {
        if (!keys.has(key)) return [];
        const now = options.now();
        if (!Number.isFinite(now)) return [];
        waveform.setNow(now);
        return waveform.history(
          key,
          Math.min(windowSeconds, PREVIEW_HISTORY_SECONDS),
        );
      },
    },
  };
}
