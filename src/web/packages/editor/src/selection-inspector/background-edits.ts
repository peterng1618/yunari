import type { Background } from "@yunari/renderer-core";
import { writeBackgroundField } from "./background-column.js";
import type { SelectionInspectorOptions } from "./options.js";

/** Why a background commit was refused; `"ok"` means it reached the document. */
export type BackgroundCommitResult = "ok" | "stale" | "invalid";

/**
 * The background's own write funnel, beside the column that projects its
 * fields.
 *
 * The background is envelope state rather than a Fabric object, so it has no
 * object for the object inspector's writer to address. This owns the revision
 * its column is published at and the one write that reaches the document;
 * `dispatch.ts` routes a `background.*` id here, and `projection.ts` publishes
 * the view this revision keys.
 */
export interface BackgroundFunnel {
  /**
   * The revision the background's column is published at. It moves when the
   * subject becomes the background and after every commit, which is what
   * re-keys the rows and discards a draft written against the value that has
   * since changed.
   */
  revision: number;
  /** Whether the previous publish described the background. */
  describing: boolean;
  /** Marks the background as described and returns its current revision. */
  beginDescribe(): number;
  /**
   * Hands a whole background to the document, which owns the envelope. The
   * field's own rule is `writeBackgroundField`'s, beside the column that
   * projects it; `undefined` is the model refusing the value. A build with no
   * write port is no more able to write than a refused value is, so it reports
   * `"invalid"` rather than a success that changed nothing.
   */
  commit(
    expectedRevision: number,
    fieldId: string,
    value: string | number | boolean,
  ): BackgroundCommitResult;
}

export function createBackgroundFunnel(
  options: Pick<
    SelectionInspectorOptions,
    "background" | "assets" | "onBackgroundChange" | "backgroundSelected"
  >,
): BackgroundFunnel {
  const funnel: BackgroundFunnel = {
    revision: 0,
    describing: false,
    beginDescribe() {
      if (!funnel.describing) {
        funnel.describing = true;
        funnel.revision += 1;
      }
      return funnel.revision;
    },
    commit(expectedRevision, fieldId, value) {
      if (
        expectedRevision !== funnel.revision ||
        options.backgroundSelected?.() !== true
      ) {
        return "stale";
      }

      const next: Background | undefined = writeBackgroundField(
        options.background?.(),
        fieldId,
        value,
        options.assets?.() ?? [],
      );
      if (next === undefined || options.onBackgroundChange === undefined)
        return "invalid";

      options.onBackgroundChange(next);
      funnel.revision += 1;
      return "ok";
    },
  };
  return funnel;
}
