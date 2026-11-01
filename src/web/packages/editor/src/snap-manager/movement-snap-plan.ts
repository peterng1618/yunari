/* eslint-disable no-use-before-define -- the plan entry sits above its helpers. */
import { MOVE_SNAP_STEP } from "./constants.js";
import type {
  MovementBoundsAnchor,
  MovementSnapCandidate,
  MovementSnapCandidateCategory,
} from "./movement-snap-candidates.js";
import { assertMovementHoldState } from "./movement-snap-hold.js";
import {
  assertRawIntentMatchesBaseline,
  createExactBoundsSnapshot,
  createRawIntentSnapshot,
  translateBounds,
} from "./movement-snap-intent.js";
import type {
  HeldMovementLineAxisHold,
  HeldMovementSpacingAxisHold,
  MovementAxisHold,
  MovementAxisProposal,
  MovementAxisProposals,
  MovementGestureBaseline,
  MovementHoldState,
  MovementRawIntent,
  MovementSceneAxis,
  MovementSnapPlan,
  MovementSnapTransition,
  MovementTargetPosition,
  PlannedMovementConstraint,
  PlannedMovementLineConstraint,
  PlannedMovementSpacingConstraint,
} from "./movement-snapping-resolver.js";
import {
  MOVEMENT_CORRECTION_COMPARISON_EPSILON,
  resolveMovementSpacingCorrection,
} from "./movement-spacing-correction.js";
import { resolveApplicableMovementSpacingSelections } from "./movement-spacing-verification.js";
import { isPreferredSnapCandidate } from "./protocol/candidates.js";
import {
  calculateHorizontalSpacing,
  calculateVerticalSpacing,
  type ResolvedSpacingSelection,
  type SpacingSelectionContext,
  type SpacingSelectionIdentity,
} from "./spacing.js";
import type { Bounds, SpacingGuide } from "./types.js";

/** One axis's result from the existing spacing calculator. */
type MovementSpacingCalculation = {
  delta: number;
  guides: SpacingGuide[];
  context: SpacingSelectionContext | null;
  selections: ResolvedSpacingSelection[];
};

/** Shared tolerance for verifying an applied movement plan. */
const MOVEMENT_SNAP_VERIFICATION_EPSILON = 0.1;

/** Passes that stabilize cross-axis spacing after constraint replacement. */
const MOVEMENT_SPACING_COMPATIBILITY_PASSES = 3;

/** Category order when several lines sit equally distant. */
const MOVEMENT_CANDIDATE_CATEGORY_PRIORITY: Readonly<
  Record<MovementSnapCandidateCategory, number>
> = Object.freeze({
  "domain-boundary": 0,
  edge: 1,
  center: 2,
});

/** X anchors in stable order. */
const X_ANCHORS: readonly MovementBoundsAnchor[] = Object.freeze([
  "left",
  "centerX",
  "right",
]);

/** Y anchors in stable order. */
const Y_ANCHORS: readonly MovementBoundsAnchor[] = Object.freeze([
  "top",
  "centerY",
  "bottom",
]);

/**
 * Computes one final translation from the raw intent and current hold state.
 */
export function resolveMovementPlan({
  baseline,
  intent,
  holdState,
}: {
  baseline: MovementGestureBaseline;
  intent: MovementRawIntent;
  holdState: MovementHoldState;
}): MovementSnapPlan {
  const rawIntent = createRawIntentSnapshot({ intent });
  assertMovementHoldState({ baseline, holdState });
  assertRawIntentMatchesBaseline({ baseline, intent: rawIntent });

  if (rawIntent.modifiers.ctrlKey) {
    return createDisabledMovementPlan({ rawIntent });
  }

  const proposals = resolveCompatibleMovementProposals({
    baseline,
    intent: rawIntent,
    proposals: {
      x: resolveAxisProposal({
        axis: "x",
        baseline,
        intent: rawIntent,
        hold: holdState.x,
      }),
      y: resolveAxisProposal({
        axis: "y",
        baseline,
        intent: rawIntent,
        hold: holdState.y,
      }),
    },
  });
  const nextPosition = resolveNextMovementPosition({
    intent: rawIntent,
    proposals,
  });
  const predictedBounds = translateBounds({
    bounds: rawIntent.bounds,
    deltaX: nextPosition.left - rawIntent.position.left,
    deltaY: nextPosition.top - rawIntent.position.top,
  });
  const constraints = createPlannedMovementConstraints({
    proposals,
    deltaX: nextPosition.left - rawIntent.position.left,
    deltaY: nextPosition.top - rawIntent.position.top,
  });

  return Object.freeze({
    rawIntent,
    nextPosition,
    predictedBounds,
    constraints,
    verificationEpsilon: baseline.thresholds.verification,
  });
}

