/* eslint-disable no-use-before-define -- the public controller sits above its internal checks. */

import type { Canvas, FabricObject, TPointerEvent, Transform } from "fabric/es";
import { ActiveSelection } from "fabric/es";
import type { ObjectBounds } from "../bounds.js";
import {
  collectSnapSources,
  readMovementMarker,
  readMovementModifiers,
} from "../index.js";
import { isSupportedActiveSelection } from "../selection-eligibility.js";
import type { GuideLine } from "../types.js";
import {
  createRectangularScaleGestureProjection,
  createRectangularScaleProjectionModes,
  type RectangularScaleGestureProjection,
  type RectangularScalePoint,
  resolveRectangularScaleMovingEdges,
} from "./rectangular-scale-gesture-projection.js";
import {
  applyRectangularScalePlan,
  readAppliedRectangularScaleMultipliers,
  readFinalRectangularScaleGeometry,
  resolveRectangularScaleStepInput,
} from "./rectangular-scale-interaction.js";
import { createScaleSnapCandidates } from "./scale-snap-candidates.js";
import {
  createScaleGestureBaseline,
  type ScaleRawIntent,
  type VerifiedScaleGuide,
} from "./scale-snapping-resolver.js";
import { ScaleSnappingRuntime } from "./scale-snapping-runtime.js";
import {
  didSideScaleSwitchToSkew,
  isStandardRectangularScaleControl,
} from "./standard-scale-control.js";

/**
 * The `object:scaling` and `mouse:down` payloads, plus the fields Fabric adds.
 * `pointer` is the `object:scaling` local pointer; `scenePoint` is the only
 * point `mouse:down` carries, so the gesture start reads it first.
 */
export type ScaleSnappingEvent = Readonly<{
  target?: FabricObject | null;
  e?: TPointerEvent | null;
  transform?: Transform | null;
  pointer?: RectangularScalePoint;
  scenePoint?: RectangularScalePoint;
}>;

interface ScaleSnappingController {
  /** Captures the gesture at `mouse:down`, before Fabric moves the object. */
  startGesture(event: ScaleSnappingEvent | undefined): void;
  /** Handles one `object:scaling` step and returns the guides it verified. */
  runStep(event: ScaleSnappingEvent | undefined): readonly GuideLine[];
  /** Ends the session; safe to call when none is active. */
  finishGesture(): void;
}

interface ScaleSnappingControllerOptions {
  readonly canvas: Canvas;
  readonly bounds: () => ObjectBounds;
}

/** The gesture state captured at the first step of a resize. */
type ActiveScaleGesture = Readonly<{
  projection: RectangularScaleGestureProjection;
  runtime: ScaleSnappingRuntime;
  target: FabricObject;
  transform: Transform;
}>;

/**
 * Owns resize-time snapping for one top-level object. Fabric applies the raw
 * resize before `object:scaling` fires, so each step re-plans from the object's
 * current scale and the plan is applied back through the ported applier.
 */
