/* eslint-disable no-use-before-define -- the public plan entry sits above its helpers. */
import type { ObjectBounds } from "../bounds.js";
import {
  assertHeldCandidateInBaseline,
  FREE_AXIS_HOLD,
} from "../protocol/hold.js";
import {
  createScaleProjection,
  type ProjectedScaleEdgePositions,
  projectScaleEdgePositions,
  type ScaleProjection,
  type ScaleSceneAxis,
} from "./scale-projection.js";
import { createExactBoundsSnapshot } from "./scale-snap-geometry.js";
import {
  type ResolvedScaleProposals,
  resolveAxisProposal,
  resolveCompatibleProposals,
} from "./scale-snap-proposals.js";
import type {
  PlannedScaleConstraint,
  ScaleAxisHold,
  ScaleAxisProposal,
  ScaleGestureBaseline,
  ScaleHoldState,
  ScaleProjectionMode,
  ScaleRawIntent,
  ScaleSnapCandidate,
  ScaleSnapConstraints,
  ScaleSnapPlan,
  ScaleSnapPlanRefinement,
  ScaleStepProjectionInput,
} from "./scale-snapping-resolver.js";

/**
 * Calculates a new snapping plan, or keeps holding the chosen guides.
 */
export function resolveScalePlan({
  baseline,
  intent,
  holdState,
  stepProjection,
}: {
  baseline: ScaleGestureBaseline;
  intent: ScaleRawIntent;
  holdState: ScaleHoldState;
  stepProjection?: ScaleStepProjectionInput;
}): ScaleSnapPlan {
  const baselineMode = resolveProjectionMode({
    baseline,
    modeId: intent.projectionMode,
  });
  const projectionMode = resolveStepProjectionMode({
    baselineMode,
    ...(stepProjection ? { stepProjection } : {}),
  });
  assertScaleRawIntent({ projection: projectionMode.projection, intent });
  assertScaleHoldState({ baseline, holdState });

  const rawValues = Object.freeze([...intent.values]);
  const rawPositions = projectScaleEdgePositions({
    projection: projectionMode.projection,
    values: rawValues,
  });
  if (intent.modifiers.ctrlKey) {
    return createScaleSnapPlan({
      baseline,
      projectionMode,
      rawValues,
      rawPositions,
      proposals: Object.freeze({ x: null, y: null }),
      resolved: null,
    });
  }

  const axisProposalContext = {
    baseline,
    projectionMode,
    rawPositions,
    rawValues,
  };
  const x = resolveAxisProposal({
    ...axisProposalContext,
    axis: "x",
    hold: holdState.x,
  });
  const y = resolveAxisProposal({
    ...axisProposalContext,
    axis: "y",
    hold: holdState.y,
  });
  const resolved = resolveCompatibleProposals({
    baseline,
    projectionMode,
    rawValues,
    x,
    y,
  });

  return createScaleSnapPlan({
    baseline,
    projectionMode,
    rawValues,
    rawPositions,
    proposals: Object.freeze({ x, y }),
    resolved,
  });
}

/**
 * Refines the values and the applicable constraints from the object's actual geometry.
 * The original pointer position and the candidates available for refinement do not change.
 */
export function refineScalePlan({
  plan,
  refinement,
}: {
  plan: ScaleSnapPlan;
  refinement: ScaleSnapPlanRefinement;
}): ScaleSnapPlan {
  const projectionMode = resolveStepProjectionMode({
    baselineMode: Object.freeze({
      id: plan.projectionMode,
      projection: plan.projection,
    }),
    stepProjection: refinement.stepProjection,
  });
  const effectiveValues = Object.freeze([...refinement.effectiveValues]);
  assertScaleValues({
    projection: projectionMode.projection,
    values: effectiveValues,
  });
  const constraints = createRefinedScaleConstraints({
    candidates: plan.refinementCandidates,
    constraints: refinement.constraints,
  });

  const effectivePositions = projectScaleEdgePositions({
    projection: projectionMode.projection,
    values: effectiveValues,
  });
  assertRefinedConstraintsReached({
    bounds: refinement.stepProjection.bounds,
    constraints,
    effectivePositions,
    verificationEpsilon: plan.verificationEpsilon,
  });

  return Object.freeze({
    ...plan,
    projection: projectionMode.projection,
    variables: projectionMode.projection.variables,
    effectiveValues,
    effectivePositions,
    constraints,
    proposedHoldState: createHoldStateFromConstraints(constraints),
  });
}

/**
 * Uses either the gesture's original projection or the exact local model of the current step.
 */
function resolveStepProjectionMode({
  baselineMode,
  stepProjection,
}: {
  baselineMode: ScaleProjectionMode;
  stepProjection?: ScaleStepProjectionInput;
}): ScaleProjectionMode {
  if (!stepProjection) return baselineMode;

  const bounds = createExactBoundsSnapshot({ bounds: stepProjection.bounds });
  const projection = createScaleProjection({
    bounds,
    input: stepProjection.projection,
  });
  assertStepProjectionContract({
    baseline: baselineMode.projection,
    step: projection,
  });

  return Object.freeze({ id: baselineMode.id, projection });
}

