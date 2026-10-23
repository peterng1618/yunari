import {
  describeSemanticKey,
  instantIn,
  type SampleEntry,
} from "@yunari/renderer-core";
import type {
  ProviderHealth,
  SensorDescriptor,
  SensorProvider,
} from "./provider.js";
import { descriptorFieldsOf } from "./provider.js";

/**
 * Time and date as readings.
 *
 * The starter theme's clock was authored literal text, so it looked like a clock
 * and was not one. Deriving the time in the browser would be simpler, but the
 * time a dashboard shows should be this PC's: two displays then agree, and a
 * phone with a wrong clock still shows the right time (§116 puts acquisition on
 * the PC).
 *
 * What this sends is an instant, not a finished string. How a clock *reads* is
 * design, so the author's binding formats it; duplicating that here would take
 * the choice away and put a format where a reading belongs.
 */

const CLOCK_PROVIDER_ID = "clock";

const CLOCK_KEYS = ["time.now", "date.today"] as const;

export const CLOCK_DESCRIPTORS: readonly SensorDescriptor[] = CLOCK_KEYS.map(
  (key) => {
    const declared = describeSemanticKey(key);

    if (declared === undefined) {
      throw new Error(`${key} is not in the semantic key vocabulary`);
    }

    return {
      sensorId: `${CLOCK_PROVIDER_ID}:${key}`,
      semanticKey: key,
      label: declared.label,
      ...descriptorFieldsOf(declared),
      tier: "baseline" as const,
    };
  },
);

export class ClockSensorProvider implements SensorProvider {
  readonly id = CLOCK_PROVIDER_ID;
  readonly label = "Clock (baseline)";
  #timeZone: string | undefined;

  /** The zone this PC's time is read in, once a consumer has chosen one. */
  setTimeZone(timeZone: string | undefined): void {
    this.#timeZone = timeZone;
  }

  async describe(): Promise<readonly SensorDescriptor[]> {
    return CLOCK_DESCRIPTORS;
  }

  async sample(
    semanticKeys: readonly string[],
    nowMs: number,
  ): Promise<readonly SampleEntry[]> {
    const wanted = CLOCK_KEYS.filter((key) => semanticKeys.includes(key));

    if (wanted.length === 0) {
      return [];
    }

    const timestamp = new Date(nowMs).toISOString();
    // Both keys carry the same instant; the author's format and zone decide what
    // each shows, so a clock and a date need no different provider.
    const value = instantIn(nowMs, this.#timeZone);

    return wanted.map((key) => ({
      semanticKey: key,
      sample: {
        sensorId: `${CLOCK_PROVIDER_ID}:${key}`,
        timestamp,
        status: "ok",
        textValue: value,
      },
    }));
  }

  health(): ProviderHealth {
    return { available: true };
  }
}
