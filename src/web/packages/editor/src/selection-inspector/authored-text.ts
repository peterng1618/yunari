import type { TextRun } from "@yunari/renderer-core";
import { YUNARI_TEXT_PROPERTY } from "@yunari/scene-fabric";

/**
 * The authored text a run lives in, as plain reads.
 *
 * The one property that owns a text object's runs, and the reads that pull them
 * out of it. Read here rather than in the editor because both the projection
 * and the write rules need them — through `YUNARI_TEXT_PROPERTY`, which
 * `scene-fabric` owns and the rest of the editor already imports, so this file
 * is not a second spelling of the key.
 */

/** The two property accesses a run read or write needs, so a test can drive the
 *  rules over a plain object rather than standing up a canvas. */
export interface ObjectWithText {
  get(name: string): unknown;
  set(name: string, value: unknown): void;
}

/** The runs of a text object, or none when it is not a run-bearing object. */
export function textRunsOf(object: ObjectWithText): readonly TextRun[] {
  const content = object.get(YUNARI_TEXT_PROPERTY) as
    | { readonly runs?: readonly TextRun[] }
    | undefined;
  return content?.runs ?? [];
}

/** The authored text content, or undefined when the object has none. */
export function authoredContentOf(
  object: ObjectWithText,
): Record<string, unknown> | undefined {
  const content = object.get(YUNARI_TEXT_PROPERTY);
  return typeof content === "object" && content !== null
    ? (content as Record<string, unknown>)
    : undefined;
}

/** The runs the object carries, read through the one property that owns them. */
export function authoredRunsOf(object: ObjectWithText): readonly TextRun[] {
  const runs = authoredContentOf(object)?.["runs"];
  return Array.isArray(runs) ? (runs as readonly TextRun[]) : [];
}

/** The parts of a run that say how it looks, whichever kind it is. */
export function lookOfRun(run: TextRun): Pick<TextRun, "typeToken" | "style"> {
  return {
    typeToken: run.typeToken,
    ...(run.style === undefined ? {} : { style: run.style }),
  };
}
