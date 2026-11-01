// Ported: fork 9efdd78a src/editor/snapping-manager/scaling/scale-snap-candidates.ts
/* eslint-disable no-use-before-define -- the exported function sits above its internal checks. */
import type { ObjectBounds } from "../bounds.js";
import { createSnapSourceLines } from "../protocol/candidates.js";
import type { ScaleSceneAxis, ScaleSceneEdge } from "./scale-projection.js";
import type {
  ScaleSnapCandidateCategory,
  ScaleSnapCandidateInput,
} from "./scale-snapping-resolver.js";

/** An object with exact bounds the resized object can snap to. */
type ScaleSnapCandidateSource = Readonly<{
  id: string;
  bounds: ObjectBounds;
  edgeCategory?: Extract<
    ScaleSnapCandidateCategory,
    "domain-boundary" | "edge"
  >;
}>;

/**
 * Builds the ordered candidate list for every moving edge of the object.
 */
export function createScaleSnapCandidates({
  targetEdges,
  sources,
}: {
  targetEdges: readonly ScaleSceneEdge[];
  sources: readonly ScaleSnapCandidateSource[];
}): readonly ScaleSnapCandidateInput[] {
  assertCandidateInputs({ targetEdges, sources });

  const candidates: ScaleSnapCandidateInput[] = [];
  for (const source of sources) {
    const sourceLines = createSnapSourceLines({
      bounds: source.bounds,
      edgeCategory: source.edgeCategory ?? "edge",
    });
    for (const sourceLine of sourceLines) {
      for (const targetEdge of targetEdges) {
        if (resolveEdgeAxis(targetEdge) !== sourceLine.axis) continue;

        candidates.push(
          Object.freeze({
            id: `${source.id}:${sourceLine.key}->${targetEdge}`,
            axis: sourceLine.axis,
            edge: targetEdge,
            position: sourceLine.position,
            category: sourceLine.category,
          }),
        );
      }
    }
  }

  return Object.freeze(candidates);
}

/** Validates id uniqueness and the soundness of the source geometry. */
function assertCandidateInputs({
  targetEdges,
  sources,
}: {
  targetEdges: readonly ScaleSceneEdge[];
  sources: readonly ScaleSnapCandidateSource[];
}): void {
  if (!targetEdges.length) {
    throw new Error("Scale snap target edges must contain at least one edge");
  }
  if (new Set(targetEdges).size !== targetEdges.length) {
    throw new Error("Scale snap target edges must be unique");
  }

  const sourceIds = new Set<string>();
  for (const source of sources) {
    if (!source.id.trim() || sourceIds.has(source.id)) {
      throw new Error(
        `Scale snap source id "${source.id}" must be non-empty and unique`,
      );
    }
    sourceIds.add(source.id);
    assertSourceBounds({ source });
  }
}

/** Validates the exact bounds of one source object. */
function assertSourceBounds({
  source,
}: {
  source: ScaleSnapCandidateSource;
}): void {
  const { left, right, top, bottom, centerX, centerY } = source.bounds;
  const values = [left, right, top, bottom, centerX, centerY];
  if (!values.every(Number.isFinite)) {
    throw new Error(`Scale snap source "${source.id}" bounds must be finite`);
  }
  if (right < left || bottom < top) {
    throw new Error(`Scale snap source "${source.id}" bounds must be ordered`);
  }

  const expectedCenterX = left + (right - left) / 2;
  const expectedCenterY = top + (bottom - top) / 2;
  if (centerX !== expectedCenterX || centerY !== expectedCenterY) {
    throw new Error(
      `Scale snap source "${source.id}" centers must be derived from its edges`,
    );
  }
}

/** Returns the coordinate axis of the given resized object edge. */
function resolveEdgeAxis(edge: ScaleSceneEdge): ScaleSceneAxis {
  return edge === "left" || edge === "right" ? "x" : "y";
}
