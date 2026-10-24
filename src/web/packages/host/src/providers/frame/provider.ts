import {
  describeSemanticKey,
  type Sample,
  type SampleEntry,
} from "@yunari/renderer-core";
import type {
  ProviderHealth,
  SensorDescriptor,
  SensorProvider,
} from "../provider.js";
import { descriptorFieldsOf, redactForBrowser } from "../provider.js";
import { FrameWindow } from "./rolling.js";
import { type FrameAdapter, type FrameReading, RtssAdapter } from "./rtss.js";

/**
 * Frame statistics for the active 3D application.
 *
 * The adapter acquires frames; this provider owns the rolling window, so the
 * numbers a theme sees are computed here rather than trusted from RTSS. A key
 * with no frames behind it is `unavailable` — never zero — and the helper only
 * runs while a display is binding `frame.*`.
 */

const FRAME_PROVIDER_ID = "frame";

export const FRAME_KEYS = [
  "fps.current",
  "frametime.current",
  "fps.low1",
  "frame.app",
] as const;

export const FRAME_DESCRIPTORS: readonly SensorDescriptor[] = FRAME_KEYS.map(
  (key) => {
    const declared = describeSemanticKey(key);

    if (declared === undefined) {
      throw new Error(`${key} is not in the semantic key vocabulary`);
    }

    return {
      sensorId: `${FRAME_PROVIDER_ID}:${key}`,
      semanticKey: key,
      label: declared.label,
      ...descriptorFieldsOf(declared),
      tier: declared.expectedTier,
    };
  },
);

const UNIT_BY_KEY: ReadonlyMap<string, string | undefined> = new Map(
  FRAME_DESCRIPTORS.map((descriptor) => [
    descriptor.semanticKey,
    descriptor.unit,
  ]),
);

export const NO_FRAMES_MESSAGE = "No frame timing has been reported by RTSS.";
export const WAITING_LOW1_MESSAGE = "Not enough frames yet for a 1% low.";
export const NO_APP_MESSAGE = "No game process is reporting frame statistics.";

/** No display asked for a frame key for this long, so the helper stops. */
const DEFAULT_GRACE_MS = 30_000;
/** A helper that failed is not retried before this, so it cannot spin. */
const DEFAULT_RETRY_MS = 60_000;
/** How often the grace period is re-checked while the helper runs. */
const TICK_MS = 1_000;

export interface FrameProviderOptions {
  readonly now?: () => number;
  readonly graceMs?: number;
  readonly retryMs?: number;
  readonly adapter?: FrameAdapter;
}

interface RunningHelper {
  alive: boolean;
  stop: () => void;
}

export class FrameProvider implements SensorProvider {
  readonly id = FRAME_PROVIDER_ID;
  readonly label = "Frames";

  readonly #now: () => number;
  readonly #graceMs: number;
  readonly #retryMs: number;
  readonly #adapter: FrameAdapter;

  #helper: RunningHelper | undefined;
  #tick: ReturnType<typeof setTimeout> | undefined;
  #lastDemandMs = Number.NEGATIVE_INFINITY;
  #retryAtMs = 0;
  #window = new FrameWindow();
  #app: string | undefined;
  /** Redacted; may reach a browser through `health()` and a sample message. */
  #failure: string | undefined;

  constructor(options: FrameProviderOptions = {}) {
    this.#now = options.now ?? (() => Date.now());
    this.#graceMs = Math.max(1, options.graceMs ?? DEFAULT_GRACE_MS);
    this.#retryMs = Math.max(0, options.retryMs ?? DEFAULT_RETRY_MS);
    this.#adapter = options.adapter ?? new RtssAdapter();
  }

  async describe(): Promise<readonly SensorDescriptor[]> {
    return FRAME_DESCRIPTORS;
  }

  async sample(
    semanticKeys: readonly string[],
    nowMs: number,
  ): Promise<readonly SampleEntry[]> {
    const wanted = FRAME_KEYS.filter((key) => semanticKeys.includes(key));

    if (wanted.length === 0) {
      return [];
    }

    const now = this.#now();
    this.#lastDemandMs = now;
    this.#reconcile(now);

    return wanted.map((semanticKey) => ({
      semanticKey,
      sample: this.#sampleOf(semanticKey, nowMs),
    }));
  }

