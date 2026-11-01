// Ported: fork 9efdd78a src/editor/snapping-manager/scaling/scale-snapping-resolver.ts
/* eslint-disable no-use-before-define -- the public contracts sit above the internal calculations. */

import type { ObjectBounds } from "../bounds.js";
import { createFreeHoldState } from "../protocol/hold.js";
import {
  createSnapThresholds,
  type SnapThresholds,
} from "../protocol/intent.js";
import {
  createScaleProjection,
  getScaleProjectionEdge,
  type ProjectedScaleEdgePositions,
  resolveScaleSceneEdgeAxis,
  type ScaleProjection,
  type ScaleProjectionConstraint,
  type ScaleProjectionInput,
  type ScaleProjectionVariable,
  type ScaleSceneAxis,
  type ScaleSceneEdge,
} from "./scale-projection.js";
import {
  createExactBoundsSnapshot,
  createScenePointSnapshot,
} from "./scale-snap-geometry.js";
import { refineScalePlan, resolveScalePlan } from "./scale-snap-plan.js";
import { verifyScalePlan } from "./scale-snap-verification.js";

export type { ScaleSceneAxis, ScaleSceneEdge } from "./scale-projection.js";

/** Guide category participating in the choice between equally distant candidates. */
export type ScaleSnapCandidateCategory =
  | "domain-boundary"
  | "edge"
  | "center"
  | "spacing";

/** A point in scene coordinates, independent of Fabric Point. */
export type ScaleScenePoint = Readonly<{
  x: number;
  y: number;
}>;

/** A named resize mode, before the gesture's raw data is validated. */
export type ScaleProjectionModeInput = Readonly<{
  id: string;
  projection: ScaleProjectionInput;
}>;

/** The validated resize mode for one gesture. */
export type ScaleProjectionMode = Readonly<{
  id: string;
  projection: ScaleProjection;
}>;

/** A snap candidate before the gesture's baseline state is captured. */
export type ScaleSnapCandidateInput = Readonly<{
  id: string;
  axis: ScaleSceneAxis;
  edge: ScaleSceneEdge;
  position: number;
  category: ScaleSnapCandidateCategory;
}>;

/** A candidate for one particular moving edge, captured for the gesture. */
export type ScaleSnapCandidate = Readonly<{
  id: string;
  axis: ScaleSceneAxis;
  edge: ScaleSceneEdge;
  position: number;
  category: ScaleSnapCandidateCategory;
  snapshotIndex: number;
}>;

/** Axis state without a held guide. */
export type FreeScaleAxisHold = Readonly<{
  kind: "free";
}>;

/** A held guide on one axis. */
export type HeldScaleAxisHold = Readonly<{
  kind: "held";
  candidate: ScaleSnapCandidate;
}>;

/** One axis free or held. */
export type ScaleAxisHold = FreeScaleAxisHold | HeldScaleAxisHold;

/** The temporary, independent snapping state of both axes. */
export type ScaleHoldState = Readonly<{
  x: ScaleAxisHold;
  y: ScaleAxisHold;
}>;

/** Snap thresholds in scene coordinates, with zoom applied. */
export type ScaleSnapThresholds = SnapThresholds;

/** The gesture's start geometry and the available resize modes. */
type ScaleGestureBaselineInput = Readonly<{
  bounds: ObjectBounds;
  fixedAnchor: ScaleScenePoint;
  projectionModes: readonly ScaleProjectionModeInput[];
  candidates: readonly ScaleSnapCandidateInput[];
  zoom: number;
}>;

/** The validated snapshot of the state at gesture start. */
export type ScaleGestureBaseline = Readonly<{
  bounds: ObjectBounds;
  fixedAnchor: ScaleScenePoint;
  projectionModes: readonly ScaleProjectionMode[];
  candidates: readonly ScaleSnapCandidate[];
  thresholds: ScaleSnapThresholds;
}>;

/** Modifier-key state for one pointer event. */
type ScaleSnapModifiers = Readonly<{
  ctrlKey: boolean;
  shiftKey: boolean;
}>;

/** The raw canonical values and the mode the object manager chose. */
export type ScaleRawIntent = Readonly<{
  projectionMode: string;
  values: readonly number[];
  modifiers: ScaleSnapModifiers;
}>;

/** Exact bounds and the face dependencies at the current step. */
export type ScaleStepProjectionInput = Readonly<{
  bounds: ObjectBounds;
  projection: ScaleProjectionInput;
}>;

/** The constraints of both axes chosen for one scaling step. */
export type ScaleSnapConstraints = Readonly<{
  x: PlannedScaleConstraint | null;
  y: PlannedScaleConstraint | null;
}>;

