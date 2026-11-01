/* eslint-disable no-use-before-define -- the proposal entry sits above its helpers. */
import { isPreferredSnapCandidate } from "../protocol/candidates.js";
import {
  getScaleProjectionCorrectionMagnitude,
  getScaleProjectionEdge,
  type ProjectedScaleEdgePositions,
  resolveScaleProjection,
  type ScaleProjectionConstraint,
  type ScaleProjectionSolution,
  type ScaleSceneAxis,
} from "./scale-projection.js";
import type {
  ScaleAxisHold,
  ScaleAxisProposal,
  ScaleGestureBaseline,
  ScaleProjectionMode,
  ScaleSnapCandidate,
  ScaleSnapCandidateCategory,
} from "./scale-snapping-resolver.js";

/** The compatible constraints and the canonical values calculated for them. */
export type ResolvedScaleProposals = Readonly<{
  x: ScaleAxisProposal | null;
  y: ScaleAxisProposal | null;
  solution: ScaleProjectionSolution;
}>;

/** Tolerance within which two displacements are considered equal. */
const SCALE_CORRECTION_COMPARISON_EPSILON = 0.000000001;

/** Category order used when candidates require the same displacement. */
const SCALE_CANDIDATE_CATEGORY_PRIORITY: Readonly<
  Record<ScaleSnapCandidateCategory, number>
> = Object.freeze({
  "domain-boundary": 0,
  edge: 1,
  center: 2,
  spacing: 3,
});

/**
 * Keeps the held guide, or chooses a new candidate on one axis.
 */
export function resolveAxisProposal({
  axis,
  baseline,
  projectionMode,
  rawPositions,
  rawValues,
  hold,
}: {
  axis: ScaleSceneAxis;
  baseline: ScaleGestureBaseline;
  projectionMode: ScaleProjectionMode;
  rawPositions: ProjectedScaleEdgePositions;
  rawValues: readonly number[];
  hold: ScaleAxisHold;
}): ScaleAxisProposal | null {
  if (hold.kind === "held") {
    const rawPosition = rawPositions[hold.candidate.edge];
    const releaseThreshold =
      hold.candidate.category === "spacing"
        ? baseline.thresholds.spacingRelease
        : baseline.thresholds.release;
    if (
      rawPosition !== null &&
      Math.abs(rawPosition - hold.candidate.position) <= releaseThreshold &&
      canProjectScaleCandidate({
        baseline,
        candidate: hold.candidate,
        projectionMode,
        rawValues,
      })
    ) {
      return Object.freeze({
        axis,
        candidate: hold.candidate,
        transition: "held",
      });
    }
  }

  const candidate = findBestScaleCandidate({
    axis,
    baseline,
    projectionMode,
    rawPositions,
    rawValues,
  });
  if (!candidate) return null;

  return Object.freeze({ axis, candidate, transition: "acquired" });
}

/**
 * Chooses the nearest candidate, with category and original order as tie-breaks.
 */
function findBestScaleCandidate({
  axis,
  baseline,
  projectionMode,
  rawPositions,
  rawValues,
}: {
  axis: ScaleSceneAxis;
  baseline: ScaleGestureBaseline;
  projectionMode: ScaleProjectionMode;
  rawPositions: ProjectedScaleEdgePositions;
  rawValues: readonly number[];
}): ScaleSnapCandidate | null {
  let bestCandidate: ScaleSnapCandidate | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const candidate of baseline.candidates) {
    if (candidate.axis !== axis) continue;
    if (
      !getScaleProjectionEdge({
        projection: projectionMode.projection,
        edge: candidate.edge,
      })
    ) {
      continue;
    }

    const rawPosition = rawPositions[candidate.edge];
    if (rawPosition === null) continue;
    const distance = Math.abs(candidate.position - rawPosition);
    if (distance > baseline.thresholds.acquire) continue;
    if (
      !canProjectScaleCandidate({
        baseline,
        candidate,
        projectionMode,
        rawValues,
      })
    )
      continue;
    if (
      isPreferredSnapCandidate({
        candidate,
        distance,
        bestCandidate,
        bestDistance,
        priority: SCALE_CANDIDATE_CATEGORY_PRIORITY,
        epsilon: SCALE_CORRECTION_COMPARISON_EPSILON,
      })
    ) {
      bestCandidate = candidate;
      bestDistance = distance;
    }
  }

  return bestCandidate;
}

