import type { Binding, TextRun } from "@yunari/renderer-core";
import { YUNARI_TEXT_PROPERTY } from "@yunari/scene-fabric";
import {
  authoredContentOf,
  authoredRunsOf,
  lookOfRun,
  type ObjectWithText,
} from "./authored-text.js";
import { carryRunIdentity } from "./run-identity.js";

/**
 * What a run edit does to the object, as plain writes.
 *
 * `index.ts` builds a `RunTarget` per call and records the history entry; the
 * rules below are the whole of the edit, so a unit test drives the same
 * functions the editor's port does rather than a copy of them.
 */

/** A binding with `format` set, or without the field when nothing was written. */
function withBindingFormat(binding: Binding, format: string): Binding {
  const trimmed = format.trim();

  if (trimmed.length === 0) {
    const { format: _format, ...rest } = binding;
    return rest;
  }

  return { ...binding, format: trimmed };
}

/** A binding with `timeZone` pinned, or without the field when none is. */
function withBindingZone(binding: Binding, timeZone: string): Binding {
  const trimmed = timeZone.trim();

  if (trimmed.length === 0) {
    const { timeZone: _timeZone, ...rest } = binding;
    return rest;
  }

  return { ...binding, timeZone: trimmed };
}

/** A binding for `key`, with the fields the previous key's reading needed dropped. */
function reboundBinding(binding: Binding, key: string): Binding {
  // A format describes how one key's reading is written, so changing the key
  // must not leave the old reading's format behind.
  const { format: _format, timeZone: _timeZone, ...rest } = binding;
  return { ...rest, semanticKey: key };
}

/**
 * What a run write operates on: the object's authored text, and the binding
 * store the run names. `index.ts` builds one per call and records the history
 * entry; the rules below are the whole of the edit, so a unit test drives the
 * same functions the port does rather than a copy of them.
 */
export interface RunTarget {
  readonly object: ObjectWithText;
  readonly nodeId: string;
  readonly bindings: () => readonly Binding[];
  readonly setBindings: (next: readonly Binding[]) => void;
}

function replaceRuns(target: RunTarget, runs: readonly TextRun[]): void {
  target.object.set(YUNARI_TEXT_PROPERTY, {
    ...authoredContentOf(target.object),
    runs,
  });
}

/** Rewrites one run in place, keeping the rest of the authored content.
 *
 * The replacement takes the run's row identity with it: a row keyed by the run
 * object would otherwise be remounted by every edit, and `ControlText` commits
 * on Enter — the field would lose the caret on the common path (`vg-249`). */
function rewriteRun(
  target: RunTarget,
  index: number,
  change: (run: TextRun) => TextRun,
): boolean {
  const runs = authoredRunsOf(target.object);
  const previous = runs[index];
  if (previous === undefined) return false;

  const replacement = change(previous);
  carryRunIdentity(previous, replacement);
  replaceRuns(
    target,
    runs.map((run, at) => (at === index ? replacement : run)),
  );
  return true;
}

/** What a prose run says. A value run has no text of its own to write. */
export function writeRunText(
  target: RunTarget,
  index: number,
  text: string,
): boolean {
  return rewriteRun(target, index, (run) =>
    run.kind === "literal" ? { ...run, text } : run,
  );
}

/** The preset reference a run is set in. */
export function writeRunPreset(
  target: RunTarget,
  index: number,
  ref: string,
): boolean {
  return rewriteRun(target, index, (run) => ({
    ...run,
    typeToken: ref as `typeTokens.${string}`,
  }));
}

/** The palette reference a run's colour is set to, in the style map. */
export function writeRunColour(
  target: RunTarget,
  index: number,
  ref: string,
): boolean {
  return rewriteRun(target, index, (run) => ({
    ...run,
    style: { ...run.style, color: { ref: ref as `palette.${string}` } },
  }));
}

/** Whether a value run prints its own unit. Clearing it is not "none". */
export function writeUnitDisplay(
  target: RunTarget,
  index: number,
  value: string,
): boolean {
  return rewriteRun(target, index, (run) => {
    if (run.kind !== "value") return run;
    const { unitDisplay: _previous, ...rest } = run;
    return value === ""
      ? rest
      : {
          ...rest,
          unitDisplay: value as NonNullable<
            Extract<TextRun, { kind: "value" }>["unitDisplay"]
          >,
        };
  });
}

