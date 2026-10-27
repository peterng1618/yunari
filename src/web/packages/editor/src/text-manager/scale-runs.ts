import type { TextRun } from "@yunari/renderer-core";
import { defaultTypeSize } from "@yunari/renderer-core";
import { roundedRunSize } from "../selection-inspector/run-edits.js";

/** The type token's id, which is what carries the role. No token takes the
 *  body ratio, as the renderer's own reader does. */
function tokenIdOf(ref: string | undefined): string {
  return ref === undefined ? "body" : ref.slice("typeTokens.".length);
}

/**
 * The size a run is painted at right now: its own positive size, else the role
 * default the renderer derives from the token and the artboard.
 */
function paintedSize(run: TextRun, artboardHeight: number): number {
  const authored = run.style?.["fontSize"];
  const value =
    authored !== undefined && "value" in authored ? authored.value : undefined;
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : defaultTypeSize(tokenIdOf(run.typeToken), artboardHeight);
}

/**
 * The runs a scale gesture commits to: each one's painted size times `scaleY`,
 * rounded and floored at one, written as the run's own `fontSize`.
 *
 * Every run is pinned, not only those without a size: the object's scale is
 * about to become 1, so a run whose own size did not absorb the gesture would
 * paint smaller the moment the reset landed. That is what committing a size
 * means — a resized text no longer follows the artboard's role default.
 *
 * A scale that is not a usable multiplier — non-finite, zero, negative, or
 * exactly 1 — returns the input itself, which is the caller's signal that no
 * size was written.
 */
export function scaledRuns(
  runs: readonly TextRun[],
  scaleY: number,
  artboardHeight: number,
): readonly TextRun[] {
  if (!Number.isFinite(scaleY) || scaleY <= 0 || scaleY === 1) return runs;
  return runs.map((run) => ({
    ...run,
    style: {
      ...run.style,
      fontSize: {
        value: roundedRunSize(paintedSize(run, artboardHeight) * scaleY),
      },
    },
  }));
}
