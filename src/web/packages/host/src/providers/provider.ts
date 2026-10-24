import type {
  SampleEntry,
  SemanticKeyDescriptor,
  SensorTier,
  UnitKind,
  ValueKind,
} from "@yunari/renderer-core";
import type { DeviceAssignment } from "./lhm-mapping.js";

/** Provider boundary: providers acquire; the host schedules and owns history. */

export type { SensorTier };

/** What a provider can read on this machine. */
export interface SensorDescriptor {
  /** Provider-local stable identity. Never derive identity from tree/array position. */
  readonly sensorId: string;
  /** Semantic key themes bind to. */
  readonly semanticKey: string;
  readonly label: string;
  readonly unit?: string;
  readonly tier: SensorTier;
  /** Picker grouping; a provider may contribute a family of its own. */
  readonly family?: string;
  /** The conversion contract the vocabulary declares for this key. */
  readonly unitKind?: UnitKind;
  /** Display units a binding may pin, besides `unit`. */
  readonly displayUnits?: readonly string[];
  readonly valueKind?: ValueKind;
  /** The binding renders an image URL rather than a value. */
  readonly mediaKind?: "image";
}

/**
 * The descriptive half of a vocabulary entry, as every shipped provider
 * forwards it. One spelling rather than three maps repeating the same six
 * conditional spreads.
 */
export function descriptorFieldsOf(
  declared: SemanticKeyDescriptor,
): Pick<
  SensorDescriptor,
  "family" | "unit" | "unitKind" | "displayUnits" | "valueKind" | "mediaKind"
> {
  return {
    family: declared.family,
    ...(declared.unit === undefined ? {} : { unit: declared.unit }),
    ...(declared.unitKind === undefined ? {} : { unitKind: declared.unitKind }),
    ...(declared.displayUnits === undefined
      ? {}
      : { displayUnits: declared.displayUnits }),
    ...(declared.valueKind === undefined
      ? {}
      : { valueKind: declared.valueKind }),
    ...(declared.mediaKind === undefined
      ? {}
      : { mediaKind: declared.mediaKind }),
  };
}

/** Current provider availability; messages may reach a browser and must be redacted. */
export interface ProviderHealth {
  readonly available: boolean;
  readonly message?: string;
}

/**
 * Where something is, in the forms a provider's own errors arrive in: a URL
 * (LHM's base, a redirect, a signed URL), a dotted quad with a port,
 * `localhost` with one, and a filesystem path (`systeminformation` shells out
 * and quotes what it ran). A path is as machine-identifying as a port, and both
 * are the host's business rather than the reader's.
 *
 * Deliberately not a bare `host:port` — the dashboard's own vocabulary is
 * `2340:1080` and `19.5:9`, and a redactor that ate those would change what a
 * theme says. The player's net already draws the URL half of this line
 * (`availability-notice.ts`), including its care that a URL match may not end
 * on a colon: a reason reads `... at http://host:8085: fetch failed` and that
 * colon is the sentence's. This is the same line, one layer earlier, covering
 * the paths it never saw.
 */
const ADDRESS =
  /(?<![a-z\d])(?:[a-z][a-z\d+.-]*:\/\/[^\s]*[^\s:]|(?:\d{1,3}\.){3}\d{1,3}:\d{2,5}|localhost:\d{2,5}|[a-z]:\\[^\s:]*|\/[\w.-]+(?:\/[\w.-]+)*)/gi;

/**
 * A reason a display may show: the words, without the address.
 *
 * A provider's `message` travels to a browser — over the sample stream to
 * every display on the network, and through `ProviderHealth` — and the string
 * it quotes was written by undici, by `systeminformation`, by a JSON parser.
 * Those carry what they had: a transport address, a path, a command line. The
 * words around them are the diagnostic, and they stay.
 *
 * The replacement is the phrase the player already substitutes, so a message
 * that reached a display through the net reads the same as one the host has
 * already cleaned. One wording, two layers.
 */
export function redactForBrowser(reason: string): string {
  return (
    reason
      .replace(ADDRESS, "its configured address")
      // A reason is a line on a fixed strip, not a log. An unbounded third-party
      // string is how one line becomes a paragraph nobody reads.
      .slice(0, 120)
      .replace(/\s+/g, " ")
      .trim()
  );
}

export interface SensorProvider {
  /** Stable provider id and sensor-id prefix. */
  readonly id: string;
  readonly label: string;

  describe(): Promise<readonly SensorDescriptor[]>;

  /**
   * Reads requested keys only. Unsupported/unavailable values are omitted or
   * non-ok, never zero.
   *
   * The assignment is the one resolved for the display this sample is for, so
   * a provider answers for the screen that asked rather than for whichever
   * screen was served last. The language is the one that display's connections
   * last declared; a provider that renders words uses it, and one that renders
   * numbers ignores it. Omitted by a caller with no display.
   */
  sample(
    semanticKeys: readonly string[],
    nowMs: number,
    context?: SampleContext,
  ): Promise<readonly SampleEntry[]>;

  health(): ProviderHealth;
}

/** What a sample is for: the display's devices, and the language it reads. */
export interface SampleContext {
  readonly assignment?: DeviceAssignment;
  readonly language?: string;
}
