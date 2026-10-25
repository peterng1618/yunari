import type { Sample } from "../types.js";
import type { SampleSource } from "./source.js";

/** Both age and count bounds apply; the tighter one wins. */
export interface SampleStoreOptions {
  readonly maxAgeSeconds?: number;
  readonly maxSamplesPerKey?: number;
}

/** Chosen defaults: five minutes and 600 samples per key. */
export const defaultSampleStoreOptions: Required<SampleStoreOptions> = {
  maxAgeSeconds: 300,
  maxSamplesPerKey: 600,
};

/** One key's samples and the time each was accepted at, kept in lockstep. */
interface Series {
  readonly samples: Sample[];
  readonly times: number[];
  /** False when an unreadable or out-of-order time sits in `times`. */
  timeOrdered: boolean;
}

/** Bounded push-in/pull-out history store (§122). Count cap also bounds fast sources. */
export class SampleStore implements SampleSource {
  private readonly maxAgeMs: number;
  private readonly maxSamples: number;
  private readonly series = new Map<string, Series>();
  private lastNowMs = Number.NEGATIVE_INFINITY;
  private revisionCount = 0;

  get revision(): number {
    return this.revisionCount;
  }

  constructor(options: SampleStoreOptions = {}) {
    this.maxAgeMs =
      Math.max(
        0,
        options.maxAgeSeconds ?? defaultSampleStoreOptions.maxAgeSeconds,
      ) * 1000;
    this.maxSamples = Math.max(
      1,
      Math.floor(
        options.maxSamplesPerKey ?? defaultSampleStoreOptions.maxSamplesPerKey,
      ),
    );
  }

  /** Record samples and prune touched keys against both bounds. */
  ingest(entries: Iterable<readonly [string, Sample]>, nowMs: number): void {
    this.lastNowMs = nowMs;
    const touched = new Set<string>();

    for (const [semanticKey, sample] of entries) {
      let series = this.series.get(semanticKey);

      if (series === undefined) {
        series = { samples: [], times: [], timeOrdered: true };
        this.series.set(semanticKey, series);
      }

      const time = sampleTimeMs(sample);
      const stored = Number.isFinite(time) ? time : Number.NEGATIVE_INFINITY;
      const previous = series.times.at(-1);

      if (
        !Number.isFinite(time) ||
        (previous !== undefined && stored < previous)
      ) {
        series.timeOrdered = false;
      }

      // An unreadable time is kept by prune but never surfaced by history.
      series.samples.push(sample);
      series.times.push(stored);
      touched.add(semanticKey);
    }

    for (const semanticKey of touched) {
      this.prune(semanticKey, nowMs);
    }

    this.revisionCount += 1;
  }

  latest(semanticKey: string): Sample | undefined {
    return this.series.get(semanticKey)?.samples.at(-1);
  }

  history(semanticKey: string, windowSeconds: number): readonly Sample[] {
    const series = this.series.get(semanticKey);

    if (series === undefined || series.samples.length === 0) {
      return [];
    }

    if (!Number.isFinite(this.lastNowMs)) {
      return [...series.samples];
    }

    // Samples arrive in time order; the live path stamps presentationTimestamp
    // at ingest, so the stored times stay ascending.
    const start = this.lastNowMs - Math.max(0, windowSeconds) * 1000;

    if (!Number.isFinite(start)) {
      return [];
    }

    if (!series.timeOrdered) {
      return series.samples.filter((_sample, index) => {
        const time = series.times[index] ?? Number.NEGATIVE_INFINITY;
        return Number.isFinite(time) && time >= start && time <= this.lastNowMs;
      });
    }

    let low = 0;
    let high = series.times.length;

    while (low < high) {
      const middle = (low + high) >>> 1;
      const time = series.times[middle] ?? Number.NEGATIVE_INFINITY;

      if (time < start) {
        low = middle + 1;
      } else {
        high = middle;
      }
    }

    const window: Sample[] = [];

    for (let index = low; index < series.times.length; index++) {
      const time = series.times[index] ?? Number.NEGATIVE_INFINITY;
      const sample = series.samples[index];

      if (time > this.lastNowMs) {
        break;
      }

      if (sample !== undefined && Number.isFinite(time)) {
        window.push(sample);
      }
    }

    return window;
  }

  /** Clear on reconnect so old and server-replayed timelines cannot interleave. */
  reset(): void {
    this.series.clear();
    this.lastNowMs = Number.NEGATIVE_INFINITY;
    this.revisionCount = 0;
  }

  private prune(semanticKey: string, nowMs: number): void {
    const series = this.series.get(semanticKey);

    if (series === undefined) {
      return;
    }

    const cutoff = nowMs - this.maxAgeMs;
    const keep = (time: number): boolean =>
      !Number.isFinite(time) || time >= cutoff;
    const keptTimes = series.times.filter(keep);
    const keptSamples = series.samples.filter((_sample, index) =>
      keep(series.times[index] ?? Number.NEGATIVE_INFINITY),
    );
    const samples =
      keptSamples.length > this.maxSamples
        ? keptSamples.slice(keptSamples.length - this.maxSamples)
        : keptSamples;
    const times =
      keptTimes.length > this.maxSamples
        ? keptTimes.slice(keptTimes.length - this.maxSamples)
        : keptTimes;

    this.series.set(semanticKey, {
      samples,
      times,
      timeOrdered: times.every(
        (time, index) =>
          Number.isFinite(time) &&
          (index === 0 ||
            time >= (times[index - 1] ?? Number.NEGATIVE_INFINITY)),
      ),
    });
  }
}

function sampleTimeMs(sample: Sample): number {
  return Date.parse(sample.presentationTimestamp ?? sample.timestamp);
}
