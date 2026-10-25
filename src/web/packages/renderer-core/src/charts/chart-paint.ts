import type { FabricPalette } from "../theme/fabric-envelope.js";
import type { Fill, GradientStop } from "../types.js";

/** Persisted chart paint: a palette token, or threshold bands of solid tokens. */
export type ChartPaint =
  | Fill
  | { readonly ref: string }
  | {
      readonly kind: "thresholds";
      readonly bands: readonly {
        readonly offset: number;
        readonly ref: string;
      }[];
    };

/**
 * Resolve token references at the renderer boundary; persisted settings retain
 * refs. `undefined` is a `palette.` reference with no entry: the paint is
 * unavailable, and no builder may substitute a colour it did not resolve
 * (`resolveStyleValue` already rules for the rest of the document — 0007).
 */
export function resolveChartPaint(
  paint: ChartPaint,
  palette: FabricPalette | undefined,
): Fill | undefined {
  if ("ref" in paint) return paletteFill(paint.ref, palette);
  if (
    paint.kind !== "thresholds" ||
    paint.bands.length === 0 ||
    !("ref" in paint.bands[0]!)
  )
    return paint as Fill;
  const colors = paint.bands.map((band) =>
    solidColor("ref" in band ? band.ref : "", palette),
  );
  // One band with no colour would be a threshold the author never wrote, so
  // the whole fill goes rather than renumbering the bands around it.
  if (colors.some((color) => color === undefined)) return undefined;
  return {
    kind: "thresholds",
    bands: paint.bands.map((band, index) => ({
      offset: band.offset,
      color: colors[index]!,
    })),
  };
}

/**
 * The engine's own "draw nothing", for a paint that is not the value — a track,
 * a remainder, a slice whose colour failed to resolve. A value mark never uses
 * it: it drops the value instead (0007).
 */
export const NO_INK = "transparent";
export const NO_PAINT: Fill = { kind: "solid", color: NO_INK };

/**
 * Every token reference an authored settings bag carries, however deep.
 *
 * Paint fields are the only place a chart names a token, and their shape differs
 * by family, so this walk is the one rule that covers all of them without a
 * second list to keep in step.
 */
export function chartPaintReferences(value: unknown): readonly string[] {
  const refs = new Set<string>();
  collectReferences(value, refs);
  return [...refs].sort();
}

function collectReferences(value: unknown, into: Set<string>): void {
  if (Array.isArray(value)) {
    for (const entry of value) collectReferences(entry, into);
    return;
  }
  if (typeof value !== "object" || value === null) return;
  for (const [key, entry] of Object.entries(value)) {
    if (key === "ref" && typeof entry === "string") into.add(entry);
    else collectReferences(entry, into);
  }
}

/** Reassign token references without touching engine-only resolved fills. */
export function reassignChartPaintReferences<T>(
  value: T,
  from: string,
  to: string,
): T {
  if (Array.isArray(value)) {
    const next = value.map((entry) =>
      reassignChartPaintReferences(entry, from, to),
    );
    return next.some((entry, index) => entry !== value[index])
      ? (next as T)
      : value;
  }
  if (typeof value !== "object" || value === null) return value;
  const record = value as Record<string, unknown>;
  if (record["ref"] === from) return { ...record, ref: to } as T;
  const entries = Object.entries(record).map(
    ([key, entry]) =>
      [key, reassignChartPaintReferences(entry, from, to)] as const,
  );
  return entries.some(([key, entry]) => entry !== record[key])
    ? (Object.fromEntries(entries) as T)
    : value;
}

function paletteFill(
  ref: string,
  palette: FabricPalette | undefined,
): Fill | undefined {
  const value = token(ref, palette)?.value;
  if (value?.kind === "solid") return { kind: "solid", color: value.color };
  if (value?.kind === "gradient")
    return { kind: "gradient", stops: value.stops };
  return undefined;
}

function solidColor(
  ref: string,
  palette: FabricPalette | undefined,
): string | undefined {
  const value = token(ref, palette)?.value;
  return value?.kind === "solid" ? value.color : undefined;
}

function token(
  ref: string,
  palette: FabricPalette | undefined,
):
  | {
      readonly value:
        | { readonly kind: "solid"; readonly color: string }
        | {
            readonly kind: "gradient";
            readonly stops: readonly GradientStop[];
          };
    }
  | undefined {
  if (!ref.startsWith("palette.")) return undefined;
  const entry = palette?.[ref.slice("palette.".length)];
  if (entry === undefined) return undefined;
  return entry as never;
}
