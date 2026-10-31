import {
  type DisplayPresentation,
  type DisplayShape,
  rotationAllowed,
  snapRotation as snapByRule,
} from "@yunari/renderer-core";

/**
 * A presentation a display cannot hold, refused with the store's own words.
 *
 * A type rather than a message, because the routes have to *answer* it: a shape
 * or angle the store would refuse is the caller's typo (400), not a host fault
 * (500), and a silent default would render a theme nobody asked for.
 */
export class DisplaySettingError extends Error {}

/**
 * A whole mounting angle, `0..360` with `360` left as the full turn it is.
 *
 * The wrap to upright belongs to the shape's rule, not here: only a circle
 * normalises `360` to `0`, and a rectangle accepts `0/90/180/270` exactly.
 * Whole degrees only, because the record stores what a person set and a fraction
 * is a request the control cannot reproduce.
 */
export function wholeDegrees(value: unknown): number {
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < 0 ||
    value > 360
  ) {
    throw new DisplaySettingError(
      `A display rotation must be a whole number of degrees from 0 to 360, not ${String(value)}.`,
    );
  }

  return value;
}

export function displayShape(value: unknown): DisplayShape {
  if (value !== "rect" && value !== "circle") {
    throw new DisplaySettingError(
      `A display shape must be "rect" or "circle", not ${String(value)}.`,
    );
  }

  return value;
}

/** Where a stored angle lands once a shape's rule is applied to it. The rule is
 *  renderer-core's, which owns the transform that consumes the angle. */
export function snapRotation(shape: DisplayShape, rotation: number): number {
  return snapByRule(shape, rotation);
}

/**
 * The presentation a write may store, or a refusal in the store's own words.
 *
 * The one rule for every write — a claim, a local monitor, a patch — so no route
 * can store a record this file's reader would drop on the next start. Absent
 * shape is rectangular and absent rotation is upright; an unknown shape is
 * refused rather than defaulted, and a rectangle turns in quarters only.
 */
export function normalizePresentation(
  shape: unknown,
  rotation: unknown,
): DisplayPresentation {
  const resolved = shape === undefined ? "rect" : displayShape(shape);

  if (rotation === undefined) return { shape: resolved };

  const degrees = wholeDegrees(rotation);

  // The rectangle's set is exact, checked before any wrap: 360 is a full turn,
  // not a quarter, and normalising it to 0 first would silently store upright.
  // `rotationAllowed` is the one owner of that set (`vg-760`).
  if (resolved === "rect" && !rotationAllowed(resolved, degrees)) {
    throw new DisplaySettingError(
      `A rectangular display turns in quarter turns, not ${String(rotation)} degrees.`,
    );
  }

  const angle = resolved === "circle" ? degrees % 360 : degrees;

  return { shape: resolved, ...(angle === 0 ? {} : { rotation: angle }) };
}

/** A stored angle the shape can hold, or nothing — the record then plays upright. */
export function storedRotation(
  shape: DisplayShape,
  value: unknown,
): number | undefined {
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value <= 0 ||
    value >= 360
  ) {
    return undefined;
  }

  return shape === "rect" && value % 90 !== 0 ? undefined : value;
}
