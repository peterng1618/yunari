import type { TextRun } from "@yunari/renderer-core";

/**
 * Which React row a run is, as runtime state.
 *
 * `yunariText.runs` is a plain array with no per-run id, and the ruling keeps
 * it that way: an id in the model is editor bookkeeping written into the theme
 * file. But a row's identity has to survive a *removal*, and nothing a run
 * carries can spell that — two literal runs sharing a preset are the same
 * fields, and counting repeats is positional, so removing the first renames the
 * second, React reuses the removed row for the survivor, and the survivor's
 * draft is destroyed while the removed row's is shown against it (`vg-249`).
 *
 * So the identity is the run's own object. A removal keeps the survivors'
 * objects, which is the reconciliation `vg-044` performs for a chart's paint;
 * a write replaces the object it edits, so `carryRunIdentity` hands the
 * identity to the replacement — the mutation is what keeps a preset change from
 * remounting the field under the caret.
 *
 * Runtime only, and never persisted: a reloaded document is a genuine target
 * change, and remounting every row for it is what the control set asks for.
 */
const identities = new WeakMap<TextRun, string>();
let issued = 0;

/** The row identity of a run, minted the first time one is asked for. */
export function runIdentity(run: TextRun): string {
  const known = identities.get(run);
  if (known !== undefined) return known;

  issued += 1;
  const minted = `run-${issued}`;
  identities.set(run, minted);
  return minted;
}

/** Hands `from`'s identity to the object that replaced it, so an edit keeps its
 *  row. A write that returns the run it was given carries nothing. */
export function carryRunIdentity(from: TextRun, to: TextRun): void {
  if (from === to) return;
  identities.set(to, runIdentity(from));
}
