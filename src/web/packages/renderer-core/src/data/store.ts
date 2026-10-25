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

/** Bounded push-in/pull-out history store (§122). Count cap also bounds fast sources. */
export class SampleStore implements SampleSource {
  private readonly maxAgeMs: number;
  private readonly maxSamples: number;
  private readonly series = new Map<string, Sample[]>();
  private lastNowMs = Number.NEGATIVE_INFINITY;

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
      let list = this.series.get(semanticKey);

      if (list === undefined) {
        list = [];
        this.series.set(semanticKey, list);
      }

      list.push(sample);
      touched.add(semanticKey);
    }

    for (const semanticKey of touched) {
      this.prune(semanticKey, nowMs);
    }
  }

  latest(semanticKey: string): Sample | undefined {
    return this.series.get(semanticKey)?.at(-1);
  }

  history(semanticKey: string, windowSeconds: number): readonly Sample[] {
    const list = this.series.get(semanticKey);

    if (list === undefined || list.length === 0) {
      return [];
    }

    if (!Number.isFinite(this.lastNowMs)) {
      return [...list];
    }

    const start = this.lastNowMs - Math.max(0, windowSeconds) * 1000;
    let predecessor: Sample | undefined;
    let predecessorTime = Number.NEGATIVE_INFINITY;
    const inWindow: Sample[] = [];

    for (const sample of list) {
      const time = sampleTimeMs(sample);
      if (!Number.isFinite(time)) {
        continue;
      }
      if (time < start) {
        if (time > predecessorTime) {
          predecessor = sample;
          predecessorTime = time;
        }
      } else if (time <= this.lastNowMs) {
        inWindow.push(sample);
      }
    }

    return predecessor === undefined ? inWindow : [predecessor, ...inWindow];
  }

  /** Clear on reconnect so old and server-replayed timelines cannot interleave. */
  reset(): void {
    this.series.clear();
    this.lastNowMs = Number.NEGATIVE_INFINITY;
  }

  private prune(semanticKey: string, nowMs: number): void {
    const list = this.series.get(semanticKey);

    if (list === undefined) {
      return;
    }

    const cutoff = nowMs - this.maxAgeMs;
    const kept = list.filter((sample) => {
      const time = sampleTimeMs(sample);
      return !Number.isFinite(time) || time >= cutoff;
    });

    this.series.set(
      semanticKey,
      kept.length > this.maxSamples
        ? kept.slice(kept.length - this.maxSamples)
        : kept,
    );
  }
}

function sampleTimeMs(sample: Sample): number {
  return Date.parse(sample.presentationTimestamp ?? sample.timestamp);
}