/** Translates the chosen guides into local size-projection constraints. */
export function createScaleProjectionConstraints({
  constraints,
}: {
  constraints: ScaleSnapConstraints;
}): readonly ScaleProjectionConstraint[] {
  const projectionConstraints = [constraints.x, constraints.y]
    .filter(
      (constraint): constraint is PlannedScaleConstraint => constraint !== null,
    )
    .map((constraint) =>
      Object.freeze({
        axis: constraint.axis,
        edge: constraint.candidate.edge,
        position: constraint.expectedPosition,
      }),
    );

  return Object.freeze(projectionConstraints);
}

/** The exact projection, canonical values and reached constraints after refinement. */
export type ScaleSnapPlanRefinement = Readonly<{
  constraints: ScaleSnapConstraints;
  effectiveValues: readonly number[];
  stepProjection: ScaleStepProjectionInput;
}>;

/** How the constraint was chosen at the current pointer step. */
export type ScaleSnapTransition = "acquired" | "held";

/** A constraint on one particular edge, which the object manager must apply once. */
export type PlannedScaleConstraint = Readonly<{
  axis: ScaleSceneAxis;
  candidate: ScaleSnapCandidate;
  transition: ScaleSnapTransition;
  expectedPosition: number;
}>;

/** The immutable result of the snapping calculation for one resize. */
export type ScaleSnapPlan = Readonly<{
  projectionMode: string;
  projection: ScaleProjection;
  variables: readonly ScaleProjectionVariable[];
  rawValues: readonly number[];
  effectiveValues: readonly number[];
  rawPositions: ProjectedScaleEdgePositions;
  effectivePositions: ProjectedScaleEdgePositions;
  constraints: ScaleSnapConstraints;
  refinementCandidates: ScaleSnapConstraints;
  proposedHoldState: ScaleHoldState;
  fixedAnchor: ScaleScenePoint;
  verificationEpsilon: number;
}>;

/** The result of applying one axis's constraint, as reported by the object manager. */
type ScaleDomainAxisVerdict = "satisfied" | "blocked";

/** The result of applying the constraints and checking the object's protected properties. */
type FinalScaleDomainVerdict = Readonly<{
  x: ScaleDomainAxisVerdict;
  y: ScaleDomainAxisVerdict;
  protectedState: "preserved" | "changed";
}>;

/** The actual geometry after the plan has been applied once. */
export type FinalScaleGeometry = Readonly<{
  bounds: ObjectBounds;
  fixedAnchor: ScaleScenePoint;
  measuredValues: readonly number[];
  domainVerdict: FinalScaleDomainVerdict;
}>;

/** A guide the object actually reached after the plan was applied. */
export type VerifiedScaleGuide = Readonly<{
  axis: ScaleSceneAxis;
  edge: ScaleSceneEdge;
  position: number;
  candidateId: string;
  category: ScaleSnapCandidateCategory;
  snapshotIndex: number;
}>;

/** The result of checking the applied plan, without resizing the object again. */
export type ScaleSnapVerification = Readonly<{
  guides: readonly VerifiedScaleGuide[];
  blockedAxes: readonly ScaleSceneAxis[];
  holdState: ScaleHoldState;
}>;

/** A candidate on one axis, before checking compatibility with the other axis. */
export type ScaleAxisProposal = Readonly<{
  axis: ScaleSceneAxis;
  candidate: ScaleSnapCandidate;
  transition: ScaleSnapTransition;
}>;

/** Common tolerance for checking the guide and the fixed point in scene coordinates. */
const SCALE_SNAP_VERIFICATION_EPSILON = 0.1;

/** The initial state without held guides. */
export const FREE_SCALE_HOLD_STATE: ScaleHoldState = createFreeHoldState();

/**
 * Validates and captures the geometry, scale modes, candidates and thresholds at gesture start.
 */
export function createScaleGestureBaseline({
  bounds,
  fixedAnchor,
  projectionModes,
  candidates,
  zoom,
}: ScaleGestureBaselineInput): ScaleGestureBaseline {
  const exactBounds = createExactBoundsSnapshot({ bounds });
  const anchorSnapshot = createScenePointSnapshot({
    point: fixedAnchor,
    name: "fixed anchor",
  });
  const modeSnapshot = createProjectionModeSnapshot({
    bounds: exactBounds,
    projectionModes,
  });
  const candidateSnapshot = createCandidateSnapshot({
    candidates,
    projectionModes: modeSnapshot,
  });

  return Object.freeze({
    bounds: exactBounds,
    fixedAnchor: anchorSnapshot,
    projectionModes: modeSnapshot,
    candidates: candidateSnapshot,
    thresholds: createScaleSnapThresholds({ zoom }),
  });
}

