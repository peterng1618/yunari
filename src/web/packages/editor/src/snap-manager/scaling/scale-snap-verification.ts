/* eslint-disable no-use-before-define -- the verification entry sits above its checks. */

import { FREE_AXIS_HOLD } from "../protocol/hold.js";
import {
  type ProjectedScaleEdgePositions,
  projectScaleEdgePositions,
} from "./scale-projection.js";
import {
  areScenePointsNear,
  createExactBoundsSnapshot,
  createScenePointSnapshot,
} from "./scale-snap-geometry.js";
import type {
  FinalScaleGeometry,
  PlannedScaleConstraint,
  ScaleAxisHold,
  ScaleSceneAxis,
  ScaleSnapPlan,
  ScaleSnapVerification,
  VerifiedScaleGuide,
} from "./scale-snapping-resolver.js";

/**
 * Checks the plan against the actual geometry and the object manager's applied result.
 */
export function verifyScalePlan({
  plan,
  finalGeometry,
}: {
  plan: ScaleSnapPlan;
  finalGeometry: FinalScaleGeometry;
}): ScaleSnapVerification {
  const { measuredValues, domainVerdict } = finalGeometry;
  const bounds = createExactBoundsSnapshot({ bounds: finalGeometry.bounds });
  const fixedAnchor = createScenePointSnapshot({
    point: finalGeometry.fixedAnchor,
    name: "final fixed anchor",
  });
  const fixedAnchorMatches = areScenePointsNear({
    first: plan.fixedAnchor,
    second: fixedAnchor,
    epsilon: plan.verificationEpsilon,
  });
  const measuredPositions = projectMeasuredScalePositions({
    plan,
    measuredValues,
  });
  const commonStateMatches =
    fixedAnchorMatches && domainVerdict.protectedState === "preserved";

  const xVerified =
    commonStateMatches &&
    domainVerdict.x === "satisfied" &&
    isMeasuredConstraintEquivalent({
      constraint: plan.constraints.x,
      measuredPositions,
      plan,
    }) &&
    isConstraintReached({ constraint: plan.constraints.x, bounds, plan });
  const yVerified =
    commonStateMatches &&
    domainVerdict.y === "satisfied" &&
    isMeasuredConstraintEquivalent({
      constraint: plan.constraints.y,
      measuredPositions,
      plan,
    }) &&
    isConstraintReached({ constraint: plan.constraints.y, bounds, plan });

  return createScaleSnapVerification({ plan, xVerified, yVerified });
}

/**
 * Checks against the final exact bounds that the object reached the guide.
 */
function isConstraintReached({
  constraint,
  bounds,
  plan,
}: {
  constraint: PlannedScaleConstraint | null;
  bounds: ReturnType<typeof createExactBoundsSnapshot>;
  plan: ScaleSnapPlan;
}): boolean {
  if (!constraint) return false;

  const finalPosition = bounds[constraint.candidate.edge];
  return (
    Math.abs(finalPosition - constraint.expectedPosition) <=
    plan.verificationEpsilon
  );
}

/**
 * Calculates the edge positions for the scale values that were actually applied.
 */
function projectMeasuredScalePositions({
  plan,
  measuredValues,
}: {
  plan: ScaleSnapPlan;
  measuredValues: readonly number[];
}): ProjectedScaleEdgePositions | null {
  if (measuredValues.length !== plan.projection.variables.length) return null;
  if (!measuredValues.every(Number.isFinite)) return null;

  return projectScaleEdgePositions({
    projection: plan.projection,
    values: measuredValues,
  });
}

/**
 * Checks the actual position of only the edge the constraint depends on.
 */
function isMeasuredConstraintEquivalent({
  constraint,
  measuredPositions,
  plan,
}: {
  constraint: PlannedScaleConstraint | null;
  measuredPositions: ProjectedScaleEdgePositions | null;
  plan: ScaleSnapPlan;
}): boolean {
  if (!constraint || !measuredPositions) return false;

  const { edge } = constraint.candidate;
  const measuredPosition = measuredPositions[edge];
  const effectivePosition = plan.effectivePositions[edge];
  if (measuredPosition === null || effectivePosition === null) return false;

  return (
    Math.abs(measuredPosition - effectivePosition) <= plan.verificationEpsilon
  );
}

/**
 * Builds the confirmed guides, the blocked axes and the new hold state.
 */
function createScaleSnapVerification({
  plan,
  xVerified,
  yVerified,
}: {
  plan: ScaleSnapPlan;
  xVerified: boolean;
  yVerified: boolean;
}): ScaleSnapVerification {
  const guides: VerifiedScaleGuide[] = [];
  const blockedAxes: ScaleSceneAxis[] = [];
  const x = resolveVerifiedAxisHold({
    constraint: plan.constraints.x,
    verified: xVerified,
    guides,
    blockedAxes,
  });
  const y = resolveVerifiedAxisHold({
    constraint: plan.constraints.y,
    verified: yVerified,
    guides,
    blockedAxes,
  });

  return Object.freeze({
    guides: Object.freeze(guides),
    blockedAxes: Object.freeze(blockedAxes),
    holdState: Object.freeze({ x, y }),
  });
}

/**
 * Keeps the axis hold only for a constraint that was satisfied.
 */
function resolveVerifiedAxisHold({
  constraint,
  verified,
  guides,
  blockedAxes,
}: {
  constraint: PlannedScaleConstraint | null;
  verified: boolean;
  guides: VerifiedScaleGuide[];
  blockedAxes: ScaleSceneAxis[];
}): ScaleAxisHold {
  if (!constraint) return FREE_AXIS_HOLD;
  if (!verified) {
    blockedAxes.push(constraint.axis);
    return FREE_AXIS_HOLD;
  }

  guides.push(createVerifiedGuide(constraint));
  return Object.freeze({ kind: "held", candidate: constraint.candidate });
}

/**
 * Builds a confirmed guide carrying the source candidate's id.
 */
function createVerifiedGuide(
  constraint: PlannedScaleConstraint,
): VerifiedScaleGuide {
  const { candidate } = constraint;

  return Object.freeze({
    axis: constraint.axis,
    edge: candidate.edge,
    position: candidate.position,
    candidateId: candidate.id,
    category: candidate.category,
    snapshotIndex: candidate.snapshotIndex,
  });
}
