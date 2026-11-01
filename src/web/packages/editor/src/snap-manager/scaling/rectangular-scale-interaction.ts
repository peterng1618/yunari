// Ported: fork 9efdd78a src/editor/snapping-manager/scaling/rectangular-scale-interaction.ts
/* eslint-disable no-use-before-define -- the public operations sit above their internal calculations. */
import {
  type Canvas,
  type FabricObject,
  type TPointerEvent,
  type Transform,
} from "fabric/es";

import {
  canvasPointToParentPlane,
  parentPlanePointToCanvas,
} from "../../object-plane.js";
import { getObjectExactBounds, type ObjectBounds } from "../bounds.js";
import {
  createRectangularScaleValues,
  type RectangularScaleGestureMode,
  type RectangularScaleGestureProjection,
  type RectangularScaleMultipliers,
  type RectangularScalePoint,
  resolveRectangularScaleMultipliers,
  resolveRectangularScalePointerMultipliers,
} from "./rectangular-scale-gesture-projection.js";
import type {
  FinalScaleGeometry,
  ScaleRawIntent,
  ScaleSnapPlan,
} from "./scale-snapping-resolver.js";

/** The source of one rectangular scale step's multipliers. */
type RectangularScaleIntentSource = "fabric-preview" | "pointer-projection";

/** The event data shared by image scaling and general selection scaling. */
type RectangularScaleStepEvent = Readonly<{
  e?: TPointerEvent | null;
  scenePoint?: RectangularScalePoint;
}>;

/** The validated input of one rectangular scale step. */
type RectangularScaleStepInput = Readonly<{
  intent: ScaleRawIntent;
  mode: RectangularScaleGestureMode;
}>;

/** Tolerance when comparing proportional scale multipliers. */
const RECTANGULAR_SCALE_INTERACTION_EPSILON = 0.000000001;

/** Picks the mode and returns the validated input of the current step. */
export function resolveRectangularScaleStepInput({
  canvas,
  event,
  intentSource,
  mode: requestedMode,
  projection,
  target,
}: {
  canvas: Canvas;
  event: RectangularScaleStepEvent;
  intentSource: RectangularScaleIntentSource;
  mode?: RectangularScaleGestureMode;
  projection: RectangularScaleGestureProjection;
  target: FabricObject;
}): RectangularScaleStepInput | null {
  const pointerEvent = event.e;
  if (!pointerEvent) return null;

  const mode =
    requestedMode ??
    resolveRectangularScaleGestureMode({ canvas, pointerEvent, projection });
  const multipliers = resolveRawMultipliers({
    event,
    intentSource,
    mode,
    projection,
    target,
  });
  if (!multipliers || multipliers.x <= 0 || multipliers.y <= 0) return null;

  return Object.freeze({
    intent: createRectangularScaleIntent({ mode, multipliers, pointerEvent }),
    mode,
  });
}

/** Applies the calculated plan to the Fabric object around the gesture's fixed point. */
export function applyRectangularScalePlan({
  plan,
  projection,
  target,
  transform,
}: {
  plan: ScaleSnapPlan;
  projection: RectangularScaleGestureProjection;
  target: FabricObject;
  transform: Transform;
}): void {
  const multipliers = resolveRectangularScaleMultipliers({
    projectionMode: plan.projectionMode,
    effectiveValues: plan.effectiveValues,
  });
  if (multipliers.x <= 0 || multipliers.y <= 0) {
    throw new Error("Rectangular scale plan must contain positive multipliers");
  }

  target.set({
    scaleX: projection.originalScales.x * multipliers.x,
    scaleY: projection.originalScales.y * multipliers.y,
  });
  transform.scaleX = target.scaleX;
  transform.scaleY = target.scaleY;
  // The projection's anchor is a canvas point; a group member's position is
  // written in its own plane. Writing the canvas point into the child moved it
  // by the group's transform a second time.
  target.setPositionByOrigin(
    canvasPointToParentPlane({
      object: target,
      point: projection.fixedAnchor,
    }),
    transform.originX,
    transform.originY,
  );
  target.setCoords();
}

/** Returns the positive multipliers actually applied to the Fabric object. */
export function readAppliedRectangularScaleMultipliers({
  projection,
  target,
}: {
  projection: RectangularScaleGestureProjection;
  target: FabricObject;
}): RectangularScaleMultipliers {
  const multipliers = readRectangularScaleMultipliers({ projection, target });
  if (!multipliers || multipliers.x <= 0 || multipliers.y <= 0) {
    throw new Error(
      "Rectangular scale must contain positive applied multipliers",
    );
  }

  return multipliers;
}

