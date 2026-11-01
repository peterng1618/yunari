/* eslint-disable no-use-before-define -- the public function sits above its internal checks. */
import type { ObjectBounds } from "./bounds.js";
import { createSnapSourceLines } from "./protocol/candidates.js";

/** A movement axis in scene coordinates. */
export type MovementSceneAxis = "x" | "y";

/** A named anchor on the dragged bounding box. */
export type MovementBoundsAnchor =
  | "left"
  | "centerX"
  | "right"
  | "top"
  | "centerY"
  | "bottom";

/** Guide category for resolving equally distant candidates. */
export type MovementSnapCandidateCategory =
  | "domain-boundary"
  | "edge"
  | "center";

/** An object with exact bounds captured at gesture start. */
export type MovementSnapCandidateSource = Readonly<{
  id: string;
  bounds: ObjectBounds;
  edgeCategory?: Extract<
    MovementSnapCandidateCategory,
    "domain-boundary" | "edge"
  >;
  useForSpacing?: boolean;
}>;

/** A named guide from the immutable target snapshot. */
export type MovementSnapCandidate = Readonly<{
  id: string;
  axis: MovementSceneAxis;
  position: number;
  category: MovementSnapCandidateCategory;
  snapshotIndex: number;
}>;

/** Named exact bounds of one object, for the equal-spacing chain snapshot. */
export type MovementSnapSpacingSource = Readonly<{
  id: string;
  bounds: ObjectBounds;
}>;

/** Snap targets and canvas zoom, cached for one drag. */
export type MovementSnapEnvironment = Readonly<{
  candidates: readonly MovementSnapCandidate[];
  spacingSources: readonly MovementSnapSpacingSource[];
  zoom: number;
}>;

/** Tolerance for comparing centres derived from exact edges. */
const EXACT_BOUNDS_CENTER_EPSILON = 0.000000001;

/**
 * Builds the immutable snapshot of regular and equal-spacing targets for one drag.
 */
export function createMovementSnapEnvironment({
  sources,
  zoom,
}: {
  sources: readonly MovementSnapCandidateSource[];
  zoom: number;
}): MovementSnapEnvironment {
  assertEnvironmentInputs({ sources, zoom });

  const candidates: MovementSnapCandidate[] = [];
  const spacingSources: MovementSnapSpacingSource[] = [];

  for (const source of sources) {
    for (const line of createSnapSourceLines({
      bounds: source.bounds,
      edgeCategory: source.edgeCategory ?? "edge",
    })) {
      candidates.push(
        Object.freeze({
          id: `${source.id}:${line.key}`,
          axis: line.axis,
          position: line.position,
          category: line.category,
          snapshotIndex: candidates.length,
        }),
      );
    }

    if (source.useForSpacing) {
      spacingSources.push(
        Object.freeze({
          id: source.id,
          bounds: createBoundsSnapshot({ bounds: source.bounds }),
        }),
      );
    }
  }

  return Object.freeze({
    candidates: Object.freeze(candidates),
    spacingSources: Object.freeze(spacingSources),
    zoom,
  });
}

/** Validates zoom, id uniqueness and exact geometry of the sources. */
function assertEnvironmentInputs({
  sources,
  zoom,
}: {
  sources: readonly MovementSnapCandidateSource[];
  zoom: number;
}): void {
  if (!Number.isFinite(zoom) || zoom <= 0) {
    throw new Error("Movement snapping zoom must be a finite positive number");
  }

  const sourceIds = new Set<string>();
  for (const source of sources) {
    if (!source.id.trim() || sourceIds.has(source.id)) {
      throw new Error(
        `Movement snap source id "${source.id}" must be non-empty and unique`,
      );
    }

    sourceIds.add(source.id);
    createBoundsSnapshot({ bounds: source.bounds });
  }
}

/** Copies and validates the exact bounds of one source. */
function createBoundsSnapshot({
  bounds,
}: {
  bounds: ObjectBounds;
}): ObjectBounds {
  const { left, right, top, bottom, centerX, centerY } = bounds;
  const values = [left, right, top, bottom, centerX, centerY];
  if (!values.every(Number.isFinite) || right < left || bottom < top) {
    throw new Error(
      "Movement snap source bounds must contain finite ordered values",
    );
  }

  const expectedCenterX = left + (right - left) / 2;
  const expectedCenterY = top + (bottom - top) / 2;
  if (
    Math.abs(centerX - expectedCenterX) > EXACT_BOUNDS_CENTER_EPSILON ||
    Math.abs(centerY - expectedCenterY) > EXACT_BOUNDS_CENTER_EPSILON
  ) {
    throw new Error(
      "Movement snap source centers must be derived from its edges",
    );
  }

  return Object.freeze({ left, right, top, bottom, centerX, centerY });
}
