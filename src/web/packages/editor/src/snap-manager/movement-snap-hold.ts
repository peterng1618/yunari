import type { MovementBoundsAnchor } from "./movement-snap-candidates.js";
import type {
  MovementAxisHold,
  MovementGestureBaseline,
  MovementHoldState,
  MovementSceneAxis,
} from "./movement-snapping-resolver.js";
import { assertHeldCandidateInBaseline } from "./protocol/hold.js";

/** Ensures the passed hold state belongs to the current baseline. */
export function assertMovementHoldState({
  baseline,
  holdState,
}: {
  baseline: MovementGestureBaseline;
  holdState: MovementHoldState;
}): void {
  assertAxisHold({ axis: "x", baseline, hold: holdState.x });
  assertAxisHold({ axis: "y", baseline, hold: holdState.y });
}

/** Validates a held axis's candidate and active anchor. */
function assertAxisHold({
  axis,
  baseline,
  hold,
}: {
  axis: MovementSceneAxis;
  baseline: MovementGestureBaseline;
  hold: MovementAxisHold;
}): void {
  if (hold.kind === "free") return;
  if (hold.kind === "spacing") {
    if (
      !hold.candidateId.trim() ||
      !Number.isFinite(hold.context.distance) ||
      hold.context.distance < 0
    ) {
      throw new Error(
        `Movement hold state contains an invalid ${axis} spacing constraint`,
      );
    }

    return;
  }

  const invalidConstraint = () =>
    `Movement hold state contains an invalid ${axis} constraint`;
  if (resolveAnchorAxis({ anchor: hold.activeAnchor }) !== axis) {
    throw new Error(invalidConstraint());
  }
  assertHeldCandidateInBaseline({
    axis,
    candidate: hold.candidate,
    baselineCandidates: baseline.candidates,
    equals: (first, second) =>
      first.id === second.id && first.position === second.position,
    describeAxisMismatch: invalidConstraint,
    describeNotInBaseline: () =>
      "Movement hold state candidate does not belong to the active baseline",
  });
}

/** Returns the axis of a named bounds anchor. */
function resolveAnchorAxis({
  anchor,
}: {
  anchor: MovementBoundsAnchor;
}): MovementSceneAxis {
  return anchor === "left" || anchor === "centerX" || anchor === "right"
    ? "x"
    : "y";
}
