/* eslint-disable no-use-before-define -- the public runtime sits above its internal checks. */
import {
  type FinalMovementGeometry,
  FREE_MOVEMENT_HOLD_STATE,
  type MovementGestureBaseline,
  type MovementHoldState,
  type MovementRawIntent,
  type MovementSnapPlan,
  type MovementSnapVerification,
  resolveMovementSnapPlan,
  verifyMovementSnapPlan,
} from "./movement-snapping-resolver.js";
import {
  type DuplicateRuntimeStep,
  type PlannedRuntimeStep,
  type PlanToken,
  SnappingSessionProtocol,
} from "./protocol/session.js";

/** A single-use movement plan id. */
type MovementPlanToken = PlanToken;

/** A fresh pointer step that may be applied exactly once. */
type PlannedMovementRuntimeStep = PlannedRuntimeStep<MovementSnapPlan>;

/** A repeat of an already computed native pointer step. */
type DuplicateMovementRuntimeStep = DuplicateRuntimeStep<
  MovementSnapPlan,
  MovementSnapVerification
>;

/** A fresh or repeated movement-runtime result. */
type MovementRuntimeStep =
  | PlannedMovementRuntimeStep
  | DuplicateMovementRuntimeStep;

/** The idempotent result of ending a movement session. */
type MovementRuntimeCleanup = Readonly<{
  didCleanup: boolean;
}>;

/** Next local movement-session id. */
let nextMovementRuntimeSessionId = 1;

/** The immutable result of a repeated teardown. */
const EMPTY_MOVEMENT_RUNTIME_CLEANUP: MovementRuntimeCleanup = Object.freeze({
  didCleanup: false,
});

/**
 * Ties a native pointer marker to one movement plan and updates the hold after
 * verification. The runtime never mutates Fabric objects.
 */
export class MovementSnappingRuntime {
  private readonly _protocol = new SnappingSessionProtocol<
    MovementGestureBaseline,
    MovementHoldState,
    MovementRawIntent,
    MovementSnapPlan,
    MovementSnapVerification,
    FinalMovementGeometry
  >({
    label: "Movement",
    freeHoldState: FREE_MOVEMENT_HOLD_STATE,
    nextSessionId: () => {
      const id = nextMovementRuntimeSessionId;
      nextMovementRuntimeSessionId += 1;
      return id;
    },
    snapshotIntent: (intent) => intent,
    assertSameIntent: ({ record, intent }) =>
      assertSameMovementIntent({
        first: record.plan.rawIntent,
        second: intent,
      }),
    resolvePlan: ({ baseline, intent, holdState }) =>
      resolveMovementSnapPlan({ baseline, intent, holdState }),
    verifyPlan: ({ baseline, plan, finalGeometry }) =>
      verifyMovementSnapPlan({ baseline, plan, finalGeometry }),
  });

  /** Starts a new movement session with an immutable baseline. */
  startSession({ baseline }: { baseline: MovementGestureBaseline }): void {
    this._protocol.startSession({ baseline });
  }

  /** Returns the cached result instead of re-reading a mutated target. */
  getDuplicateStep({
    marker,
  }: {
    marker: object;
  }): DuplicateMovementRuntimeStep | null {
    return this._protocol.getDuplicateStep({ marker });
  }

  //** Issues at most one plan per native pointer marker. */
  resolveMovementPlan({
    marker,
    intent,
  }: {
    marker: object;
    intent: MovementRawIntent;
  }): MovementRuntimeStep {
    return this._protocol.resolveStep({ marker, intent });
  }

  /** Verifies the applied plan and updates the transient hold state. */
  verifyMovementPlan({
    token,
    finalGeometry,
  }: {
    token: MovementPlanToken;
    finalGeometry: FinalMovementGeometry;
  }): MovementSnapVerification {
    return this._protocol.verifyStep({ token, finalGeometry });
  }

  /** Ends the active session exactly once. */
  finishSession(): MovementRuntimeCleanup {
    const { didCleanup } = this._protocol.finishSession();
    if (!didCleanup) return EMPTY_MOVEMENT_RUNTIME_CLEANUP;

    return Object.freeze({ didCleanup: true });
  }
}

//** Ensures one marker is never reused with a different raw intent. */
function assertSameMovementIntent({
  first,
  second,
}: {
  first: MovementRawIntent;
  second: MovementRawIntent;
}): void {
  const sameBounds = areMovementBoundsEqual({
    first: first.bounds,
    second: second.bounds,
  });
  const samePosition =
    first.position.left === second.position.left &&
    first.position.top === second.position.top;
  const sameAxes =
    first.axes.x === second.axes.x && first.axes.y === second.axes.y;
  const sameModifiers = first.modifiers.ctrlKey === second.modifiers.ctrlKey;

  if (!sameBounds || !samePosition || !sameAxes || !sameModifiers) {
    throw new Error(
      "Native movement pointer marker was reused with a different raw intent",
    );
  }
}

/** Compares exact bounds of two raw intents with no hidden tolerance. */
function areMovementBoundsEqual({
  first,
  second,
}: {
  first: MovementRawIntent["bounds"];
  second: MovementRawIntent["bounds"];
}): boolean {
  return (
    first.left === second.left &&
    first.right === second.right &&
    first.top === second.top &&
    first.bottom === second.bottom &&
    first.centerX === second.centerX &&
    first.centerY === second.centerY
  );
}
