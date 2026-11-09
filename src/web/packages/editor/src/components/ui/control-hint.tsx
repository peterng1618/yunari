import { ControlTooltip } from "../../editor-shell/controls/tooltip.js";
import { Glyph, INFO_GLYPH } from "../../editor-shell/icons.js";

/**
 * A control's explanatory sentence, carried by its own mark rather than by a
 * line of small print under the field.
 *
 * **The sentence is the button's name and its tooltip.** Hover or focus
 * reveals it, and because the name is the same string, a screen reader reads it
 * without a pointer — the pairing `ControlIconButton` already holds for an
 * action is held here for a disclosure.
 *
 * A control built from `ControlRow` passes its sentence as `hint` and gets this
 * treatment from the row. This component is for a hand-built field — a dialog's
 * number well, a source form's address input — that has no row to hand it to,
 * so the surface does not spell a third flavour of footnote paragraph.
 */
export function ControlHint(props: {
  readonly text: string;
}): React.JSX.Element {
  return (
    <ControlTooltip label={props.text}>
      <button
        type="button"
        aria-label={props.text}
        data-yunari-control-hint=""
        className="inline-flex size-[16px] flex-none items-center justify-center rounded-full text-faint hover:text-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
      >
        <Glyph icon={INFO_GLYPH} size={12} />
      </button>
    </ControlTooltip>
  );
}