/** Builds a plan without snapping or pixel rounding while Ctrl is held. */
function createDisabledMovementPlan({
  rawIntent,
}: {
  rawIntent: MovementRawIntent;
}): MovementSnapPlan {
  return Object.freeze({
    rawIntent,
    nextPosition: rawIntent.position,
    predictedBounds: rawIntent.bounds,
    constraints: Object.freeze({ x: null, y: null }),
    verificationEpsilon: MOVEMENT_SNAP_VERIFICATION_EPSILON,
  });
}

/** Selects exactly one held or fresh constraint per axis. */
function resolveAxisProposal({
  axis,
  baseline,
  intent,
  hold,
}: {
  axis: MovementSceneAxis;
  baseline: MovementGestureBaseline;
  intent: MovementRawIntent;
  hold: MovementAxisHold;
}): MovementAxisProposal | null {
  if (!intent.axes[axis]) return null;

  const heldProposal = resolveHeldAxisProposal({
    axis,
    baseline,
    intent,
    hold,
  });
  if (heldProposal) return heldProposal;

  const line = resolveAcquiredLineConstraint({
    axis,
    bounds: intent.bounds,
    candidates: baseline.candidates,
    threshold: baseline.thresholds.acquire,
  });
  const spacing = resolveSpacingConstraint({
    axis,
    baseline,
    bounds: intent.bounds,
    threshold: baseline.thresholds.acquire,
    transition: "acquired",
  });

  return selectAcquiredAxisProposal({
    bounds: intent.bounds,
    line,
    spacing,
  });
}

/** Keeps the previous line/spacing constraint inside its release zone. */
function resolveHeldAxisProposal({
  axis,
  baseline,
  intent,
  hold,
}: {
  axis: MovementSceneAxis;
  baseline: MovementGestureBaseline;
  intent: MovementRawIntent;
  hold: MovementAxisHold;
}): MovementAxisProposal | null {
  if (hold.kind === "line") {
    return resolveHeldLineConstraint({
      axis,
      bounds: intent.bounds,
      hold,
      releaseThreshold: baseline.thresholds.release,
    });
  }
  if (hold.kind === "spacing") {
    return resolveHeldSpacingConstraint({
      axis,
      baseline,
      bounds: intent.bounds,
      hold,
    });
  }

  return null;
}

/** Holds the chosen line while its raw anchor stays in the release zone. */
function resolveHeldLineConstraint({
  axis,
  bounds,
  hold,
  releaseThreshold,
}: {
  axis: MovementSceneAxis;
  bounds: Bounds;
  hold: HeldMovementLineAxisHold;
  releaseThreshold: number;
}): PlannedMovementLineConstraint | null {
  const rawPosition = bounds[hold.activeAnchor];
  const distance = Math.abs(rawPosition - hold.candidate.position);
  if (distance > releaseThreshold) return null;

  return Object.freeze({
    kind: "line",
    axis,
    activeAnchor: hold.activeAnchor,
    candidate: hold.candidate,
    transition: "held",
  });
}

/** Holds one spacing candidate instead of switching inside the release zone. */
function resolveHeldSpacingConstraint({
  axis,
  baseline,
  bounds,
  hold,
}: {
  axis: MovementSceneAxis;
  baseline: MovementGestureBaseline;
  bounds: Bounds;
  hold: HeldMovementSpacingAxisHold;
}): PlannedMovementSpacingConstraint | null {
  const constraint = resolveSpacingConstraint({
    axis,
    baseline,
    bounds,
    threshold: baseline.thresholds.spacingRelease,
    previousContext: hold.context,
    transition: "held",
  });
  if (!constraint || constraint.candidateId !== hold.candidateId) return null;

  return constraint;
}