/** Validates that the candidate's constraint can be satisfied in the step's local projection. */
function canProjectScaleCandidate({
  baseline,
  candidate,
  projectionMode,
  rawValues,
}: {
  baseline: ScaleGestureBaseline;
  candidate: ScaleSnapCandidate;
  projectionMode: ScaleProjectionMode;
  rawValues: readonly number[];
}): boolean {
  return (
    resolveScaleProjection({
      projection: projectionMode.projection,
      rawValues,
      constraints: [
        {
          axis: candidate.axis,
          edge: candidate.edge,
          position: candidate.position,
        },
      ],
      epsilon: baseline.thresholds.verification,
    }) !== null
  );
}

/**
 * Combines the constraints of both axes, or keeps the one priority constraint.
 */
export function resolveCompatibleProposals({
  baseline,
  projectionMode,
  rawValues,
  x,
  y,
}: {
  baseline: ScaleGestureBaseline;
  projectionMode: ScaleProjectionMode;
  rawValues: readonly number[];
  x: ScaleAxisProposal | null;
  y: ScaleAxisProposal | null;
}): ResolvedScaleProposals {
  const orderedProposals = orderScaleProposals({
    projectionMode,
    rawValues,
    x,
    y,
  });
  const constraints = orderedProposals.map(createProjectionConstraint);
  const solution = resolveScaleProjection({
    projection: projectionMode.projection,
    rawValues,
    constraints,
    epsilon: baseline.thresholds.verification,
  });

  if (solution) return Object.freeze({ x, y, solution });
  const [preferred] = orderedProposals;
  if (!preferred) {
    throw new Error("Raw scale intent must have a projection solution");
  }

  const preferredSolution = resolveScaleProjection({
    projection: projectionMode.projection,
    rawValues,
    constraints: [createProjectionConstraint(preferred)],
    epsilon: baseline.thresholds.verification,
  });
  if (!preferredSolution) {
    throw new Error(
      `Scale constraint for ${preferred.candidate.edge} edge must have a projection solution`,
    );
  }

  return Object.freeze({
    x: preferred.axis === "x" ? preferred : null,
    y: preferred.axis === "y" ? preferred : null,
    solution: preferredSolution,
  });
}

/**
 * Orders a held constraint first, then the smaller correction, then the X axis.
 */
function orderScaleProposals({
  projectionMode,
  rawValues,
  x,
  y,
}: {
  projectionMode: ScaleProjectionMode;
  rawValues: readonly number[];
  x: ScaleAxisProposal | null;
  y: ScaleAxisProposal | null;
}): readonly ScaleAxisProposal[] {
  const proposals: ScaleAxisProposal[] = [];
  if (x) proposals.push(x);
  if (y) proposals.push(y);
  if (!x || !y) return Object.freeze(proposals);

  const preferred = selectPrimaryScaleProposal({
    projectionMode,
    rawValues,
    x,
    y,
  });
  return preferred.axis === "x" ? Object.freeze([x, y]) : Object.freeze([y, x]);
}

/**
 * Chooses the single constraint when the two constraints cannot be applied together.
 */
function selectPrimaryScaleProposal({
  projectionMode,
  rawValues,
  x,
  y,
}: {
  projectionMode: ScaleProjectionMode;
  rawValues: readonly number[];
  x: ScaleAxisProposal;
  y: ScaleAxisProposal;
}): ScaleAxisProposal {
  if (x.transition !== y.transition) return x.transition === "held" ? x : y;

  const xMagnitude = getProposalCorrectionMagnitude({
    projectionMode,
    rawValues,
    proposal: x,
  });
  const yMagnitude = getProposalCorrectionMagnitude({
    projectionMode,
    rawValues,
    proposal: y,
  });
  const magnitudeDifference = xMagnitude - yMagnitude;
  if (magnitudeDifference < -SCALE_CORRECTION_COMPARISON_EPSILON) return x;
  if (magnitudeDifference > SCALE_CORRECTION_COMPARISON_EPSILON) return y;

  return x;
}

/**
 * Returns the scale change one constraint needs.
 */
function getProposalCorrectionMagnitude({
  projectionMode,
  rawValues,
  proposal,
}: {
  projectionMode: ScaleProjectionMode;
  rawValues: readonly number[];
  proposal: ScaleAxisProposal;
}): number {
  return getScaleProjectionCorrectionMagnitude({
    projection: projectionMode.projection,
    rawValues,
    constraint: createProjectionConstraint(proposal),
  });
}

/**
 * Turns the chosen candidate into a constraint for one particular edge.
 */
function createProjectionConstraint(
  proposal: ScaleAxisProposal,
): ScaleProjectionConstraint {
  return Object.freeze({
    axis: proposal.axis,
    edge: proposal.candidate.edge,
    position: proposal.candidate.position,
  });
}
