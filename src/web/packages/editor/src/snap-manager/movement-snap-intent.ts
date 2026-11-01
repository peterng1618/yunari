import type { ObjectBounds } from "./bounds.js";
import type {
  MovementGestureBaseline,
  MovementRawIntent,
  MovementTargetPosition,
} from "./movement-snapping-resolver.js";

/** Tolerance for comparing centres inside exact bounds. */
export const EXACT_BOUNDS_CENTER_EPSILON = 0.000000001;

/** Validates and copies the dragged object's exact bounds. */
export function createExactBoundsSnapshot({
  bounds,
}: {
  bounds: ObjectBounds;
}): ObjectBounds {
  const { left, right, top, bottom, centerX, centerY } = bounds;
  const values = [left, right, top, bottom, centerX, centerY];
  if (!values.every(Number.isFinite) || right < left || bottom < top) {
    throw new Error(
      "Movement snapping bounds must contain finite ordered values",
    );
  }

  const expectedCenterX = left + (right - left) / 2;
  const expectedCenterY = top + (bottom - top) / 2;
  if (
    Math.abs(centerX - expectedCenterX) > EXACT_BOUNDS_CENTER_EPSILON ||
    Math.abs(centerY - expectedCenterY) > EXACT_BOUNDS_CENTER_EPSILON
  ) {
    throw new Error(
      "Movement snapping bounds centers must be derived from its edges",
    );
  }

  return Object.freeze({ left, right, top, bottom, centerX, centerY });
}

/** Validates and copies the Fabric target's position. */
export function createPositionSnapshot({
  position,
}: {
  position: MovementTargetPosition;
}): MovementTargetPosition {
  if (!Number.isFinite(position.left) || !Number.isFinite(position.top)) {
    throw new Error(
      "Movement snapping target position must contain finite coordinates",
    );
  }

  return Object.freeze({
    left: position.left,
    top: position.top,
  });
}

/** Translates exact bounds by the computed delta without rounding. */
export function translateBounds({
  bounds,
  deltaX,
  deltaY,
}: {
  bounds: ObjectBounds;
  deltaX: number;
  deltaY: number;
}): ObjectBounds {
  return Object.freeze({
    left: bounds.left + deltaX,
    right: bounds.right + deltaX,
    top: bounds.top + deltaY,
    bottom: bounds.bottom + deltaY,
    centerX: bounds.centerX + deltaX,
    centerY: bounds.centerY + deltaY,
  });
}

/** Compares exact coordinates, not rounded display values. */
export function areNumbersNear(first: number, second: number): boolean {
  return Math.abs(first - second) <= EXACT_BOUNDS_CENTER_EPSILON;
}

/** Ensures width and height are unchanged during the translation. */
export function areBoundsDimensionsEqual({
  first,
  second,
  epsilon,
}: {
  first: ObjectBounds;
  second: ObjectBounds;
  epsilon: number;
}): boolean {
  const firstWidth = first.right - first.left;
  const firstHeight = first.bottom - first.top;
  const secondWidth = second.right - second.left;
  const secondHeight = second.bottom - second.top;

  return (
    Math.abs(firstWidth - secondWidth) <= epsilon &&
    Math.abs(firstHeight - secondHeight) <= epsilon
  );
}

/** Validates and copies the raw intent before any target mutation. */
export function createRawIntentSnapshot({
  intent,
}: {
  intent: MovementRawIntent;
}): MovementRawIntent {
  return Object.freeze({
    bounds: createExactBoundsSnapshot({ bounds: intent.bounds }),
    position: createPositionSnapshot({ position: intent.position }),
    axes: Object.freeze({
      x: intent.axes.x,
      y: intent.axes.y,
    }),
    modifiers: Object.freeze({
      ctrlKey: intent.modifiers.ctrlKey,
    }),
  });
}

/** Ensures the Fabric drag preserved geometry and produced a clean translation. */
export function assertRawIntentMatchesBaseline({
  baseline,
  intent,
}: {
  baseline: MovementGestureBaseline;
  intent: MovementRawIntent;
}): void {
  const expectedBounds = translateBounds({
    bounds: baseline.bounds,
    deltaX: intent.position.left - baseline.position.left,
    deltaY: intent.position.top - baseline.position.top,
  });
  const edges: readonly (keyof ObjectBounds)[] = [
    "left",
    "centerX",
    "right",
    "top",
    "centerY",
    "bottom",
  ];
  const matchesBaseline = edges.every((edge) => {
    return areNumbersNear(expectedBounds[edge], intent.bounds[edge]);
  });
  if (!matchesBaseline) {
    throw new Error(
      "Movement raw intent must be a translation of the gesture baseline",
    );
  }
}