/** Picks the smaller new correction; ties prefer a line over spacing. */
function selectAcquiredAxisProposal({
  bounds,
  line,
  spacing,
}: {
  bounds: Bounds;
  line: PlannedMovementLineConstraint | null;
  spacing: PlannedMovementSpacingConstraint | null;
}): MovementAxisProposal | null {
  if (!line) return spacing;
  if (!spacing) return line;

  const lineDelta = Math.abs(
    resolveLineConstraintDelta({
      constraint: line,
      bounds,
    }),
  );

  return lineDelta <=
    Math.abs(spacing.delta) + MOVEMENT_CORRECTION_COMPARISON_EPSILON
    ? line
    : spacing;
}

/** Stabilizes spacing constraints after a joint two-axis correction. */
function resolveCompatibleMovementProposals({
  baseline,
  intent,
  proposals,
}: {
  baseline: MovementGestureBaseline;
  intent: MovementRawIntent;
  proposals: MovementAxisProposals;
}): MovementAxisProposals {
  let compatible = proposals;

  for (let pass = 0; pass < MOVEMENT_SPACING_COMPATIBILITY_PASSES; pass += 1) {
    const nextPosition = resolveNextMovementPosition({
      intent,
      proposals: compatible,
    });
    const predictedBounds = translateBounds({
      bounds: intent.bounds,
      deltaX: nextPosition.left - intent.position.left,
      deltaY: nextPosition.top - intent.position.top,
    });
    const x = resolveCompatibleSpacingProposal({
      proposal: compatible.x,
      baseline,
      intent,
      bounds: predictedBounds,
    });
    const y = resolveCompatibleSpacingProposal({
      proposal: compatible.y,
      baseline,
      intent,
      bounds: predictedBounds,
    });
    if (x === compatible.x && y === compatible.y) return compatible;

    compatible = Object.freeze({ x, y });
  }

  return compatible;
}

/** Filters secondary spacing guides, falling back to the line if the primary interval is lost. */
function resolveCompatibleSpacingProposal({
  proposal,
  baseline,
  intent,
  bounds,
}: {
  proposal: MovementAxisProposal | null;
  baseline: MovementGestureBaseline;
  intent: MovementRawIntent;
  bounds: Bounds;
}): MovementAxisProposal | null {
  if (!proposal || proposal.kind === "line") return proposal;

  const selections = resolveApplicableMovementSpacingSelections({
    constraint: proposal,
    baseline,
    bounds,
  });
  if (!selections.some(({ isPrimary }) => isPrimary)) {
    return resolveAcquiredLineConstraint({
      axis: proposal.axis,
      bounds: intent.bounds,
      candidates: baseline.candidates,
      threshold: baseline.thresholds.acquire,
    });
  }
  if (selections.length === proposal.selections.length) return proposal;

  return Object.freeze({
    ...proposal,
    selections: Object.freeze(selections),
  });
}

/** Finds the nearest fresh active-anchor to candidate pair. */
function resolveAcquiredLineConstraint({
  axis,
  bounds,
  candidates,
  threshold,
}: {
  axis: MovementSceneAxis;
  bounds: Bounds;
  candidates: readonly MovementSnapCandidate[];
  threshold: number;
}): PlannedMovementLineConstraint | null {
  let best: PlannedMovementLineConstraint | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  const anchors = axis === "x" ? X_ANCHORS : Y_ANCHORS;

  for (let anchorIndex = 0; anchorIndex < anchors.length; anchorIndex += 1) {
    const activeAnchor = anchors[anchorIndex];
    if (activeAnchor === undefined) break;
    for (const candidate of candidates) {
      if (candidate.axis !== axis) continue;

      const distance = Math.abs(bounds[activeAnchor] - candidate.position);
      if (distance > threshold) continue;
      if (
        !isBetterMovementCandidate({
          candidate,
          distance,
          current: best,
          currentDistance: bestDistance,
        })
      )
        continue;

      best = Object.freeze({
        kind: "line",
        axis,
        activeAnchor,
        candidate,
        transition: "acquired",
      });
      bestDistance = distance;
    }
  }

  return best;
}

/** Compares candidates by distance, category and stable snapshot index. */
function isBetterMovementCandidate({
  candidate,
  distance,
  current,
  currentDistance,
}: {
  candidate: MovementSnapCandidate;
  distance: number;
  current: PlannedMovementLineConstraint | null;
  currentDistance: number;
}): boolean {
  return isPreferredSnapCandidate({
    candidate,
    distance,
    bestCandidate: current?.candidate ?? null,
    bestDistance: currentDistance,
    priority: MOVEMENT_CANDIDATE_CATEGORY_PRIORITY,
    epsilon: MOVEMENT_CORRECTION_COMPARISON_EPSILON,
  });
}

