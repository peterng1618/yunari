import type { Capability } from "./capabilities";
import { type ExecutionProfile, publisherOf } from "./manifest";

/**
 * What the user agreed to when a plugin was installed, kept apart from the
 * manifest so a hand-edited or re-published plugin cannot ride an old grant.
 *
 * The binding names every input that can widen what the plugin does: its
 * content, the profile it executes at, the capabilities, contributions and
 * devices it asks for, and the publisher segment of its qualified key.
 */
export const CONSENT_SCHEMA_TAG = "yunari-extension-consent-v1";

export interface ConsentBinding {
  readonly schemaTag: typeof CONSENT_SCHEMA_TAG;
  readonly pluginApi: 1;
  readonly pluginKey: string;
  readonly version: string;
  readonly contentHash: string;
  readonly execution: ExecutionProfile;
  readonly capabilities: readonly Capability[];
  readonly contributions: readonly string[];
  readonly devices: readonly string[];
}

export interface ConsentRecord {
  readonly pluginKey: string;
  readonly version: string;
  readonly fingerprint: string;
  readonly grantedAt: string;
}

export interface ConsentFile {
  readonly version: 1;
  readonly plugins: Readonly<Record<string, ConsentRecord>>;
}

/**
 * Array order differs between otherwise equal strings, and comparing UTF-16
 * code units orders astral characters before the BMP range above them. The
 * lists below are sorted by code point so one grant has one representation.
 */
function compareCodePoints(left: string, right: string): number {
  const a = [...left];
  const b = [...right];
  const shared = Math.min(a.length, b.length);

  for (let index = 0; index < shared; index += 1) {
    const difference =
      (a[index] as string).codePointAt(0)! -
      (b[index] as string).codePointAt(0)!;
    if (difference !== 0) return difference;
  }

  return a.length - b.length;
}

function sorted(values: readonly string[]): readonly string[] {
  return [...values].sort(compareCodePoints);
}

/**
 * A JSON value with object keys sorted at every depth; arrays keep their order.
 * Two bindings print the same bytes here exactly when they mean the same grant,
 * which is what the fingerprint hashes.
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? "null";
  }

  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }

  const record = value as Readonly<Record<string, unknown>>;
  const entries: string[] = [];

  for (const key of Object.keys(record).sort(compareCodePoints)) {
    const entry = record[key];
    if (entry === undefined) continue;
    entries.push(`${JSON.stringify(key)}:${canonicalJson(entry)}`);
  }

  return `{${entries.join(",")}}`;
}

/** `yc1-` over the canonical binding's SHA-256, lowercase hex. */
export async function consentFingerprint(
  binding: ConsentBinding,
): Promise<string> {
  const canonical = canonicalJson({
    ...binding,
    capabilities: sorted(binding.capabilities),
    contributions: sorted(binding.contributions),
    devices: sorted(binding.devices),
  });
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(canonical),
  );
  const hex = [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");

  return `yc1-${hex}`;
}

/**
 * A data or declarative plugin runs no code of its own, so it asks for nothing.
 * Everything else is executable, including a profile added after this build:
 * consent fails closed on profiles this function does not know.
 */
export function consentRequired(execution: ExecutionProfile): boolean {
  return execution !== "data" && execution !== "declarative";
}

export function consentMatches(
  record: ConsentRecord | undefined,
  fingerprint: string,
): boolean {
  return record !== undefined && record.fingerprint === fingerprint;
}

function added(
  previous: readonly string[],
  next: readonly string[],
  prefix: string,
): readonly string[] {
  const before = new Set(previous);
  return sorted(next.filter((value) => !before.has(value))).map(
    (value) => `${prefix}${value}`,
  );
}

/**
 * What the next binding adds to the previous one, in the order a consent
 * prompt reads it: the profile, then each capability, contribution and device,
 * then the publisher that now signs the plugin. Removed access is not growth,
 * and an unchanged binding grows nothing.
 */
export function accessGrowth(
  previous: ConsentBinding,
  next: ConsentBinding,
): readonly string[] {
  const growth: string[] = [];

  if (previous.execution !== next.execution) growth.push("profile");
  growth.push(
    ...added(previous.capabilities, next.capabilities, "capability:"),
  );
  growth.push(
    ...added(previous.contributions, next.contributions, "contribution:"),
  );
  growth.push(...added(previous.devices, next.devices, "device:"));
  if (publisherOf(previous.pluginKey) !== publisherOf(next.pluginKey))
    growth.push("publisher");

  return growth;
}