/**
 * What a run reads: a literal becomes a reading and back without a second
 * surface. A binding belongs to the node, so the two are written together — the
 * run first, because the port's write repaints from the samples and must find
 * the run list it is repainting.
 */
export function writeRunSource(
  target: RunTarget,
  index: number,
  semanticKey: string,
): boolean {
  const runs = authoredRunsOf(target.object);
  const run = runs[index];
  if (run === undefined) return false;

  const bindings = target.bindings();
  const bound =
    run.kind === "value"
      ? bindings.find((binding) => binding.id === run.bindingId)
      : undefined;

  if (semanticKey === "") {
    // Back to prose: the run keeps its look, and the reading it named goes with
    // it, because nothing else can be reading that binding.
    rewriteRun(target, index, (candidate) => ({
      kind: "literal",
      text: "",
      ...lookOfRun(candidate),
    }));
    target.setBindings(bindings.filter((binding) => binding.id !== bound?.id));
    return true;
  }

  const id = bound?.id ?? `binding-${crypto.randomUUID()}`;
  if (run.kind !== "value" || run.bindingId !== id) {
    rewriteRun(target, index, (candidate) => ({
      kind: "value",
      bindingId: id,
      ...lookOfRun(candidate),
    }));
  }
  target.setBindings(
    bound === undefined
      ? [...bindings, { id, semanticKey }]
      : bindings.map((binding) =>
          binding.id === id ? reboundBinding(binding, semanticKey) : binding,
        ),
  );
  return true;
}

/** How a value run's reading is written out. Clearing it means the key's own default. */
export function writeBindingFormat(
  target: RunTarget,
  index: number,
  format: string,
): boolean {
  const run = authoredRunsOf(target.object)[index];
  const bound =
    run?.kind === "value"
      ? target.bindings().find((binding) => binding.id === run.bindingId)
      : undefined;
  if (bound === undefined) return false;
  target.setBindings(
    target
      .bindings()
      .map((binding) =>
        binding.id === bound.id ? withBindingFormat(binding, format) : binding,
      ),
  );
  return true;
}

/** Which zone a reading is taken in; empty follows the display. */
export function writeBindingZone(
  target: RunTarget,
  index: number,
  zone: string,
): boolean {
  const run = authoredRunsOf(target.object)[index];
  const bound =
    run?.kind === "value"
      ? target.bindings().find((binding) => binding.id === run.bindingId)
      : undefined;
  if (bound === undefined) return false;
  target.setBindings(
    target
      .bindings()
      .map((binding) =>
        binding.id === bound.id ? withBindingZone(binding, zone) : binding,
      ),
  );
  return true;
}

/** Alignment, overflow and vertical alignment, in the same authored content the runs live in. */
export function writeTextLayout(
  target: RunTarget,
  patch: {
    readonly align?: string;
    readonly verticalAlign?: string;
    readonly overflow?: string;
  },
): boolean {
  target.object.set(YUNARI_TEXT_PROPERTY, {
    ...authoredContentOf(target.object),
    ...patch,
  });
  return true;
}

/**
 * A new run, looking the way the one before it does.
 *
 * Inheriting is the only default that is never wrong: a unit appended to a
 * reading wants the reading's colour and a smaller preset, and a run that
 * arrived in a different face reads as a mistake before the author has chosen
 * its own.
 */
export function appendRun(target: RunTarget): boolean {
  const last = authoredRunsOf(target.object).at(-1);
  const inherited = last === undefined ? {} : lookOfRun(last);
  replaceRuns(target, [
    ...authoredRunsOf(target.object),
    { kind: "literal", text: "", ...inherited },
  ]);
  return true;
}

/**
 * Drops a run, and the binding it was the only reader of.
 *
 * The binding goes with it for the reason `writeRunSource` gives when a run
 * returns to prose: nothing else can be reading it, and a binding left behind is
 * one the document declares and no run can paint.
 */
export function dropRun(target: RunTarget, index: number): boolean {
  const runs = authoredRunsOf(target.object);
  const gone = runs[index];
  replaceRuns(
    target,
    runs.filter((_, at) => at !== index),
  );
  if (gone?.kind === "value") {
    target.setBindings(
      target.bindings().filter((binding) => binding.id !== gone.bindingId),
    );
  }
  return true;
}