/** Returns the shift the chosen regular guide requires. */
function resolveLineConstraintDelta({
  constraint,
  bounds,
}: {
  constraint: PlannedMovementLineConstraint;
  bounds: Bounds;
}): number {
  return constraint.candidate.position - bounds[constraint.activeAnchor];
}

/** Returns the shift for the chosen regular guide or equal-spacing snap. */
function resolveProposalDelta({
  proposal,
  bounds,
}: {
  proposal: MovementAxisProposal | null;
  bounds: Bounds;
}): number {
  if (!proposal) return 0;
  if (proposal.kind === "spacing") return proposal.delta;

  return resolveLineConstraintDelta({ constraint: proposal, bounds });
}

/** Turns an equal-spacing result into one axis's constraint. */
function resolveSpacingConstraint({
  axis,
  baseline,
  bounds,
  threshold,
  transition,
  previousContext = null,
}: {
  axis: MovementSceneAxis;
  baseline: MovementGestureBaseline;
  bounds: Bounds;
  threshold: number;
  transition: MovementSnapTransition;
  previousContext?: Readonly<SpacingSelectionContext> | null;
}): PlannedMovementSpacingConstraint | null {
  const calculation = calculateMovementAxisSpacing({
    axis,
    baseline,
    bounds,
    threshold,
    previousContext,
  });
  if (!calculation.context || !calculation.guides.length) return null;
  if (!calculation.selections.length) {
    throw new Error(
      "Movement spacing result must describe its selected intervals",
    );
  }

  return createPlannedMovementSpacingConstraint({
    axis,
    baseline,
    bounds,
    threshold,
    transition,
    calculation,
  });
}

/** Builds a constraint from a verified equal-spacing result. */
function createPlannedMovementSpacingConstraint({
  axis,
  baseline,
  bounds,
  threshold,
  transition,
  calculation,
}: {
  axis: MovementSceneAxis;
  baseline: MovementGestureBaseline;
  bounds: Bounds;
  threshold: number;
  transition: MovementSnapTransition;
  calculation: MovementSpacingCalculation;
}): PlannedMovementSpacingConstraint {
  const context = freezeSpacingContext({ context: calculation.context });
  if (!context)
    throw new Error("Movement spacing result must contain a context");
  const selections = freezeSpacingSelections({
    selections: calculation.selections,
  });
  const primarySelection = resolvePrimarySpacingSelection({ selections });
  const correction = resolveMovementSpacingCorrection({
    axis,
    baseline,
    bounds,
    threshold,
    selections,
    primarySelection,
  });

  return Object.freeze({
    kind: "spacing",
    axis,
    candidateId: createSpacingCandidateId({
      axis,
      chainId: correction.chain?.id ?? null,
      identity: primarySelection.identity,
      context,
    }),
    chainId: correction.chain?.id ?? null,
    context,
    delta: correction.delta,
    selections: correction.selections,
    transition,
  });
}

/** Returns the equal-spacing result's single primary interval. */
function resolvePrimarySpacingSelection({
  selections,
}: {
  selections: readonly ResolvedSpacingSelection[];
}): ResolvedSpacingSelection {
  const primarySelections = selections.filter(({ isPrimary }) => isPrimary);
  if (primarySelections.length !== 1) {
    throw new Error(
      "Movement spacing result must identify exactly one primary interval",
    );
  }

  const primary = primarySelections[0];
  if (primary === undefined) {
    throw new Error(
      "Movement spacing result must identify exactly one primary interval",
    );
  }

  return primary;
}

/** Computes thresholded equal spacing for the chosen axis. */
function calculateMovementAxisSpacing({
  axis,
  baseline,
  bounds,
  threshold,
  previousContext,
}: {
  axis: MovementSceneAxis;
  baseline: MovementGestureBaseline;
  bounds: Bounds;
  threshold: number;
  previousContext?: Readonly<SpacingSelectionContext> | null;
}): MovementSpacingCalculation {
  const params = {
    activeBounds: bounds,
    candidates: baseline.spacingBounds.map((candidate) => ({ ...candidate })),
    threshold,
    patterns:
      axis === "x"
        ? baseline.spacingPatterns.horizontal.map((pattern) => ({ ...pattern }))
        : baseline.spacingPatterns.vertical.map((pattern) => ({ ...pattern })),
    previousContext: previousContext ? { ...previousContext } : null,
    switchDistance: previousContext ? Number.POSITIVE_INFINITY : 0,
  };

  return axis === "x"
    ? calculateHorizontalSpacing(params)
    : calculateVerticalSpacing(params);
}

