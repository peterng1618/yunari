/* eslint-disable no-use-before-define -- the verification entry sits above its checks. */
import {
  areBoundsDimensionsEqual,
  createExactBoundsSnapshot,
  createPositionSnapshot,
} from "./movement-snap-intent.js";
import type {
  FinalMovementGeometry,
  MovementAxisHold,
  MovementGestureBaseline,
  MovementSceneAxis,
  MovementSnapPlan,
  MovementSnapVerification,
  MovementTargetPosition,
  PlannedMovementConstraint,
  VerifiedMovementGuide,
} from "./movement-snapping-resolver.js";
import {
  appendVerifiedMovementSpacingGuides,
  resolveApplicableMovementSpacingSelections,
} from "./movement-spacing-verification.js";
import { FREE_AXIS_HOLD } from "./protocol/hold.js";
import type { Bounds, SpacingGuide } from "./types.js";

/**
 * Verifies the actual geometry, then updates the hold state and guides.
 */
export function verifyMovementPlan({
  baseline,
  plan,
  finalGeometry,
}: {
  baseline: MovementGestureBaseline;
  plan: MovementSnapPlan;
  finalGeometry: FinalMovementGeometry;
}): MovementSnapVerification {
  const bounds = createExactBoundsSnapshot({ bounds: finalGeometry.bounds });
  const position = createPositionSnapshot({ position: finalGeometry.position });
  const dimensionsPreserved = areBoundsDimensionsEqual({
    first: baseline.bounds,
    second: bounds,
    epsilon: plan.verificationEpsilon,
  });
  const xVerified = verifyMovementAxisConstraint({
    baseline,
    constraint: plan.constraints.x,
    plan,
    bounds,
    position,
    dimensionsPreserved,
  });
  const yVerified = verifyMovementAxisConstraint({
    baseline,
    constraint: plan.constraints.y,
    plan,
    bounds,
    position,
    dimensionsPreserved,
  });

  return createMovementVerification({
    baseline,
    plan,
    xVerified,
    yVerified,
    bounds,
  });
}

/** Verifies the chosen constraint against final bounds without substituting it. */
function verifyMovementAxisConstraint({
  baseline,
  constraint,
  plan,
  bounds,
  position,
  dimensionsPreserved,
}: {
  baseline: MovementGestureBaseline;
  constraint: PlannedMovementConstraint | null;
  plan: MovementSnapPlan;
  bounds: Bounds;
  position: MovementTargetPosition;
  dimensionsPreserved: boolean;
}): boolean {
  if (!constraint || !dimensionsPreserved) return false;

  const targetPosition = constraint.axis === "x" ? position.left : position.top;
  const plannedPosition =
    constraint.axis === "x" ? plan.nextPosition.left : plan.nextPosition.top;
  if (Math.abs(targetPosition - plannedPosition) > plan.verificationEpsilon)
    return false;
  if (!doesMovementAxisMatchPlan({ axis: constraint.axis, bounds, plan }))
    return false;
  if (constraint.kind === "spacing") {
    const selections = resolveApplicableMovementSpacingSelections({
      constraint,
      baseline,
      bounds,
    });

    return selections.some(({ isPrimary }) => isPrimary);
  }

  return (
    Math.abs(bounds[constraint.activeAnchor] - constraint.candidate.position) <=
    plan.verificationEpsilon
  );
}

/** Compares actual versus computed bounds on the verified axis only. */
function doesMovementAxisMatchPlan({
  axis,
  bounds,
  plan,
}: {
  axis: MovementSceneAxis;
  bounds: Bounds;
  plan: MovementSnapPlan;
}): boolean {
  const edges: readonly (keyof Bounds)[] =
    axis === "x" ? ["left", "centerX", "right"] : ["top", "centerY", "bottom"];

  return edges.every((edge) => {
    return (
      Math.abs(bounds[edge] - plan.predictedBounds[edge]) <=
      plan.verificationEpsilon
    );
  });
}

/** Produces the final verification result. */
function createMovementVerification({
  baseline,
  plan,
  xVerified,
  yVerified,
  bounds,
}: {
  baseline: MovementGestureBaseline;
  plan: MovementSnapPlan;
  xVerified: boolean;
  yVerified: boolean;
  bounds: Bounds;
}): MovementSnapVerification {
  const guides: VerifiedMovementGuide[] = [];
  const spacingGuides: SpacingGuide[] = [];
  const blockedAxes: MovementSceneAxis[] = [];
  const x = resolveVerifiedAxisHold({
    baseline,
    bounds,
    guides,
    spacingGuides,
    blockedAxes,
    constraint: plan.constraints.x,
    plan,
    verified: xVerified,
  });
  const y = resolveVerifiedAxisHold({
    baseline,
    bounds,
    guides,
    spacingGuides,
    blockedAxes,
    constraint: plan.constraints.y,
    plan,
    verified: yVerified,
  });

  return Object.freeze({
    guides: Object.freeze(guides),
    spacingGuides: Object.freeze(spacingGuides),
    blockedAxes: Object.freeze(blockedAxes),
    holdState: Object.freeze({ x, y }),
  });
}

/** Stores the verified hold and guide, or marks the axis blocked. */
function resolveVerifiedAxisHold({
  baseline,
  bounds,
  guides,
  spacingGuides,
  blockedAxes,
  constraint,
  plan,
  verified,
}: {
  baseline: MovementGestureBaseline;
  bounds: Bounds;
  guides: VerifiedMovementGuide[];
  spacingGuides: SpacingGuide[];
  blockedAxes: MovementSceneAxis[];
  constraint: PlannedMovementConstraint | null;
  plan: MovementSnapPlan;
  verified: boolean;
}): MovementAxisHold {
  if (!constraint) return FREE_AXIS_HOLD;
  if (!verified) {
    blockedAxes.push(constraint.axis);
    return FREE_AXIS_HOLD;
  }
  if (constraint.kind === "spacing") {
    appendVerifiedMovementSpacingGuides({
      baseline,
      bounds,
      guides: spacingGuides,
      constraint,
      plan,
    });

    return Object.freeze({
      kind: "spacing",
      candidateId: constraint.candidateId,
      context: constraint.context,
    });
  }

  guides.push(
    Object.freeze({
      axis: constraint.axis,
      activeAnchor: constraint.activeAnchor,
      position: constraint.candidate.position,
      candidateId: constraint.candidate.id,
      category: constraint.candidate.category,
      snapshotIndex: constraint.candidate.snapshotIndex,
    }),
  );

  return Object.freeze({
    kind: "line",
    candidate: constraint.candidate,
    activeAnchor: constraint.activeAnchor,
  });
}
