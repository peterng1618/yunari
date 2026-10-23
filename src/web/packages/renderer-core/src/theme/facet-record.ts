import { parseHex } from "../charts/fill.js";
import {
  describeSemanticKey,
  type SemanticFamily,
} from "../data/semantic-keys.js";
import { resolveStyleValue } from "../scene/plan.js";
import type { FabricThemeEnvelope } from "./fabric-envelope.js";

/**
 * What a theme *is*, read off its envelope rather than authored into it.
 *
 * The store's five facets filter on these, and nothing here is stored in
 * `theme.json`: the host derives a library theme's record and a catalogue Action
 * derives a merged one's, so the record lives in the layer both can import and
 * stays free of Fabric and the DOM.
 */

export type ColourMode = "light" | "dark" | "unclassified";
export type Orientation = "landscape" | "portrait" | "square";
export type AspectBucket =
  | "1:1"
  | "4:3"
  | "3:2"
  | "16:10"
  | "16:9"
  | "19.5:9"
  | "21:9"
  | "32:9"
  | "4:1"
  | "other";

export interface FacetRecord {
  readonly author: string | undefined;
  readonly colourMode: ColourMode;
  readonly sensors: readonly {
    readonly key: string;
    readonly label: string;
    /** The family the vocabulary already files this key under, so a surface
     *  grouping sensors groups them the way `describeSemanticKey` does rather
     *  than by a second reading of the key. `undefined` for a key this build
     *  does not know, which has no family to be filed under. */
    readonly family: SemanticFamily | undefined;
  }[];
  /** The style tags the document declares, deduplicated and in its own order.
   *  Required and possibly empty: every record is derived from a document, so
   *  there is always an answer (docs/decisions/0087). */
  readonly tags: readonly string[];
  readonly orientation: Orientation;
  readonly aspect: AspectBucket;
  readonly width: number;
  readonly height: number;
}

/** A ground this module can read a lightness from; `undefined` is one it cannot. */
type Ground =
  | { readonly kind: "solid"; readonly color: string }
  | { readonly kind: "gradient"; readonly colors: readonly string[] };

/**
 * Perceptual lightness bounds. `L*` 50 is mid-grey, and a ground within ten
 * points of it is one where neither light nor dark text is clearly the readable
 * choice, so the honest reading there is the third value rather than a coin flip.
 */
const DARK_BELOW = 40;
const LIGHT_ABOVE = 60;

/** CIE `L*`'s own constants: below `EPSILON` the transfer is linear. */
const EPSILON = 216 / 24389;
const KAPPA = 24389 / 27;

/** The bucket union, spelled out: a member added above without its entry here
    fails to compile. The test holds the other direction — every entry here has
    a row in `ASPECT_BUCKETS`, which is the array `aspectOf` actually reads. */
export const PUBLISHED_BUCKETS = {
  "1:1": true,
  "4:3": true,
  "3:2": true,
  "16:10": true,
  "16:9": true,
  "19.5:9": true,
  "21:9": true,
  "32:9": true,
  "4:1": true,
} satisfies Record<Exclude<AspectBucket, "other">, true>;

/** The published buckets, as `max/min` ratios so a portrait artboard reads its
    landscape inversion's label — the comparison treats 16:9 and 9:16 as one.
    Ascending order is load-bearing: `aspectOf` returns the first match. */
export const ASPECT_BUCKETS: readonly {
  readonly bucket: AspectBucket;
  readonly ratio: number;
}[] = [
  { bucket: "1:1", ratio: 1 },
  { bucket: "4:3", ratio: 4 / 3 },
  { bucket: "3:2", ratio: 3 / 2 },
  { bucket: "16:10", ratio: 16 / 10 },
  { bucket: "16:9", ratio: 16 / 9 },
  { bucket: "19.5:9", ratio: 19.5 / 9 },
  { bucket: "21:9", ratio: 21 / 9 },
  { bucket: "32:9", ratio: 32 / 9 },
  { bucket: "4:1", ratio: 4 },
];

/**
 * 0.5% in log space, which is the largest tolerance that keeps a 2.35:1 artboard
 * out of 21:9 (0.7% from it) while every real display stays inside: 1920×1080 and
 * 2560×1440 are exactly 16:9, 1920×1200 exactly 16:10, 1366×768 0.05% from 16:9.
 * A theme past it is `other` rather than the nearest wrong bucket, because a facet
 * that files 2.35:1 under 21:9 lies about the thing it exists to filter.
 */
const ASPECT_TOLERANCE = 0.005;

/** Derives the record from the envelope alone. */
export function facetRecordOf(envelope: FabricThemeEnvelope): FacetRecord {
  return {
    author: envelope.metadata?.author,
    colourMode: colourModeOf(envelope),
    sensors: sensorsOf(envelope),
    tags: tagsOf(envelope),
    orientation: orientationOf(
      envelope.artboard.width,
      envelope.artboard.height,
    ),
    aspect: aspectOf(envelope.artboard.width, envelope.artboard.height),
    width: envelope.artboard.width,
    height: envelope.artboard.height,
  };
}

