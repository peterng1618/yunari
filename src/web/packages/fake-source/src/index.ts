import {
  describeSemanticKey,
  instantIn,
  type Sample,
  type SampleSource,
  type SensorStatus,
} from "@yunari/renderer-core";

/** Deterministic synthetic SampleSource for development/tests. Never real telemetry. */

export {
  createDemoSource,
  demoSourceOptions,
} from "./demo.js";

/** Synthetic behaviour selected by the final semantic-key segment. */
export interface SensorProfile {
  readonly unit: string;
  readonly min: number;
  readonly max: number;
  readonly periodSeconds: number;
  readonly spikiness: number;
}

/** Plausible dev ranges, not hardware measurements. */
export const PROFILES: Readonly<Record<string, SensorProfile>> = {
  load: { unit: "%", min: 2, max: 97, periodSeconds: 23, spikiness: 2.5 },
  temp: { unit: "°C", min: 34, max: 82, periodSeconds: 47, spikiness: 1 },
  clock: {
    unit: "MHz",
    min: 800,
    max: 5200,
    periodSeconds: 31,
    spikiness: 1.8,
  },
  fan: { unit: "RPM", min: 600, max: 2100, periodSeconds: 61, spikiness: 1 },
  power: { unit: "W", min: 15, max: 220, periodSeconds: 19, spikiness: 2.2 },
  used: { unit: "GB", min: 6.5, max: 22.5, periodSeconds: 97, spikiness: 1 },
  ratio: { unit: "", min: 0, max: 1, periodSeconds: 29, spikiness: 1.4 },
  fps: { unit: "FPS", min: 48, max: 165, periodSeconds: 13, spikiness: 3 },
};

const FALLBACK_PROFILE: SensorProfile = {
  unit: "",
  min: 0,
  max: 100,
  periodSeconds: 37,
  spikiness: 1,
};

/**
 * A device's capacity does not move, so a total is answered as the constant it
 * is rather than as a waveform. Both sit above `used`'s range (max 22.5 GB), so
 * a theme reading `used` against its total still adds up.
 */
const CAPACITY_TOTALS: Readonly<
  Record<string, { readonly value: number; readonly unit: string }>
> = {
  "ram.total": { value: 32, unit: "GB" },
  "vram.total": { value: 24, unit: "GB" },
};

/** Deterministic outage rule for exercising gap rendering. */
export interface OutageRule {
  readonly semanticKey: string;
  readonly everySeconds: number;
  readonly forSeconds: number;
  readonly status?: Exclude<SensorStatus, "ok">;
}

export interface FakeSourceOptions {
  /** Sampling cadence. Values remain constant between these ticks. */
  readonly sampleIntervalMs?: number;
  readonly forcedStatus?: Readonly<Record<string, Exclude<SensorStatus, "ok">>>;
  readonly outages?: readonly OutageRule[];
  readonly textValues?: Readonly<Record<string, string>>;
  /** `latest` returns undefined for these keys, modelling an unmapped sensor. */
  readonly unmappedKeys?: readonly string[];
  /** Deterministically shifts all waveforms. */
  readonly seed?: number;
}

export class FakeSampleSource implements SampleSource {
  /** Synthetic values are regenerated on read, not ingested, so nothing advances. */
  readonly revision = 0;
  readonly #intervalMs: number;
  readonly #forcedStatus: Readonly<Record<string, Exclude<SensorStatus, "ok">>>;
  readonly #outages: readonly OutageRule[];
  readonly #textValues: Readonly<Record<string, string>>;
  readonly #unmapped: ReadonlySet<string>;
  readonly #seed: number;
  #nowMs: number;

  constructor(nowMs: number, options: FakeSourceOptions = {}) {
    this.#nowMs = nowMs;
    this.#intervalMs = Math.max(1, options.sampleIntervalMs ?? 1000);
    this.#forcedStatus = options.forcedStatus ?? {};
    this.#outages = options.outages ?? [];
    this.#textValues = options.textValues ?? {};
    this.#unmapped = new Set(options.unmappedKeys ?? []);
    this.#seed = options.seed ?? 0;
  }

  /** Caller-owned clock keeps screenshots/tests deterministic. */
  setNow(nowMs: number): void {
    this.#nowMs = nowMs;
  }

  get nowMs(): number {
    return this.#nowMs;
  }

