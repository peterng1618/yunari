import type * as React from "react";
import { uiCopy } from "../ui-copy.js";
import type { FontFaceEdits, FontFaceView } from "./view.js";

/**
 * The text object's face field: one button, because the catalogue browser now
 * lives in the finder's Fonts body.
 *
 * The field keeps the two ports the column already threads to it — the view it
 * describes and the writes it may ask for — so a selection's own context is
 * still what the request is made from.
 */
export function FontFaceField(props: {
  readonly view: FontFaceView;
  readonly edits: FontFaceEdits;
  /** Opens the finder on Fonts. Absent in a column built without a finder. */
  readonly onOpenFontPicker?: () => void;
}): React.JSX.Element {
  return (
    <div
      data-yunari-font-face-field=""
      className="flex flex-col gap-[var(--space-6)]"
    >
      <h3 className="m-0 text-xs font-semibold text-muted">
        {uiCopy.panels.fontFace}
      </h3>
      {/* Opening the picker is synchronous; hover raises the resting boundary
          and the press has no busy or outcome. */}
      <button
        type="button"
        data-yunari-open-font-picker=""
        onClick={() => props.onOpenFontPicker?.()}
        className="rounded-[var(--radius-sm)] border border-edge px-[var(--space-10)] py-[var(--space-6)] text-left text-sm enabled:hover:border-muted"
      >
        {uiCopy.assets.openFontPicker}
      </button>
    </div>
  );
}
