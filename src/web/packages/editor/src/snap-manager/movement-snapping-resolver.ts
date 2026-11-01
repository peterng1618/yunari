/* eslint-disable no-use-before-define -- public contracts sit above the internal calculations. */

import {
  type MovementBoundsAnchor,
  type MovementSceneAxis,
  type MovementSnapCandidate,
  type MovementSnapCandidateCategory,
  type MovementSnapEnvironment,
  type MovementSnapSpacingSource,
} from "./movement-snap-candidates.js";
import {
  createExactBoundsSnapshot,
  createPositionSnapshot,
} from "./movement-snap-intent.js";
import { resolveMovementPlan } from "./movement-snap-plan.js";
import { verifyMovementPlan } from "./movement-snap-verification.js";
import { createFreeHoldState } from "./protocol/hold.js";
import { createSnapThresholds } from "./protocol/intent.js";
import type {
  ResolvedSpacingSelection,
  SpacingSelectionContext,
} from "./spacing.js";
import {
  ACTIVE_MOVEMENT_SPACING_SOURCE_ID,
  createMovementSpacingChains,
  type MovementSpacingChains,
} from "./spacing-chains.js";
import { buildSpacingPatterns } from "./spacing-patterns.js";
import type {
  Bounds,
  GuideLine,
  SpacingGuide,
  SpacingPattern,
} from "./types.js";

export type {
  MovementBoundsAnchor,
  MovementSceneAxis,
} from "./movement-snap-candidates.js";

/** The dragged object's Fabric origin position. */
export type MovementTargetPosition = Readonly<{
  left: number;
  top: number;
}>;

/** One axis with no held guide. */
export type FreeMovementAxisHold = Readonly<{
  kind: "free";
}>;

/** A held line and the dragged object's matching anchor. */
export type HeldMovementLineAxisHold = Readonly<{
  kind: "line";
  candidate: MovementSnapCandidate;
  activeAnchor: MovementBoundsAnchor;
}>;

/** A held equal-spacing interval. */
export type HeldMovementSpacingAxisHold = Readonly<{
  kind: "spacing";
  candidateId: string;
  context: Readonly<SpacingSelectionContext>;
}>;

/** A free or held axis state. */
export type MovementAxisHold =
  | FreeMovementAxisHold
  | HeldMovementLineAxisHold
  | HeldMovementSpacingAxisHold;

/** Independent transient line/spacing constraints for the two axes. */
export type MovementHoldState = Readonly<{
  x: MovementAxisHold;
  y: MovementAxisHold;
}>;

/** One gesture's thresholds in scene coordinates. */
type MovementSnapThresholds = Readonly<{
  acquire: number;
  release: number;
  spacingRelease: number;
  verification: number;
}>;

/** Immutable snapshot of start geometry and drag targets. */
export type MovementGestureBaseline = Readonly<{
  bounds: Bounds;
  position: MovementTargetPosition;
  candidates: readonly MovementSnapCandidate[];
  spacingBounds: readonly Bounds[];
  spacingChains: MovementSpacingChains;
  spacingPatterns: Readonly<{
    vertical: readonly SpacingPattern[];
    horizontal: readonly SpacingPattern[];
  }>;
  thresholds: MovementSnapThresholds;
}>;

/** Axes that may snap during the current movement step. */
export type MovementSnapAxes = Readonly<{
  x: boolean;
  y: boolean;
}>;

/** The object's raw state after the Fabric drag, before snapping. */
export type MovementRawIntent = Readonly<{
  bounds: Bounds;
  position: MovementTargetPosition;
  axes: MovementSnapAxes;
  modifiers: Readonly<{
    ctrlKey: boolean;
  }>;
}>;

/** How the current step selects its constraint. */
export type MovementSnapTransition = "acquired" | "held";

/** The chosen line and anchor on one axis. */
export type PlannedMovementLineConstraint = Readonly<{
  kind: "line";
  axis: MovementSceneAxis;
  activeAnchor: MovementBoundsAnchor;
  candidate: MovementSnapCandidate;
  transition: MovementSnapTransition;
}>;

/** The chosen equal-spacing interval on one axis. */
export type PlannedMovementSpacingConstraint = Readonly<{
  kind: "spacing";
  axis: MovementSceneAxis;
  candidateId: string;
  chainId: string | null;
  context: Readonly<SpacingSelectionContext>;
  delta: number;
  selections: readonly ResolvedSpacingSelection[];
  transition: MovementSnapTransition;
}>;

/** The single line or spacing constraint of one axis. */
export type PlannedMovementConstraint =
  | PlannedMovementLineConstraint
  | PlannedMovementSpacingConstraint;

/** One final-translation result computed for the current raw state. */
export type MovementSnapPlan = Readonly<{
  rawIntent: MovementRawIntent;
  nextPosition: MovementTargetPosition;
  predictedBounds: Bounds;
  constraints: Readonly<{
    x: PlannedMovementConstraint | null;
    y: PlannedMovementConstraint | null;
  }>;
  verificationEpsilon: number;
}>;