/** Validates that the local projection preserves the gesture's variables and moving edges. */
function assertStepProjectionContract({
  baseline,
  step,
}: {
  baseline: ScaleProjection;
  step: ScaleProjection;
}): void {
  const hasSameVariables =
    baseline.variables.length === step.variables.length &&
    baseline.variables.every(
      (variable, index) => variable === step.variables[index],
    );
  if (!hasSameVariables) {
    throw new Error("Scale step projection must preserve gesture variables");
  }

  const baselineEdges = baseline.edges.map(({ edge }) => edge).sort();
  const stepEdges = step.edges.map(({ edge }) => edge).sort();
  const hasSameEdges =
    baselineEdges.length === stepEdges.length &&
    baselineEdges.every((edge, index) => edge === stepEdges[index]);
  if (!hasSameEdges) {
    throw new Error("Scale step projection must preserve gesture edges");
  }
}

/** Validates the canonical values of the refined projection. */
function assertScaleValues({
  projection,
  values,
}: {
  projection: ScaleProjection;
  values: readonly number[];
}): void {
  if (values.length !== projection.variables.length) {
    throw new Error("Scale refinement has invalid values length");
  }
  if (!values.every(Number.isFinite)) {
    throw new Error("Scale refinement values must be finite");
  }
}

/** Validates that the refined plan's exact geometry reaches the original constraints. */
function assertRefinedConstraintsReached({
  bounds,
  constraints,
  effectivePositions,
  verificationEpsilon,
}: {
  bounds: ObjectBounds;
  constraints: ScaleSnapConstraints;
  effectivePositions: ProjectedScaleEdgePositions;
  verificationEpsilon: number;
}): void {
  for (const constraint of [constraints.x, constraints.y]) {
    if (!constraint) continue;

    const { edge } = constraint.candidate;
    const projectedPosition = effectivePositions[edge];
    const exactPosition = bounds[edge];
    if (
      projectedPosition === null ||
      Math.abs(projectedPosition - constraint.expectedPosition) >
        verificationEpsilon ||
      Math.abs(exactPosition - constraint.expectedPosition) >
        verificationEpsilon
    ) {
      throw new Error(`Refined scale plan does not reach ${edge} constraint`);
    }
  }
}

/** Validates the chosen constraints and builds their immutable snapshot. */
function createRefinedScaleConstraints({
  candidates,
  constraints,
}: {
  candidates: ScaleSnapConstraints;
  constraints: ScaleSnapConstraints;
}): ScaleSnapConstraints {
  return Object.freeze({
    x: resolveRefinedScaleConstraint({
      axis: "x",
      candidate: candidates.x,
      constraint: constraints.x,
    }),
    y: resolveRefinedScaleConstraint({
      axis: "y",
      candidate: candidates.y,
      constraint: constraints.y,
    }),
  });
}

/** Validates the chosen constraint and returns the snapshot from the original plan. */
function resolveRefinedScaleConstraint({
  axis,
  candidate,
  constraint,
}: {
  axis: ScaleSceneAxis;
  candidate: PlannedScaleConstraint | null;
  constraint: PlannedScaleConstraint | null;
}): PlannedScaleConstraint | null {
  if (!constraint) return null;
  if (
    !candidate ||
    !arePlannedScaleConstraintsEqual({ first: candidate, second: constraint })
  ) {
    throw new Error(
      `Refined ${axis} constraint does not belong to scale plan candidates`,
    );
  }

  return candidate;
}

/**
 * Validates that the held candidate belongs to the current gesture.
 */
function assertScaleHoldState({
  baseline,
  holdState,
}: {
  baseline: ScaleGestureBaseline;
  holdState: ScaleHoldState;
}): void {
  for (const axis of ["x", "y"] as const) {
    const axisHold = holdState[axis];
    if (axisHold.kind === "free") continue;

    assertHeldCandidateInBaseline({
      axis,
      candidate: axisHold.candidate,
      baselineCandidates: baseline.candidates,
      equals: (first, second) => areScaleCandidatesEqual({ first, second }),
      describeAxisMismatch: () =>
        `Held scale candidate belongs to ${axisHold.candidate.axis}, not ${axis} axis`,
      describeNotInBaseline: () =>
        `Held scale candidate "${axisHold.candidate.id}" does not belong to baseline snapshot`,
    });
  }
}

/**
 * Assembles the plan with snapping, or with the raw values and no snapping.
 */