/**
 * Calculates a new snapping plan, or keeps holding the chosen guides.
 */
export function resolveScaleSnapPlan({
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
  return resolveScalePlan({
    baseline,
    intent,
    holdState,
    ...(stepProjection ? { stepProjection } : {}),
  });
}

/**
 * Refines the values and the applicable constraints from the object's actual geometry.
 * The original pointer position and the candidates available for refinement do not change.
 */
export function refineScaleSnapPlan({
  plan,
  refinement,
}: {
  plan: ScaleSnapPlan;
  refinement: ScaleSnapPlanRefinement;
}): ScaleSnapPlan {
  return refineScalePlan({ plan, refinement });
}

/**
 * Checks the plan against the actual geometry and the object manager's applied result.
 */
export function verifyScaleSnapPlan({
  plan,
  finalGeometry,
}: {
  plan: ScaleSnapPlan;
  finalGeometry: FinalScaleGeometry;
}): ScaleSnapVerification {
  return verifyScalePlan({ plan, finalGeometry });
}

/**
 * Converts the thresholds from screen pixels into scene coordinates, with zoom applied.
 */
function createScaleSnapThresholds({
  zoom,
}: {
  zoom: number;
}): ScaleSnapThresholds {
  if (!Number.isFinite(zoom) || zoom <= 0) {
    throw new Error("Scale snapping zoom must be a finite positive number");
  }

  return createSnapThresholds({
    zoom,
    verification: SCALE_SNAP_VERIFICATION_EPSILON,
  });
}

/**
 * Validates and captures every available resize mode.
 */
function createProjectionModeSnapshot({
  bounds,
  projectionModes,
}: {
  bounds: ObjectBounds;
  projectionModes: readonly ScaleProjectionModeInput[];
}): readonly ScaleProjectionMode[] {
  if (projectionModes.length === 0) {
    throw new Error(
      "Scale gesture baseline must contain at least one projection mode",
    );
  }

  const modeIds = new Set<string>();
  const snapshot = projectionModes.map(({ id, projection }) => {
    if (id.trim().length === 0 || modeIds.has(id)) {
      throw new Error(
        `Scale projection mode id "${id}" must be non-empty and unique`,
      );
    }
    modeIds.add(id);

    return Object.freeze({
      id,
      projection: createScaleProjection({ bounds, input: projection }),
    });
  });

  return Object.freeze(snapshot);
}

/**
 * Validates the candidates and keeps their original order for the gesture.
 */
function createCandidateSnapshot({
  candidates,
  projectionModes,
}: {
  candidates: readonly ScaleSnapCandidateInput[];
  projectionModes: readonly ScaleProjectionMode[];
}): readonly ScaleSnapCandidate[] {
  const candidateIds = new Set<string>();
  const snapshot = candidates.map((candidate, snapshotIndex) => {
    assertScaleCandidate({ candidate, projectionModes, candidateIds });
    candidateIds.add(candidate.id);

    return Object.freeze({ ...candidate, snapshotIndex });
  });

  return Object.freeze(snapshot);
}

/**
 * Validates a candidate's id, axis and support by at least one mode.
 */
function assertScaleCandidate({
  candidate,
  projectionModes,
  candidateIds,
}: {
  candidate: ScaleSnapCandidateInput;
  projectionModes: readonly ScaleProjectionMode[];
  candidateIds: ReadonlySet<string>;
}): void {
  if (candidate.id.trim().length === 0 || candidateIds.has(candidate.id)) {
    throw new Error(
      `Scale snap candidate id "${candidate.id}" must be non-empty and unique`,
    );
  }
  if (!Number.isFinite(candidate.position)) {
    throw new Error(
      `Scale snap candidate "${candidate.id}" position must be finite`,
    );
  }
  if (resolveScaleSceneEdgeAxis({ edge: candidate.edge }) !== candidate.axis) {
    throw new Error(
      `Scale snap candidate "${candidate.id}" edge does not belong to ${candidate.axis} axis`,
    );
  }

  const isSupported = projectionModes.some(({ projection }) => {
    return Boolean(
      getScaleProjectionEdge({ projection, edge: candidate.edge }),
    );
  });
  if (!isSupported) {
    throw new Error(
      `Scale snap candidate "${candidate.id}" edge is not moved by any projection mode`,
    );
  }
}
