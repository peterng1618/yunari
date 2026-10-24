import {
  SEMANTIC_KEYS,
  type SemanticKeyDescriptor,
  UNIT_KINDS,
  type UnitKind,
  type ValueKind,
} from "./semantic-keys.js";

/**
 * What a host reports from `/api/sensors`, mapped onto the vocabulary.
 *
 * Shared so the player converts a provider's custom units the same way the
 * editor lists them. This module only parses: it never fetches, and a
 * malformed entry is dropped rather than thrown.
 */

/** The registry tags each entry with its provider; the picker does not need it. */
interface WireSensor {
  readonly semanticKey?: unknown;
  readonly label?: unknown;
  readonly tier?: unknown;
  readonly family?: unknown;
  readonly unit?: unknown;
  readonly unitKind?: unknown;
  readonly displayUnits?: unknown;
  readonly valueKind?: unknown;
  readonly mediaKind?: unknown;
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function valueKindOf(value: unknown): ValueKind | undefined {
  return value === "number" || value === "text" || value === "boolean"
    ? value
    : undefined;
}

/** The conversion kinds the vocabulary declares, imported rather than copied:
 *  a kind the renderer does not know is dropped, not cast. */
const UNIT_KIND_SET: ReadonlySet<string> = new Set(UNIT_KINDS);

/** Trusted-host shape, not a schema: the host is ours, and a malformed entry is
 *  dropped rather than crashing the picker. Every enumerated field is
 *  whitelisted, so a kind the renderer cannot honour reads as absent. */
function unitKindOf(value: unknown): UnitKind | undefined {
  return typeof value === "string" && UNIT_KIND_SET.has(value)
    ? (value as UnitKind)
    : undefined;
}

export function descriptorFromWire(
  entry: unknown,
): SemanticKeyDescriptor | undefined {
  if (typeof entry !== "object" || entry === null) return undefined;

  const wire = entry as WireSensor;
  const key = text(wire.semanticKey);
  const label = text(wire.label);

  if (key === undefined || label === undefined) return undefined;

  const family = text(wire.family) ?? key.split(".")[0] ?? "custom";
  const unit = text(wire.unit);
  const unitKind = unitKindOf(wire.unitKind);
  const valueKind = valueKindOf(wire.valueKind);
  const displayUnits = Array.isArray(wire.displayUnits)
    ? wire.displayUnits.filter(
        (unit): unit is string => typeof unit === "string",
      )
    : undefined;

  return {
    key,
    family,
    label,
    ...(unit === undefined ? {} : { unit }),
    ...(unitKind === undefined ? {} : { unitKind }),
    ...(displayUnits === undefined || displayUnits.length === 0
      ? {}
      : { displayUnits }),
    ...(valueKind === undefined ? {} : { valueKind }),
    ...(wire.mediaKind === "image" ? { mediaKind: "image" as const } : {}),
    expectedTier: wire.tier === "extended" ? "extended" : "baseline",
  };
}

/** Built-ins first and winning collisions: the vocabulary is the canonical spelling. */
export function descriptorsFromWire(
  sensors: readonly unknown[],
): readonly SemanticKeyDescriptor[] {
  const seen = new Set(SEMANTIC_KEYS.map((descriptor) => descriptor.key));
  const discovered: SemanticKeyDescriptor[] = [];

  for (const sensor of sensors) {
    const descriptor = descriptorFromWire(sensor);
    if (descriptor === undefined || seen.has(descriptor.key)) continue;
    seen.add(descriptor.key);
    discovered.push(descriptor);
  }

  return discovered.length === 0
    ? SEMANTIC_KEYS
    : [...SEMANTIC_KEYS, ...discovered];
}
