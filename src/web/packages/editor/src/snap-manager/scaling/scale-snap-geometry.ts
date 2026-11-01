import type { ObjectBounds } from "../bounds.js";
import type { ScaleScenePoint } from "./scale-snapping-resolver.js";

/** Tolerance for checking centres derived from exact bounds. */
export const EXACT_BOUNDS_CENTER_EPSILON = 0.000000001;

/** Validates and copies the exact bounds without rounding. */
export function createExactBoundsSnapshot({
  bounds,
}: {
  bounds: ObjectBounds;
}): ObjectBounds {
  const { left, right, top, bottom, centerX, centerY } = bounds;
  const edges = [left, right, top, bottom];
  if (!edges.every(Number.isFinite) || right < left || bottom < top) {
    throw new Error("Scale snapping bounds must contain finite ordered edges");
  }
  if (!Number.isFinite(centerX) || !Number.isFinite(centerY)) {
    throw new Error("Scale snapping bounds must contain finite centers");
  }

  const expectedCenterX = left + (right - left) / 2;
  const expectedCenterY = top + (bottom - top) / 2;
  if (
    Math.abs(centerX - expectedCenterX) > EXACT_BOUNDS_CENTER_EPSILON ||
    Math.abs(centerY - expectedCenterY) > EXACT_BOUNDS_CENTER_EPSILON
  ) {
    throw new Error(
      "Scale snapping bounds centers must be derived from its edges",
    );
  }

  return Object.freeze({ left, right, top, bottom, centerX, centerY });
}

/** Validates and copies a point in scene coordinates. */
export function createScenePointSnapshot({
  point,
  name,
}: {
  point: ScaleScenePoint;
  name: string;
}): ScaleScenePoint {
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
    throw new Error(`Scale snapping ${name} must contain finite coordinates`);
  }

  return Object.freeze({ x: point.x, y: point.y });
}

/** Checks that two points match within the common tolerance. */
export function areScenePointsNear({
  first,
  second,
  epsilon,
}: {
  first: ScaleScenePoint;
  second: ScaleScenePoint;
  epsilon: number;
}): boolean {
  return (
    Math.abs(first.x - second.x) <= epsilon &&
    Math.abs(first.y - second.y) <= epsilon
  );
}
