import type { Binding, PlanTextSegment, TextRun } from "@yunari/renderer-core";

/**
 * What a value run shows while an author is working, instead of a sample.
 *
 * While editing, a value run renders a number or a dash, so the author cannot
 * see which data the run is, and a run whose sensor is missing looks identical
 * to a run that references no binding at all. This shows the structure instead:
 * the token name, marked so it can never be read as a reading.
 *
 * Editor surface only: never persisted, and a display never shows it (§67).
 */

/** Marks a placeholder as structure rather than data. */
const PLACEHOLDER_PREFIX = "@";

/** Why a run cannot name a token, if it cannot. */
type PlaceholderProblem = "undeclared" | "unmapped";

/**
 * The authoring text for one value run.
 *
 * A resolvable binding shows its semantic key; a binding the node does not
 * declare says so; a declared binding with no sensor is marked unmapped. The
 * three must stay distinct, because an author needs to tell them apart.
 */
export function runPlaceholder(
  run: Extract<TextRun, { kind: "value" }>,
  bindings: readonly Binding[],
  problem?: PlaceholderProblem,
): string {
  const binding = bindings.find((candidate) => candidate.id === run.bindingId);

  if (binding === undefined) {
    return `${PLACEHOLDER_PREFIX}(${run.bindingId}: undeclared)`;
  }

  const token = `${PLACEHOLDER_PREFIX}${binding.semanticKey}`;

  return problem === undefined ? token : `${token} (${problem})`;
}

/**
 * Rewrites a resolved run list for authoring display: each value segment shows
 * its token, and literals pass through untouched.
 *
 * The plan resolves runs positionally, so a segment's index in `segments` is the
 * index of the run it came from.
 */
export function toAuthoringSegments(
  segments: readonly PlanTextSegment[],
  runs: readonly TextRun[],
  bindings: readonly Binding[],
): readonly PlanTextSegment[] {
  return segments.map((segment, index) => {
    const run = runs[index];

    if (run === undefined || run.kind !== "value") {
      return segment;
    }

    // A segment carrying a status is a gap: the binding resolved to no reading.
    const problem: PlaceholderProblem | undefined =
      segment.status === undefined ? undefined : "unmapped";

    return { ...segment, text: runPlaceholder(run, bindings, problem) };
  });
}