export function createScaleSnappingController(
  options: ScaleSnappingControllerOptions,
): ScaleSnappingController {
  const { canvas, bounds } = options;
  let gesture: ActiveScaleGesture | undefined;

  const finishGesture = (): void => {
    gesture?.runtime.finishSession();
    gesture = undefined;
  };

  const beginGesture = (
    event: ScaleSnappingEvent,
  ): ActiveScaleGesture | null => {
    const { target, transform } = event;
    // `mouse:down` carries `scenePoint`, not `pointer`; only `object:scaling`
    // carries `pointer`. Read both, as the fork does.
    const pointerStart = event.scenePoint ?? event.pointer;
    if (!target || !transform || !pointerStart) return null;
    // Fabric fires `object:scaling` only after it has already resized the
    // object, so the gesture's start geometry must be captured at `mouse:down`
    // from the transform Fabric built there. A scale action is `scaleX`,
    // `scaleY` or `scale`; anything else (a drag, a rotate) is not ours.
    if (!isScaleAction({ action: transform.action })) return null;
    if (!isSupportedScaleTarget({ target })) return null;
    if (transform.target !== target) return null;
    // The plan is derived from Fabric's own resize handle. A control that
    // replaced a behaviour handler or moved its own anchor is not that
    // gesture, and snapping it would put the object somewhere the author never
    // dragged it. Yunari's controls manager currently leaves the handlers at
    // Fabric's values, so this refuses nothing today; it is here so that
    // customising a handle cannot silently defeat resize snapping.
    if (!isStandardRectangularScaleControl({ target, transform })) return null;

    // The projection reads `getCoords()`, which is the cached `aCoords`. Refresh
    // it first, as the fork's session start does, so a stale cache cannot become
    // the baseline the whole gesture is measured against.
    target.setCoords();
    const projection = createRectangularScaleGestureProjection({
      transform: {
        target,
        action: transform.action,
        corner: transform.corner,
        originX: transform.originX,
        originY: transform.originY,
        original: {
          scaleX: transform.original.scaleX,
          scaleY: transform.original.scaleY,
        },
      },
      pointerStart,
    });
    if (projection === null) return null;

    const projectionModes = createRectangularScaleProjectionModes({
      projection,
    });
    const runtime = new ScaleSnappingRuntime();
    runtime.startSession({
      baseline: createScaleGestureBaseline({
        bounds: projection.baselineBounds,
        fixedAnchor: projection.fixedAnchor,
        projectionModes,
        candidates: createScaleSnapCandidates({
          targetEdges: resolveRectangularScaleMovingEdges({ projectionModes }),
          sources: collectSnapSources({ canvas, bounds, activeObject: target }),
        }),
        zoom: canvas.getZoom() || 1,
      }),
    });

    return Object.freeze({ projection, runtime, target, transform });
  };

  const runStep = (
    event: ScaleSnappingEvent | undefined,
  ): readonly GuideLine[] => {
    if (!event) return [];
    const { target, transform } = event;
    if (!target || !transform || transform.target !== target) {
      finishGesture();
      return [];
    }

    // One marker per native pointer event: Fabric reuses one marker for every
    // handler it calls for the same pointermove, and the runtime's duplicate
    // detection is keyed on marker identity.
    const marker = readMovementMarker({ event });
    const active = gesture;
    if (active === undefined) return [];

    const duplicate = active.runtime.getDuplicateStep({ marker });
    if (duplicate)
      return createScaleGuideLines({
        guides: duplicate.verification?.guides ?? [],
      });

    const pointerEvent = event.e;
    if (!pointerEvent) return [];

    // Fabric's alt-action key is Shift (its value, not its name): held on a side
    // handle it turns the resize into a skew, so the plan no longer describes
    // the gesture. Hand it back untouched rather than apply a stale plan.
    if (
      didSideScaleSwitchToSkew({
        controlKey: active.projection.controlKey,
        pointerEvent,
        target: active.target,
      })
    ) {
      finishGesture();
      return [];
    }

    const stepInput = resolveRectangularScaleStepInput({
      canvas,
      event: { e: pointerEvent },
      intentSource: "fabric-preview",
      projection: active.projection,
      target: active.target,
    });
    if (stepInput === null) return [];

    // One shared reader supplies both Ctrl's snap escape and Shift's scale mode;
    // reading only the Fabric pointer event here would let the two paths drift.
    const intent: ScaleRawIntent = Object.freeze({
      projectionMode: stepInput.intent.projectionMode,
      values: stepInput.intent.values,
      modifiers: readMovementModifiers({ event }),
    });
    const step = active.runtime.resolveScalePlan({ marker, intent });
    if (step.kind === "duplicate") {
      return createScaleGuideLines({ guides: step.verification?.guides ?? [] });
    }

    // ponytail: `refineScalePlan` is never called, so a plan Fabric's own scale
    // constraints block (minScaleLimit, uniform scaling, flipping) is left
    // blocked: `verifyScalePlan` reports it through `blockedAxes` and no guide
    // is published. Fails closed, which is the right first behaviour. Upgrade
    // path: re-solve here from the geometry Fabric actually applied, which is
    // what the fork's selection-scale path does.
    applyRectangularScalePlan({
      plan: step.plan,
      projection: active.projection,
      target: active.target,
      transform: active.transform,
    });
    const multipliers = readAppliedRectangularScaleMultipliers({
      projection: active.projection,
      target: active.target,
    });
    // Nothing in this path writes width, height, angle or skew: the applier
    // only sets scaleX/scaleY and the fixed anchor, so protected state survives.
    const verification = active.runtime.verifyScalePlan({
      token: step.token,
      finalGeometry: readFinalRectangularScaleGeometry({
        mode: stepInput.mode,
        multipliers,
        plan: step.plan,
        protectedStatePreserved: true,
        target: active.target,
        transform: active.transform,
      }),
    });
    canvas.requestRenderAll();

    return createScaleGuideLines({ guides: verification.guides });
  };

  return {
    startGesture(event): void {
      finishGesture();
      gesture = event ? (beginGesture(event) ?? undefined) : undefined;
    },
    runStep,
    finishGesture,
  };
}

/** Whether Fabric's transform action is a scale rather than a drag or rotate. */
function isScaleAction({ action }: { action: Transform["action"] }): boolean {
  return action === "scale" || action === "scaleX" || action === "scaleY";
}

/**
 * Whether this resize may snap at all. A group child is supported: the
 * projection and the applied anchor are both converted between the canvas plane
 * and the child's own plane, so a rotated or scaled group does not make them
 * disagree.
 */
function isSupportedScaleTarget({ target }: { target: FabricObject }): boolean {
  if (target instanceof ActiveSelection)
    return isSupportedActiveSelection({ selection: target });

  return true;
}

/** Converts verified scale guides into the renderer's guide lines. */
function createScaleGuideLines({
  guides,
}: {
  guides: readonly VerifiedScaleGuide[];
}): GuideLine[] {
  return guides.map(({ axis, position }) => ({
    type: axis === "x" ? "vertical" : "horizontal",
    position,
  }));
}