function createScaleSnapPlan({
  baseline,
  projectionMode,
  rawValues,
  rawPositions,
  proposals,
  resolved,
}: {
  baseline: ScaleGestureBaseline;
  projectionMode: ScaleProjectionMode;
  rawValues: readonly number[];
  rawPositions: ProjectedScaleEdgePositions;
  proposals: Readonly<{
    x: ScaleAxisProposal | null;
    y: ScaleAxisProposal | null;
  }>;
  resolved: ResolvedScaleProposals | null;
}): ScaleSnapPlan {
  const effectiveValues = resolved ? resolved.solution.values : rawValues;
  const effectivePositions = resolved
    ? resolved.solution.positions
    : rawPositions;
  const constraints = createPlannedScaleConstraints({
    x: resolved?.x ?? null,
    y: resolved?.y ?? null,
  });
  const refinementCandidates = createPlannedScaleConstraints(proposals);
  assertEffectiveConstraintsReached({
    constraints,
    effectivePositions,
    verificationEpsilon: baseline.thresholds.verification,
  });

  return Object.freeze({
    projectionMode: projectionMode.id,
    projection: projectionMode.projection,
    variables: projectionMode.projection.variables,
    rawValues,
    effectiveValues,
    rawPositions,
    effectivePositions,
    constraints,
    refinementCandidates,
    proposedHoldState: createHoldStateFromConstraints(constraints),
    fixedAnchor: baseline.fixedAnchor,
    verificationEpsilon: baseline.thresholds.verification,
  });
}

/** Turns the axis proposals into the plan's immutable constraints. */
function createPlannedScaleConstraints({
  x,
  y,
}: {
  x: ScaleAxisProposal | null;
  y: ScaleAxisProposal | null;
}): ScaleSnapConstraints {
  return Object.freeze({
    x: x ? createPlannedConstraint(x) : null,
    y: y ? createPlannedConstraint(y) : null,
  });
}

/** Validates that the applicable constraints match the calculated edges. */
function assertEffectiveConstraintsReached({
  constraints,
  effectivePositions,
  verificationEpsilon,
}: {
  constraints: ScaleSnapConstraints;
  effectivePositions: ProjectedScaleEdgePositions;
  verificationEpsilon: number;
}): void {
  for (const constraint of [constraints.x, constraints.y]) {
    if (!constraint) continue;

    const position = effectivePositions[constraint.candidate.edge];
    if (
      position === null ||
      Math.abs(position - constraint.expectedPosition) > verificationEpsilon
    ) {
      throw new Error(
        `Scale plan does not reach ${constraint.candidate.edge} constraint`,
      );
    }
  }
}

/**
 * Keeps the chosen constraint in the plan.
 */
function createPlannedConstraint(
  proposal: ScaleAxisProposal,
): PlannedScaleConstraint {
  return Object.freeze({
    axis: proposal.axis,
    candidate: proposal.candidate,
    transition: proposal.transition,
    expectedPosition: proposal.candidate.position,
  });
}

/**
 * Keeps only the compatible constraints for the next step.
 */
function createHoldStateFromConstraints({
  x,
  y,
}: ScaleSnapConstraints): ScaleHoldState {
  return Object.freeze({
    x: createAxisHold({ constraint: x }),
    y: createAxisHold({ constraint: y }),
  });
}

/**
 * Builds the immutable state of one axis.
 */
function createAxisHold({
  constraint,
}: {
  constraint: PlannedScaleConstraint | null;
}): ScaleAxisHold {
  if (!constraint) return FREE_AXIS_HOLD;

  return Object.freeze({ kind: "held", candidate: constraint.candidate });
}

/**
 * Returns the mode the object manager chose for the current pointer event.
 */
function resolveProjectionMode({
  baseline,
  modeId,
}: {
  baseline: ScaleGestureBaseline;
  modeId: string;
}): ScaleProjectionMode {
  const projectionMode = baseline.projectionModes.find(
    ({ id }) => id === modeId,
  );
  if (!projectionMode) {
    throw new Error(`Unknown scale projection mode "${modeId}"`);
  }

  return projectionMode;
}

/**
 * Validates the raw canonical values for the chosen mode.
 */
function assertScaleRawIntent({
  projection,
  intent,
}: {
  projection: ScaleProjection;
  intent: ScaleRawIntent;
}): void {
  if (intent.values.length !== projection.variables.length) {
    throw new Error("Scale raw intent has invalid values length");
  }
  if (!intent.values.every(Number.isFinite)) {
    throw new Error("Scale raw intent values must be finite");
  }
  if (
    typeof intent.modifiers.ctrlKey !== "boolean" ||
    typeof intent.modifiers.shiftKey !== "boolean"
  ) {
    throw new Error("Scale raw intent modifiers must be boolean");
  }
}

/**
 * Checks that two captured candidates match exactly.
 */
function areScaleCandidatesEqual({
  first,
  second,
}: {
  first: ScaleSnapCandidate;
  second: ScaleSnapCandidate;
}): boolean {
  return (
    first.id === second.id &&
    first.axis === second.axis &&
    first.edge === second.edge &&
    first.position === second.position &&
    first.category === second.category &&
    first.snapshotIndex === second.snapshotIndex
  );
}

/** Checks that two constraints of one candidate match exactly. */
function arePlannedScaleConstraintsEqual({
  first,
  second,
}: {
  first: PlannedScaleConstraint;
  second: PlannedScaleConstraint;
}): boolean {
  return (
    first.axis === second.axis &&
    first.transition === second.transition &&
    first.expectedPosition === second.expectedPosition &&
    areScaleCandidatesEqual({
      first: first.candidate,
      second: second.candidate,
    })
  );
}