/** The actual state after a movement plan is applied once. */
export type FinalMovementGeometry = Readonly<{
  bounds: Bounds;
  position: MovementTargetPosition;
}>;

/** A line guide verified against the actual geometry. */
export type VerifiedMovementGuide = Readonly<{
  axis: MovementSceneAxis;
  activeAnchor: MovementBoundsAnchor;
  position: number;
  candidateId: string;
  category: MovementSnapCandidateCategory;
  snapshotIndex: number;
}>;

/** Verified guides plus the new transient hold state. */
export type MovementSnapVerification = Readonly<{
  guides: readonly VerifiedMovementGuide[];
  spacingGuides: readonly SpacingGuide[];
  blockedAxes: readonly MovementSceneAxis[];
  holdState: MovementHoldState;
}>;

/** One axis's constraint choice before guide materialization. */
export type MovementAxisProposal = Readonly<
  PlannedMovementLineConstraint | PlannedMovementSpacingConstraint
>;

/** Both axes' constraints before the final plan materializes. */
export type MovementAxisProposals = Readonly<{
  x: MovementAxisProposal | null;
  y: MovementAxisProposal | null;
}>;

/** Shared tolerance for verifying an applied movement plan. */
const MOVEMENT_SNAP_VERIFICATION_EPSILON = 0.1;

/** The initial state with no held line guides. */
export const FREE_MOVEMENT_HOLD_STATE: MovementHoldState =
  createFreeHoldState();

/**
 * Validates and captures the gesture's start geometry, targets and thresholds.
 */
export function createMovementGestureBaseline({
  bounds,
  position,
  environment,
}: {
  bounds: Bounds;
  position: MovementTargetPosition;
  environment: MovementSnapEnvironment;
}): MovementGestureBaseline {
  const exactBounds = createExactBoundsSnapshot({ bounds });
  const exactPosition = createPositionSnapshot({ position });
  const spacingSources = environment.spacingSources.map(
    ({ id, bounds: candidateBounds }) => {
      return Object.freeze({
        id,
        bounds: createExactBoundsSnapshot({ bounds: candidateBounds }),
      });
    },
  );
  const spacingBounds = spacingSources.map(
    ({ bounds: candidateBounds }) => candidateBounds,
  );
  const spacingPatterns = buildSpacingPatterns({ bounds: [...spacingBounds] });
  const activeSpacingSource: MovementSnapSpacingSource = Object.freeze({
    id: ACTIVE_MOVEMENT_SPACING_SOURCE_ID,
    bounds: exactBounds,
  });

  return Object.freeze({
    bounds: exactBounds,
    position: exactPosition,
    candidates: environment.candidates,
    spacingBounds: Object.freeze(spacingBounds),
    spacingChains: createMovementSpacingChains({
      sources: [...spacingSources, activeSpacingSource],
    }),
    spacingPatterns: Object.freeze({
      vertical: Object.freeze(
        spacingPatterns.vertical.map((pattern) =>
          Object.freeze({ ...pattern }),
        ),
      ),
      horizontal: Object.freeze(
        spacingPatterns.horizontal.map((pattern) =>
          Object.freeze({ ...pattern }),
        ),
      ),
    }),
    thresholds: createMovementSnapThresholds({ zoom: environment.zoom }),
  });
}

/**
 * Computes one final translation from the raw intent and current hold state.
 */
export function resolveMovementSnapPlan({
  baseline,
  intent,
  holdState,
}: {
  baseline: MovementGestureBaseline;
  intent: MovementRawIntent;
  holdState: MovementHoldState;
}): MovementSnapPlan {
  return resolveMovementPlan({ baseline, intent, holdState });
}

/**
 * Verifies the actual geometry, then updates the hold state and guides.
 */
export function verifyMovementSnapPlan({
  baseline,
  plan,
  finalGeometry,
}: {
  baseline: MovementGestureBaseline;
  plan: MovementSnapPlan;
  finalGeometry: FinalMovementGeometry;
}): MovementSnapVerification {
  return verifyMovementPlan({ baseline, plan, finalGeometry });
}

/** Converts verified movement guides into the renderer's format. */
export function createMovementGuideLines({
  guides,
}: {
  guides: readonly VerifiedMovementGuide[];
}): GuideLine[] {
  return guides.map(({ axis, position }) => ({
    type: axis === "x" ? "vertical" : "horizontal",
    position,
  }));
}

/** Converts the thresholds from screen pixels into scene coordinates. */
function createMovementSnapThresholds({
  zoom,
}: {
  zoom: number;
}): MovementSnapThresholds {
  return createSnapThresholds({
    zoom,
    verification: MOVEMENT_SNAP_VERIFICATION_EPSILON,
  });
}