  health(): ProviderHealth {
    return this.#failure === undefined
      ? { available: true }
      : { available: false, message: this.#failure };
  }

  /** Ends the helper and its grace timer for host shutdown. */
  stop(): void {
    this.#teardown();
    this.#retryAtMs = 0;
    this.#lastDemandMs = Number.NEGATIVE_INFINITY;
  }

  #reconcile(now: number): void {
    if (now - this.#lastDemandMs > this.#graceMs) {
      this.#teardown();
      return;
    }

    if (this.#helper !== undefined || now < this.#retryAtMs) return;

    this.#start();
  }

  #start(): void {
    const state: RunningHelper = { alive: true, stop: () => undefined };

    const handle = this.#adapter.start(
      (reading) => {
        if (state.alive) this.#reading(reading);
      },
      (reason) => {
        if (!state.alive) return;
        state.alive = false;
        this.#unavailable(reason);
        state.stop();
      },
    );

    state.stop = handle;

    if (!state.alive) {
      // A helper can report an absent PowerShell or an exiting script before
      // `start` returns, so this assignment is never taken as proof of life.
      handle();
      return;
    }

    this.#helper = state;
    this.#scheduleTick();
  }

  /** Reports the reason once and backs off; a reading later replaces it. */
  #unavailable(reason: string): void {
    this.#helper = undefined;
    this.#failure = redactForBrowser(reason);
    this.#retryAtMs = this.#now() + this.#retryMs;
    this.#window = new FrameWindow();
    this.#app = undefined;
    this.#stopTick();
  }

  #reading(reading: FrameReading): void {
    this.#window.add(reading.frametimeMs, this.#now());
    this.#app = reading.app === "" ? undefined : reading.app;
    this.#failure = undefined;
  }

  #teardown(): void {
    this.#stopTick();

    const current = this.#helper;
    this.#helper = undefined;

    if (current !== undefined) {
      current.alive = false;
      current.stop();
    }

    this.#window = new FrameWindow();
    this.#app = undefined;
    this.#failure = undefined;
  }

  #stopTick(): void {
    if (this.#tick !== undefined) {
      clearTimeout(this.#tick);
      this.#tick = undefined;
    }
  }

  #scheduleTick(): void {
    if (this.#tick !== undefined || this.#helper === undefined) return;

    this.#tick = setTimeout(() => {
      this.#tick = undefined;
      this.#reconcile(this.#now());

      if (this.#helper !== undefined) this.#scheduleTick();
    }, TICK_MS);
    (this.#tick as { unref?: () => void }).unref?.();
  }

  #sampleOf(semanticKey: string, nowMs: number): Sample {
    const sensorId = `${FRAME_PROVIDER_ID}:${semanticKey}`;
    const timestamp = new Date(nowMs).toISOString();
    const unit = UNIT_BY_KEY.get(semanticKey);
    const absent = (message: string): Sample => ({
      sensorId,
      timestamp,
      status: "unavailable",
      message: this.#failure ?? message,
    });

    if (semanticKey === "frame.app") {
      return this.#app === undefined
        ? absent(NO_APP_MESSAGE)
        : { sensorId, timestamp, status: "ok", textValue: this.#app };
    }

    const at = this.#now();
    const fps = this.#window.fps(at);

    if (fps === undefined) return absent(NO_FRAMES_MESSAGE);

    if (semanticKey === "fps.low1") {
      const low = this.#window.low1(at);
      if (low === undefined) return absent(WAITING_LOW1_MESSAGE);

      return {
        sensorId,
        timestamp,
        status: "ok",
        value: low,
        ...(unit === undefined ? {} : { unit }),
      };
    }

    // The mean frametime over the same second `fps.current` averages.
    const value = semanticKey === "fps.current" ? fps : 1000 / fps;

    return {
      sensorId,
      timestamp,
      status: "ok",
      value,
      ...(unit === undefined ? {} : { unit }),
    };
  }
}
