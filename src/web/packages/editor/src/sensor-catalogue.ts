import {
  SEMANTIC_KEYS,
  type SemanticKeyDescriptor,
  type UnitKind,
  type ValueKind,
} from "@yunari/renderer-core";

/**
 * The editor's readings: the built-in vocabulary, plus whatever the host
 * reports from `/api/sensors`.
 *
 * The editor is served from the host origin, so the request is same-origin. A
 * disconnected editor or a failed request is not an author-facing error: the
 * built-in table is a complete list of the keys the vocabulary names, and it
 * stays in place until a successful answer replaces it.
 */

export interface SensorCatalogue {
  descriptors(): readonly SemanticKeyDescriptor[];
  refresh(): Promise<void>;
}

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

/**
 * Trusted-host shape, not a schema: the host is ours, and a malformed entry is
 * dropped rather than crashing the picker. `unitKind` is the one field not
 * enumerated here — an unknown kind only means the renderer shows the reading
 * as measured, which is the same path a key without a conversion takes.
 */
function unitKindOf(value: unknown): UnitKind | undefined {
  return typeof value === "string" ? (value as UnitKind) : undefined;
}

function descriptorFromWire(entry: unknown): SemanticKeyDescriptor | undefined {
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
function mergeWithBuiltIns(
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

export function createSensorCatalogue(
  fetcher: typeof fetch = fetch,
): SensorCatalogue {
  let descriptors: readonly SemanticKeyDescriptor[] = SEMANTIC_KEYS;

  return {
    descriptors: () => descriptors,
    async refresh(): Promise<void> {
      try {
        const response = await fetcher("/api/sensors");
        if (!response.ok) return;

        const body: unknown = await response.json();
        const sensors = (body as { readonly sensors?: unknown } | null)
          ?.sensors;
        if (!Array.isArray(sensors)) return;

        descriptors = mergeWithBuiltIns(sensors);
      } catch {
        // A disconnected editor keeps the table it had.
      }
    },
  };
}