/** Reads the final geometry after the plan has been applied once. */
export function readFinalRectangularScaleGeometry({
  mode,
  multipliers,
  plan,
  protectedStatePreserved,
  target,
  transform,
}: {
  mode: RectangularScaleGestureMode;
  multipliers: RectangularScaleMultipliers;
  plan: ScaleSnapPlan;
  protectedStatePreserved: boolean;
  target: FabricObject;
  transform: Transform;
}): FinalScaleGeometry {
  const bounds = getObjectExactBounds({ object: target });
  if (!bounds) throw new Error("Rectangular scale needs exact final bounds");

  const anchor = parentPlanePointToCanvas({
    object: target,
    point: target.getPointByOrigin(transform.originX, transform.originY),
  });

  return Object.freeze({
    bounds,
    fixedAnchor: createScaleScenePoint({ point: anchor }),
    measuredValues: createRectangularScaleValues({ mode, multipliers }),
    domainVerdict: Object.freeze({
      x: didReachScaleConstraint({
        bounds,
        constraint: plan.constraints.x,
        epsilon: plan.verificationEpsilon,
      })
        ? "satisfied"
        : "blocked",
      y: didReachScaleConstraint({
        bounds,
        constraint: plan.constraints.y,
        epsilon: plan.verificationEpsilon,
      })
        ? "satisfied"
        : "blocked",
      protectedState: protectedStatePreserved ? "preserved" : "changed",
    }),
  });
}

/** Chooses how the handle resizes, given the handle and Fabric's settings. */
function resolveRectangularScaleGestureMode({
  canvas,
  pointerEvent,
  projection,
}: {
  canvas: Canvas;
  pointerEvent: TPointerEvent;
  projection: RectangularScaleGestureProjection;
}): RectangularScaleGestureMode {
  const { controlKey } = projection;
  if (controlKey === "ml" || controlKey === "mr") return "horizontal";
  if (controlKey === "mt" || controlKey === "mb") return "vertical";

  const { uniformScaling, uniScaleKey } = canvas;
  const uniformIsToggled = Boolean(
    uniScaleKey && Reflect.get(pointerEvent, uniScaleKey) === true,
  );
  const usesUniformScale =
    (uniformScaling && !uniformIsToggled) ||
    (!uniformScaling && uniformIsToggled);

  return usesUniformScale ? "uniform" : "free";
}

/** Reads the multipliers from Fabric's preview result or from the pointer position. */
function resolveRawMultipliers({
  event,
  intentSource,
  mode,
  projection,
  target,
}: {
  event: RectangularScaleStepEvent;
  intentSource: RectangularScaleIntentSource;
  mode: RectangularScaleGestureMode;
  projection: RectangularScaleGestureProjection;
  target: FabricObject;
}): RectangularScaleMultipliers | null {
  if (intentSource === "pointer-projection") {
    if (!event.scenePoint) return null;

    return resolveRectangularScalePointerMultipliers({
      projection,
      pointer: event.scenePoint,
      mode,
    });
  }

  const multipliers = readRectangularScaleMultipliers({ projection, target });
  if (!multipliers) return null;
  if (
    mode === "uniform" &&
    !areNumbersNear({
      first: multipliers.x,
      second: multipliers.y,
    })
  )
    return null;

  return multipliers;
}

/** Reads the current multipliers relative to the gesture's immutable start. */
function readRectangularScaleMultipliers({
  projection,
  target,
}: {
  projection: RectangularScaleGestureProjection;
  target: FabricObject;
}): RectangularScaleMultipliers | null {
  const x = target.scaleX / projection.originalScales.x;
  const y = target.scaleY / projection.originalScales.y;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;

  return Object.freeze({ x, y });
}

/** Builds the canonical raw intent of the shared snapping calculation. */
function createRectangularScaleIntent({
  mode,
  multipliers,
  pointerEvent,
}: {
  mode: RectangularScaleGestureMode;
  multipliers: RectangularScaleMultipliers;
  pointerEvent: TPointerEvent;
}): ScaleRawIntent {
  return Object.freeze({
    projectionMode: mode,
    values: createRectangularScaleValues({ mode, multipliers }),
    modifiers: Object.freeze({
      ctrlKey: "ctrlKey" in pointerEvent && pointerEvent.ctrlKey === true,
      shiftKey: "shiftKey" in pointerEvent && pointerEvent.shiftKey === true,
    }),
  });
}

/** Checks that one axis reached the chosen guide. */
function didReachScaleConstraint({
  bounds,
  constraint,
  epsilon,
}: {
  bounds: ObjectBounds;
  constraint: ScaleSnapPlan["constraints"]["x"];
  epsilon: number;
}): boolean {
  if (!constraint) return true;

  return (
    Math.abs(bounds[constraint.candidate.edge] - constraint.expectedPosition) <=
    epsilon
  );
}

/** Copies an endpoint into an independent scale geometry. */
function createScaleScenePoint({
  point,
}: {
  point: RectangularScalePoint;
}): RectangularScalePoint {
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
    throw new Error(
      "A rectangular scale point must contain finite coordinates",
    );
  }

  return Object.freeze({ x: point.x, y: point.y });
}

/** Compares two finite multipliers within tolerance. */
function areNumbersNear({
  first,
  second,
}: {
  first: number;
  second: number;
}): boolean {
  return (
    Number.isFinite(first) &&
    Number.isFinite(second) &&
    Math.abs(first - second) <= RECTANGULAR_SCALE_INTERACTION_EPSILON
  );
}
