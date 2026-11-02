import type { Binding, PlanTextSegment, TextRun } from "@yunari/renderer-core";
import { lookOfRun } from "./selection-inspector/authored-text.js";

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

/** One run's authoring display, and the diagnostic spellings that may follow it. */
interface TokenSource {
  readonly run: TextRun;
  readonly tokens: readonly string[];
}

/**
 * The authored runs a flat authoring display stands for, which is the inverse
 * of `toAuthoringSegments`.
 *
 * Fabric hands back one string and no per-character run offsets, so the run
 * boundaries are recovered from the tokens the view painted. A value run's
 * `@semanticKey` survives the edit and keeps its binding; text typed between
 * tokens — including after a token and a space — becomes a literal run. A token
 * the author deleted or altered no longer matches and becomes prose, which is
 * what makes its binding go with it.
 *
 * The diagnostic suffixes the view adds (`(unmapped)`, `(id: undeclared)`) are
 * matched as part of the token so they cannot be baked into the theme as prose.
 * The longest match wins, so a key that is a prefix of another cannot split it.
 */
export function runsFromAuthoringText(
  text: string,
  runs: readonly TextRun[],
  bindings: readonly Binding[],
): TextRun[] {
  const sources: TokenSource[] = runs.map((run) =>
    run.kind === "value"
      ? {
          run,
          tokens: [
            runPlaceholder(run, bindings),
            runPlaceholder(run, bindings, "unmapped"),
          ],
        }
      : { run, tokens: [] },
  );

  const used = new Set<number>();
  const parts: { readonly text: string; readonly value?: TextRun }[] = [];
  let literalStart = 0;
  let at = 0;

  while (at < text.length) {
    let found = -1;
    let token = "";
    for (let index = 0; index < sources.length; index += 1) {
      if (used.has(index)) continue;
      for (const candidate of sources[index]?.tokens ?? []) {
        if (
          candidate.length <= token.length ||
          !text.startsWith(candidate, at)
        ) {
          continue;
        }
        found = index;
        token = candidate;
      }
    }

    if (found < 0) {
      at += 1;
      continue;
    }

    const source = sources[found];
    if (source === undefined) {
      at += 1;
      continue;
    }
    if (at > literalStart) parts.push({ text: text.slice(literalStart, at) });
    parts.push({ text: token, value: source.run });
    used.add(found);
    at += token.length;
    literalStart = at;
  }
  if (literalStart < text.length)
    parts.push({ text: text.slice(literalStart) });

  return parts.map((part, index) => {
    if (part.value !== undefined) return part.value;
    // Prose adopts the run it was typed beside: the token before it, else the
    // next token, else the text's own first run.
    const neighbour =
      parts[index - 1]?.value ??
      parts.find(
        (candidate, at2) => at2 > index && candidate.value !== undefined,
      )?.value ??
      runs[0];
    return {
      kind: "literal",
      text: part.text,
      ...(neighbour === undefined
        ? { typeToken: "typeTokens.body" as const }
        : lookOfRun(neighbour)),
    };
  });
}
