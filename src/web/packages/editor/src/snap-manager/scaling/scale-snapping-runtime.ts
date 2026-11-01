// Ported: fork 9efdd78a src/editor/snapping-manager/scaling/scale-snapping-runtime.ts
/* eslint-disable no-use-before-define -- the public runtime sits above its internal checks. */

import {
  type DuplicateRuntimeStep,
  type PlannedRuntimeStep,
  type PlanToken,
  SnappingSessionProtocol,
} from "../protocol/session.js";
import {
  type FinalScaleGeometry,
  FREE_SCALE_HOLD_STATE,
  refineScaleSnapPlan,
  resolveScaleSnapPlan,
  type ScaleGestureBaseline,
  type ScaleHoldState,
  type ScaleRawIntent,
  type ScaleSnapPlan,
  type ScaleSnapPlanRefinement,
  type ScaleSnapVerification,
  type ScaleStepProjectionInput,
  type VerifiedScaleGuide,
  verifyScaleSnapPlan,
} from "./scale-snapping-resolver.js";

/** A single-use scale plan id. */
type ScalePlanToken = PlanToken;

/** A fresh pointer step the object manager may apply exactly once. */
type PlannedScaleRuntimeStep = PlannedRuntimeStep<ScaleSnapPlan>;

/** A repeat of an already computed native pointer step. */
type DuplicateScaleRuntimeStep = DuplicateRuntimeStep<
  ScaleSnapPlan,
  ScaleSnapVerification
>;

/** A fresh or repeated scale-runtime result. */
type ScaleRuntimeStep = PlannedScaleRuntimeStep | DuplicateScaleRuntimeStep;

/** The idempotent result of ending a scale session. */
type ScaleRuntimeCleanup = Readonly<{
  didCleanup: boolean;
  hiddenGuides: readonly VerifiedScaleGuide[];
}>;

/** Next local scale-session id. */
let nextScaleRuntimeSessionId = 1;

/** The immutable result of a repeated teardown. */
const EMPTY_SCALE_RUNTIME_CLEANUP: ScaleRuntimeCleanup = Object.freeze({
  didCleanup: false,
  hiddenGuides: Object.freeze([]),
});

/**
 * Ties a native pointer marker to one scale plan and updates the hold after
 * verification. The runtime never mutates Fabric objects.
 */
export class ScaleSnappingRuntime {
  private readonly _protocol = new SnappingSessionProtocol<
    ScaleGestureBaseline,
    ScaleHoldState,
    ScaleRawIntent,
    ScaleSnapPlan,
    ScaleSnapVerification,
    FinalScaleGeometry,
    ScaleStepProjectionInput
  >({
    label: "Scale",
    freeHoldState: FREE_SCALE_HOLD_STATE,
    nextSessionId: () => {
      const id = nextScaleRuntimeSessionId;
      nextScaleRuntimeSessionId += 1;
      return id;
    },
    snapshotIntent: (intent) => createScaleRawIntentSnapshot(intent),
    assertSameIntent: ({ record, intent }) => {
      assertSameScaleProjectionMode({
        first: record.intent.projectionMode,
        second: intent.projectionMode,
      });
      assertSameScaleValues({
        first: record.intent.values,
        second: intent.values,
      });
      assertSameScaleModifiers({
        first: record.intent.modifiers,
        second: intent.modifiers,
      });
    },
    resolvePlan: ({ baseline, intent, holdState, stepProjection }) =>
      resolveScaleSnapPlan({
        baseline,
        intent,
        holdState,
        ...(stepProjection ? { stepProjection } : {}),
      }),
    verifyPlan: ({ plan, finalGeometry }) =>
      verifyScaleSnapPlan({ plan, finalGeometry }),
  });

  /** Starts a new resize session with an immutable baseline. */
  startSession({ baseline }: { baseline: ScaleGestureBaseline }): void {
    this._protocol.startSession({ baseline });
  }

  /** Returns the cached result instead of re-reading a mutated target. */
  getDuplicateStep({
    marker,
  }: {
    marker: object;
  }): DuplicateScaleRuntimeStep | null {
    return this._protocol.getDuplicateStep({ marker });
  }

  //** Issues at most one plan per native pointer marker. */
  resolveScalePlan({
    marker,
    intent,
    stepProjection,
  }: {
    marker: object;
    intent: ScaleRawIntent;
    stepProjection?: ScaleStepProjectionInput;
  }): ScaleRuntimeStep {
    return this._protocol.resolveStep({
      marker,
      intent,
      ...(stepProjection ? { stepProjection } : {}),
    });
  }

  /** Refines the pending plan against exact domain geometry before it is applied. */
  refineScalePlan({
    token,
    refinement,
  }: {
    token: ScalePlanToken;
    refinement: ScaleSnapPlanRefinement;
  }): ScaleSnapPlan {
    return this._protocol.refineStep({
      token,
      refine: (plan) => refineScaleSnapPlan({ plan, refinement }),
    });
  }

  /** Verifies the applied plan and only then updates the transient hold state. */
  verifyScalePlan({
    token,
    finalGeometry,
  }: {
    token: ScalePlanToken;
    finalGeometry: FinalScaleGeometry;
  }): ScaleSnapVerification {
    return this._protocol.verifyStep({ token, finalGeometry });
  }

  /** Ends the session exactly once and returns the guides it still shows. */
  finishSession(): ScaleRuntimeCleanup {
    const { didCleanup, verification } = this._protocol.finishSession();
    if (!didCleanup) return EMPTY_SCALE_RUNTIME_CLEANUP;

    return Object.freeze({
      didCleanup: true,
      hiddenGuides: Object.freeze([...(verification?.guides ?? [])]),
    });
  }
}

/** Copies the step's raw values so a caller's mutation cannot change the record. */
function createScaleRawIntentSnapshot(intent: ScaleRawIntent): ScaleRawIntent {
  return Object.freeze({
    projectionMode: intent.projectionMode,
    values: Object.freeze([...intent.values]),
    modifiers: Object.freeze({
      ctrlKey: intent.modifiers.ctrlKey,
      shiftKey: intent.modifiers.shiftKey,
    }),
  });
}

//** Ensures one marker is never reused with a different projection mode. */
function assertSameScaleProjectionMode({
  first,
  second,
}: {
  first: string;
  second: string;
}): void {
  if (first !== second) {
    throw new Error(
      "Native scale pointer marker was reused with a different projection mode",
    );
  }
}

//** Ensures one marker is never reused with different transform values. */
function assertSameScaleValues({
  first,
  second,
}: {
  first: readonly number[];
  second: readonly number[];
}): void {
  const hasSameValues =
    first.length === second.length &&
    first.every((value, index) => value === second[index]);

  if (!hasSameValues) {
    throw new Error(
      "Native scale pointer marker was reused with different transform values",
    );
  }
}

//** Ensures one marker is never reused with different modifier keys. */
function assertSameScaleModifiers({
  first,
  second,
}: {
  first: ScaleRawIntent["modifiers"];
  second: ScaleRawIntent["modifiers"];
}): void {
  if (first.ctrlKey !== second.ctrlKey || first.shiftKey !== second.shiftKey) {
    throw new Error(
      "Native scale pointer marker was reused with different modifiers",
    );
  }
}
