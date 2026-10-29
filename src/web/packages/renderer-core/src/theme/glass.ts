/**
 * Authored glass treatment: one optional object property holding a backdrop
 * blur radius in artboard units. Absence means off and zero means no blur, so
 * an ordinary panel never carries the property at all.
 */

/** Persisted treatment property; Fabric JSON is the only place it is written. */
export const YUNARI_GLASS_PROPERTY = "yunariGlass";

/**
 * Measured bound, not a preference. Task 1's radius sweep held 2.5–3.7 ms per
 * frame across 0–64 px, with the cost first clearly rising at 128 px (6.44 ms),
 * so 48 sits inside the measured-flat band while still bounding the worst case.
 */
export const MAX_GLASS_BLUR_RADIUS = 48;

/** Whether a panel samples the background's live picture or its still. */
export type GlassSampling = "static" | "dynamic";

/**
 * The single authored field, plus how it samples. Everything else about a panel
 * stays native.
 */
export interface GlassTreatment {
  readonly blurRadius: number;
  /** `static` samples the background's declared frame — the picture an image
   *  background or a paint would give it — instead of following a video.
   *  Absent and `dynamic` are the same thing: the live picture. */
  readonly sampling?: GlassSampling;
}

/**
 * Object kinds that may carry the treatment, which is a property of the
 * geometry rather than a roster of class names: the frosted surface needs a
 * closed path to sample the backdrop through, and nothing else. Rounded and
 * square rectangles, the two curves, the two straight-edged primitives, and a
 * group — which Fabric gives no render boundary, so the treatment is refused
 * loudly at attach rather than composited.
 *
 * Polyline, Line and Path are absent, and that is geometry rather than taste:
 * an open path has no interior to sample, and a `Path` is arbitrary author data
 * whose closedness the product cannot know. Text, image and chart objects are
 * excluded on their own terms: they are not panels, and a blur behind a glyph
 * or a plotted series has no meaning. See
 * `docs/decisions/0015-glass-clips-any-closed-path-not-only-rects.md`.
 */
const GLASS_OBJECT_TYPES: ReadonlySet<string> = new Set([
  "Rect",
  "Circle",
  "Ellipse",
  "Triangle",
  "Polygon",
  "Wedge",
  "Group",
]);

/**
 * The kinds a published theme may carry the treatment on, in a stable order.
 * The schema drift guard compares against this list, so widening the vocabulary
 * without widening the published schema fails a test.
 */
export const GLASS_TYPES: readonly string[] = [...GLASS_OBJECT_TYPES];

/** Whether an object kind may carry the treatment at all. */
export function supportsGlass(type: string): boolean {
  return GLASS_OBJECT_TYPES.has(type);
}

/**
 * Read a validated treatment from a revived object, or `undefined` when the
 * property is absent or malformed. Trust boundary, not a repair path: a value
 * that fails here was already refused at import, and is treated as off here
 * rather than coerced to a default.
 *
 * Returns a copy: the property on a revived object is that object's own state,
 * and handing out the reference would let a caller that mutates what it read
 * rewrite the scene behind the validator's back.
 */
export function glassTreatment(object: {
  get(name: string): unknown;
}): GlassTreatment | undefined {
  const value = object.get(YUNARI_GLASS_PROPERTY);
  if (!isGlassTreatment(value)) return undefined;
  return {
    blurRadius: value.blurRadius,
    ...(value.sampling === undefined ? {} : { sampling: value.sampling }),
  };
}

/** Accepts only the authored shape: one finite radius inside the bound, and a
 *  sampling only while it is one of the two names. */
export function isGlassTreatment(value: unknown): value is GlassTreatment {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return false;
  const treatment = value as Record<string, unknown>;
  if (
    Object.keys(treatment).some(
      (key) => key !== "blurRadius" && key !== "sampling",
    )
  )
    return false;
  const radius = treatment["blurRadius"];
  if (
    typeof radius !== "number" ||
    !Number.isFinite(radius) ||
    radius < 0 ||
    radius > MAX_GLASS_BLUR_RADIUS
  )
    return false;
  const sampling = treatment["sampling"];
  return (
    sampling === undefined || sampling === "static" || sampling === "dynamic"
  );
}