/** The document's own tags, deduplicated in the order they were written: a
    repeat is well-formed (the format's rule is shape and count), so the collapse
    belongs to the facet that would otherwise offer one value twice. */
function tagsOf(envelope: FabricThemeEnvelope): string[] {
  return [...new Set(envelope.metadata?.tags ?? [])];
}

/**
 * Media behind the board is a ground this cannot read whatever the paint says,
 * and a reference is resolved the document's own way (`resolveStyleValue`) rather
 * than by a second resolver. A reference nothing declares resolves to
 * `undefined`, which is the same absence as no ground at all.
 */
function groundOf(envelope: FabricThemeEnvelope): Ground | undefined {
  if (envelope.background?.media !== undefined) return undefined;

  const resolved = resolveStyleValue(
    envelope.background?.color,
    envelope.globals ?? {},
    "background",
    [],
  );
  if (typeof resolved === "string") return { kind: "solid", color: resolved };
  if (typeof resolved !== "object" || resolved === null) return undefined;

  const paint = resolved as {
    readonly kind?: unknown;
    readonly color?: unknown;
    readonly stops?: unknown;
  };
  if (paint.kind === "solid" && typeof paint.color === "string") {
    return { kind: "solid", color: paint.color };
  }
  if (paint.kind !== "gradient" || !Array.isArray(paint.stops)) {
    return undefined;
  }

  const colors: string[] = [];
  for (const stop of paint.stops as readonly { readonly color?: unknown }[]) {
    if (typeof stop?.color !== "string") return undefined;
    colors.push(stop.color);
  }
  return colors.length === 0 ? undefined : { kind: "gradient", colors };
}

function colourModeOf(envelope: FabricThemeEnvelope): ColourMode {
  const ground = groundOf(envelope);
  if (ground === undefined) return "unclassified";

  const lightness = groundLightness(ground);
  if (lightness === undefined) return "unclassified";
  if (lightness < DARK_BELOW) return "dark";
  if (lightness > LIGHT_ABOVE) return "light";
  return "unclassified";
}

/** A gradient's stops are averaged in `L*`, not in luminance: the mean of the
    luminances would call a black-to-white ground light. */
function groundLightness(ground: Ground): number | undefined {
  if (ground.kind === "solid") return lightnessOf(ground.color);

  let total = 0;
  for (const color of ground.colors) {
    const lightness = lightnessOf(color);
    if (lightness === undefined) return undefined;
    total += lightness;
  }
  return total / ground.colors.length;
}

/** WCAG relative luminance through CIE `L*`: 0 is black, 100 is white. */
function lightnessOf(color: string): number | undefined {
  const rgb = parseHex(color);
  if (rgb === undefined) return undefined;

  const [red, green, blue] = rgb;
  const luminance =
    0.2126 * linearise(red / 255) +
    0.7152 * linearise(green / 255) +
    0.0722 * linearise(blue / 255);
  const transfer =
    luminance > EPSILON ? Math.cbrt(luminance) : (KAPPA * luminance + 16) / 116;
  return 116 * transfer - 16;
}

function linearise(channel: number): number {
  return channel <= 0.03928
    ? channel / 12.92
    : ((channel + 0.055) / 1.055) ** 2.4;
}

function orientationOf(width: number, height: number): Orientation {
  if (width === height) return "square";
  return width > height ? "landscape" : "portrait";
}

function aspectOf(width: number, height: number): AspectBucket {
  if (!(width > 0) || !(height > 0)) return "other";

  const ratio = Math.max(width, height) / Math.min(width, height);
  for (const { bucket, ratio: target } of ASPECT_BUCKETS) {
    if (Math.abs(Math.log(ratio / target)) <= ASPECT_TOLERANCE) return bucket;
  }
  return "other";
}

/** Every key the theme binds, deduplicated, in the order they first appear. A key
    this build's vocabulary does not know is still listed, labelled by its own key
    and with no family — the vocabulary's own answer, and not a family invented
    for it. */
function sensorsOf(
  envelope: FabricThemeEnvelope,
): { key: string; label: string; family: SemanticFamily | undefined }[] {
  const seen = new Set<string>();
  const sensors: {
    key: string;
    label: string;
    family: SemanticFamily | undefined;
  }[] = [];

  for (const list of Object.values(envelope.bindings ?? {})) {
    for (const binding of list) {
      if (seen.has(binding.semanticKey)) continue;
      seen.add(binding.semanticKey);
      const descriptor = describeSemanticKey(binding.semanticKey);
      sensors.push({
        key: binding.semanticKey,
        // Not `labelForSemanticKey`, which reads `BY_KEY` alone and so hands a
        // disk key (`disk.<id>.<quantity>`) back raw: the descriptor resolves
        // that key through `describeDiskKey` and carries the real label.
        label: descriptor?.label ?? binding.semanticKey,
        family: descriptor?.family,
      });
    }
  }
  return sensors;
}
