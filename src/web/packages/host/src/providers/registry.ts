import type { SampleEntry } from "@yunari/renderer-core";
import type { DeviceAssignment } from "./lhm-mapping.js";
import type {
  SampleContext,
  SensorDescriptor,
  SensorProvider,
} from "./provider.js";

/** Scheduler: polls the requested-key union once and isolates provider failures. */

export interface ProviderFailure {
  readonly providerId: string;
  /** May reach a browser; keep redacted. */
  readonly message: string;
}

export interface SampleCycle {
  readonly entries: readonly SampleEntry[];
  readonly failures: readonly ProviderFailure[];
  /** Requested keys no provider answered. */
  readonly unmapped: readonly string[];
}

export interface DescribedSensor extends SensorDescriptor {
  readonly providerId: string;
}

/** Stable sorted union of keys requested by active clients. */
export function unionOfKeys(
  perClientKeys: Iterable<readonly string[]>,
): readonly string[] {
  const union = new Set<string>();

  for (const keys of perClientKeys) {
    for (const key of keys) {
      union.add(key);
    }
  }

  return [...union].sort();
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** One display's ask: what its connections want, and the devices and language
 *  it resolved to. */
export interface DisplayAsk {
  readonly display: string;
  readonly semanticKeys: readonly string[];
  readonly assignment: DeviceAssignment;
  readonly language?: string;
}

/** One distinct assignment and language, and every display that resolved to it. */
export interface AskGroup {
  readonly assignment: DeviceAssignment;
  readonly semanticKeys: readonly string[];
  readonly language?: string;
  readonly displays: readonly string[];
}

/**
 * One group per distinct assignment and language, so two displays holding the
 * same devices cost one poll rather than two: a poll is this PC's work, and the
 * devices are what it reads, not the screens. The language is part of the key
 * because it changes the words a provider puts beside those readings, and one
 * poll has one answer.
 *
 * Keyed by both parts: the assignment's own JSON, a NUL separator, and the
 * language. `currentAssignment` builds the assignment in one shape, so two
 * displays that resolved the same devices serialize alike. The keys are unioned,
 * as they were across every connection before.
 */
export function groupByAsk(asks: readonly DisplayAsk[]): readonly AskGroup[] {
  const groups = new Map<
    string,
    {
      assignment: DeviceAssignment;
      language: string | undefined;
      keys: Set<string>;
      displays: string[];
    }
  >();

  for (const ask of asks) {
    const key =
      JSON.stringify(ask.assignment) + "\u0000" + (ask.language ?? "");
    const group = groups.get(key);

    if (group === undefined) {
      groups.set(key, {
        assignment: ask.assignment,
        language: ask.language,
        keys: new Set(ask.semanticKeys),
        displays: [ask.display],
      });
      continue;
    }

    for (const semanticKey of ask.semanticKeys) group.keys.add(semanticKey);
    group.displays.push(ask.display);
  }

  return [...groups.values()].map((group) => ({
    assignment: group.assignment,
    semanticKeys: [...group.keys].sort(),
    ...(group.language === undefined ? {} : { language: group.language }),
    displays: group.displays,
  }));
}

export class ProviderRegistry {
  /** Providers are ordered by precedence; the first provider to answer a key owns it. */
  constructor(private readonly providers: readonly SensorProvider[]) {}

  async describe(): Promise<readonly DescribedSensor[]> {
    const settled = await Promise.allSettled(
      this.providers.map(async (provider) => {
        const descriptors = await provider.describe();

        return descriptors.map((descriptor) => ({
          ...descriptor,
          providerId: provider.id,
        }));
      }),
    );

    return settled.flatMap((result) =>
      result.status === "fulfilled" ? result.value : [],
    );
  }

  /**
   * Polls providers concurrently and preserves successful results when another
   * fails. `context` carries the devices resolved for the display this cycle
   * answers, and that display's language, passed through to every provider.
   */
  async sample(
    semanticKeys: readonly string[],
    nowMs: number,
    context?: SampleContext,
  ): Promise<SampleCycle> {
    if (semanticKeys.length === 0) {
      return { entries: [], failures: [], unmapped: [] };
    }

    const settled = await Promise.allSettled(
      this.providers.map((provider) =>
        provider.sample(semanticKeys, nowMs, context),
      ),
    );

    const entries: SampleEntry[] = [];
    const failures: ProviderFailure[] = [];
    const claimed = new Set<string>();
    /** Samples every provider returned, `ok` or not, in precedence order. */
    const returned: SampleEntry[] = [];

    settled.forEach((result, index) => {
      const provider = this.providers[index];

      if (provider === undefined) {
        return;
      }

      if (result.status === "rejected") {
        failures.push({
          providerId: provider.id,
          message: describeError(result.reason),
        });
        return;
      }

      for (const entry of result.value) {
        returned.push(entry);

        // Keep the earliest provider's answer for each semantic key. A
        // non-`ok` sample does not claim the key, so a later provider with the
        // same sensor can still answer it (§97's fallback).
        if (entry.sample.status !== "ok" || claimed.has(entry.semanticKey)) {
          continue;
        }

        claimed.add(entry.semanticKey);
        entries.push(entry);
      }
    });

    // A key no provider measured still needs a sample, or a display cannot tell
    // "no reading yet" from "nothing reports this". The earliest gap wins, so a
    // specific reason from the preferred provider is the one shown.
    const gap = new Set<string>();

    for (const entry of returned) {
      if (
        claimed.has(entry.semanticKey) ||
        gap.has(entry.semanticKey) ||
        !semanticKeys.includes(entry.semanticKey)
      ) {
        continue;
      }

      gap.add(entry.semanticKey);
      entries.push(entry);
    }

    return {
      entries,
      failures,
      unmapped: semanticKeys.filter(
        (key) => !claimed.has(key) && !gap.has(key),
      ),
    };
  }
}