  latest(semanticKey: string): Sample | undefined {
    if (this.#unmapped.has(semanticKey)) {
      return undefined;
    }

    return this.sampleAt(semanticKey, this.#quantise(this.#nowMs));
  }

  history(semanticKey: string, windowSeconds: number): readonly Sample[] {
    if (this.#unmapped.has(semanticKey)) {
      return [];
    }

    const end = this.#quantise(this.#nowMs);
    const start = end - Math.max(0, windowSeconds) * 1000;
    const samples: Sample[] = [];
    // One cadence before the aligned cutoff is the predecessor the source
    // contract promises, so the line reaches its left edge on every frame.
    const first =
      Math.ceil(start / this.#intervalMs) * this.#intervalMs - this.#intervalMs;

    for (let t = first; t <= end; t += this.#intervalMs) {
      samples.push(this.sampleAt(semanticKey, t));
    }

    return samples;
  }

  /** Deterministic sample for a key at an exact instant. */
  sampleAt(semanticKey: string, timeMs: number): Sample {
    const timestamp = new Date(timeMs).toISOString();

    const forced = this.#forcedStatus[semanticKey];
    if (forced !== undefined) {
      return {
        sensorId: semanticKey,
        timestamp,
        status: forced,
        message: `Fake source: ${semanticKey} is pinned to ${forced}.`,
      };
    }

    const outage = this.#outageAt(semanticKey, timeMs);
    if (outage !== undefined) {
      // Non-ok samples omit value entirely; they are not zero.
      return {
        sensorId: semanticKey,
        timestamp,
        status: outage,
        message: `Fake source: simulated ${outage} window.`,
      };
    }

    const text = this.#textValues[semanticKey];
    if (text !== undefined) {
      return {
        sensorId: semanticKey,
        timestamp,
        status: "ok",
        textValue: text,
      };
    }

    // A key the vocabulary declares as an instant is the time this sample is
    // for, so a clock previews in the editor and in a fixture theme exactly as
    // the host would report it.
    if (describeSemanticKey(semanticKey)?.instant !== undefined) {
      return {
        sensorId: semanticKey,
        timestamp,
        status: "ok",
        textValue: instantIn(timeMs),
      };
    }

    const total = CAPACITY_TOTALS[semanticKey];
    if (total !== undefined) {
      return {
        sensorId: semanticKey,
        timestamp,
        status: "ok",
        value: total.value,
        unit: total.unit,
      };
    }

    const profile = profileFor(semanticKey);

    return {
      sensorId: semanticKey,
      timestamp,
      status: "ok",
      value: waveform(semanticKey, timeMs, profile, this.#seed),
      unit: profile.unit,
    };
  }

  #quantise(timeMs: number): number {
    return Math.floor(timeMs / this.#intervalMs) * this.#intervalMs;
  }

  #outageAt(
    semanticKey: string,
    timeMs: number,
  ): Exclude<SensorStatus, "ok"> | undefined {
    for (const rule of this.#outages) {
      if (rule.semanticKey !== semanticKey || rule.everySeconds <= 0) {
        continue;
      }

      const cycleMs = rule.everySeconds * 1000;
      // Hash offset prevents multiple outage rules from lining up by default.
      const phase = (timeMs + (stableHash(semanticKey) % cycleMs)) % cycleMs;

      if (phase < rule.forSeconds * 1000) {
        return rule.status ?? "error";
      }
    }

    return undefined;
  }
}

export function profileFor(semanticKey: string): SensorProfile {
  const segment = semanticKey.split(".").at(-1) ?? "";
  return PROFILES[segment] ?? FALLBACK_PROFILE;
}

/** Reproducible mixed-wave signal bounded by the profile. */
export function waveform(
  semanticKey: string,
  timeMs: number,
  profile: SensorProfile,
  seed = 0,
): number {
  const hash = stableHash(semanticKey) + seed;
  const phase = ((hash % 1000) / 1000) * Math.PI * 2;
  const seconds = timeMs / 1000;

  const fast = Math.sin(
    (seconds / profile.periodSeconds) * Math.PI * 2 + phase,
  );
  const slow = Math.sin(
    (seconds / (profile.periodSeconds * 1.618)) * Math.PI * 2 + phase * 1.7,
  );

  const mixed = (fast * 0.65 + slow * 0.35 + 1) / 2;
  const shaped =
    profile.spikiness === 1 ? mixed : Math.pow(mixed, profile.spikiness);
  const value = profile.min + shaped * (profile.max - profile.min);

  return Math.round(value * 1000) / 1000;
}

/** Deterministic 32-bit FNV-1a hash. */
export function stableHash(value: string): number {
  let hash = 0x811c9dc5;

  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }

  return hash;
}
