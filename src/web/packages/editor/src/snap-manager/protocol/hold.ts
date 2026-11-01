/** One axis with no held guide. */
export type FreeAxisHold = Readonly<{
  kind: "free";
}>;

/** The shared immutable free-axis state. */
export const FREE_AXIS_HOLD: FreeAxisHold = Object.freeze({ kind: "free" });

/** The initial two-axis state with no held guides. */
export function createFreeHoldState(): Readonly<{
  x: FreeAxisHold;
  y: FreeAxisHold;
}> {
  return Object.freeze({
    x: FREE_AXIS_HOLD,
    y: FREE_AXIS_HOLD,
  });
}

/**
 * Refuses a held candidate that does not belong to the current gesture:
 * it must sit on the same axis and at the same snapshot index as a baseline
 * candidate with identical data. The caller supplies its family's wording.
 */
export function assertHeldCandidateInBaseline<
  Axis extends "x" | "y",
  Candidate extends { axis: Axis; snapshotIndex: number },
>({
  axis,
  candidate,
  baselineCandidates,
  equals,
  describeAxisMismatch,
  describeNotInBaseline,
}: {
  axis: Axis;
  candidate: Candidate;
  baselineCandidates: readonly Candidate[];
  equals: (first: Candidate, second: Candidate) => boolean;
  describeAxisMismatch: () => string;
  describeNotInBaseline: () => string;
}): void {
  if (candidate.axis !== axis) {
    throw new Error(describeAxisMismatch());
  }

  const baselineCandidate = baselineCandidates[candidate.snapshotIndex];
  if (!baselineCandidate || !equals(baselineCandidate, candidate)) {
    throw new Error(describeNotInBaseline());
  }
}