/** Builds a stable id from the primary interval's exact data. */
function createSpacingCandidateId({
  axis,
  chainId,
  identity,
  context,
}: {
  axis: MovementSceneAxis;
  chainId: string | null;
  identity: SpacingSelectionIdentity;
  context: SpacingSelectionContext;
}): string {
  return JSON.stringify({
    axis,
    chainId,
    context,
    identity,
  });
}

/** Computes the object's final position from one constraint per axis. */
function resolveNextMovementPosition({
  intent,
  proposals,
}: {
  intent: MovementRawIntent;
  proposals: MovementAxisProposals;
}): MovementTargetPosition {
  return Object.freeze({
    left: resolveMovementAxisPosition({
      value: intent.position.left,
      delta: resolveProposalDelta({
        proposal: proposals.x,
        bounds: intent.bounds,
      }),
      canSnap: intent.axes.x,
      hasConstraint: Boolean(proposals.x),
    }),
    top: resolveMovementAxisPosition({
      value: intent.position.top,
      delta: resolveProposalDelta({
        proposal: proposals.y,
        bounds: intent.bounds,
      }),
      canSnap: intent.axes.y,
      hasConstraint: Boolean(proposals.y),
    }),
  });
}

/** Rounds the free axis to a pixel without moving the snapped axis. */
function resolveMovementAxisPosition({
  value,
  delta,
  canSnap,
  hasConstraint,
}: {
  value: number;
  delta: number;
  canSnap: boolean;
  hasConstraint: boolean;
}): number {
  if (!canSnap) return value;
  if (hasConstraint) return value + delta;

  return Math.round(value / MOVE_SNAP_STEP) * MOVE_SNAP_STEP;
}

/** Builds the plan's constraints and shifts equal spacing on the cross axis. */
function createPlannedMovementConstraints({
  proposals,
  deltaX,
  deltaY,
}: {
  proposals: MovementAxisProposals;
  deltaX: number;
  deltaY: number;
}): MovementSnapPlan["constraints"] {
  return Object.freeze({
    x: materializeMovementConstraint({ proposal: proposals.x, deltaX, deltaY }),
    y: materializeMovementConstraint({ proposal: proposals.y, deltaX, deltaY }),
  });
}

/** Keeps a regular guide or pins equal spacing at the final position. */
function materializeMovementConstraint({
  proposal,
  deltaX,
  deltaY,
}: {
  proposal: MovementAxisProposal | null;
  deltaX: number;
  deltaY: number;
}): PlannedMovementConstraint | null {
  if (!proposal || proposal.kind === "line") return proposal;

  return Object.freeze({
    ...proposal,
    selections: Object.freeze(
      proposal.selections.map((selection) => {
        const { guide } = selection;
        const crossAxisDelta = guide.type === "horizontal" ? deltaY : deltaX;

        return Object.freeze({
          ...selection,
          guide: Object.freeze({
            ...guide,
            axis: guide.axis + crossAxisDelta,
          }),
        });
      }),
    ),
  });
}

/** Copies and freezes the chosen spacing candidates with their identity. */
function freezeSpacingSelections({
  selections,
}: {
  selections: readonly ResolvedSpacingSelection[];
}): readonly ResolvedSpacingSelection[] {
  return Object.freeze(
    selections.map((selection) => {
      const { identity } = selection;

      return Object.freeze({
        guide: Object.freeze({ ...selection.guide }),
        identity: Object.freeze({
          kind: identity.kind,
          side: identity.side,
          before: identity.before
            ? createExactBoundsSnapshot({ bounds: identity.before })
            : null,
          after: identity.after
            ? createExactBoundsSnapshot({ bounds: identity.after })
            : null,
          pattern: identity.pattern
            ? Object.freeze({ ...identity.pattern })
            : null,
        }),
        isPrimary: selection.isPrimary,
      });
    }),
  );
}

/** Copies one chosen spacing context. */
function freezeSpacingContext({
  context,
}: {
  context: SpacingSelectionContext | null;
}): SpacingSelectionContext | null {
  if (!context) return null;

  return Object.freeze({
    side: context.side,
    kind: context.kind,
    distance: context.distance,
  });
}
