import { useRef } from "react";
import { useControlTooltip } from "../../components/ui/control-icon-button.js";
import {
  Glyph,
  HIDDEN_GLYPH,
  LOCK_GLYPH,
  VISIBLE_GLYPH,
} from "../../editor-shell/icons.js";
import type { LayerRow } from "../../editor-shell/layer-tree.js";
import { uiCopy } from "../../ui-copy.js";

/**
 * The controls the attended row carries: visibility and lock.
 *
 * **The attendance rule is the whole of this component's gate.** A row whose
 * flags are both at their default carries neither state control, because two
 * flags that are both true carry no information — 104 icons reading "visible,
 * unlocked" was the measured defect, and it grows with the row count, which is
 * exactly the case a card-heavy panel hides. The author's attention (a pointer
 * over the row, or the keyboard on it) brings both; the row's own state brings
 * back the control that names it, and only that one: a hidden row is still
 * unlocked, so an unlocked row's lock icon would be noise even there.
 *
 * **Rename is not here, and it is not a missing control** (`vg-462`). It was
 * never a state — it appeared wherever either state control did, including on a
 * locked row — and the name it acted on is the one thing the row already
 * carries, so a pen beside it was a second way to reach what a double-click had
 * always opened. The row's own key route (F2 or Enter) is the third, and it
 * stays: taking the pen away must not take the keyboard with it.
 *
 * The gates live here rather than in the pane because the row's *attention* is
 * the pane's to compute and the row's *answer to it* is this component's. The
 * pane owns hover and focus; the row owns what they show.
 *
 * These are `RowControl`s rather than `ControlIconButton`s, for the reason
 * `rail.tsx` gives for its slots and not for a second one: the pressed state is
 * the whole of a visibility or lock control's state, and the control set's icon
 * button is a plain action with no `aria-pressed` to carry it. They take the
 * control set's one owner of the name/tooltip pairing instead
 * (`useControlTooltip`), so their name and their tooltip are one string
 * exactly as an icon button's are.
 *
 * They are also direct children of `.yunari-layer-state`, never wrapped: the
 * stylesheet asks that slot's own buttons how much room beside the key they
 * need (`:has(... button:nth-child(n))`), and a wrapper would put every button
 * at position one of its own parent and answer the question for one control on
 * a row that draws two.
 */
export function RowAffordances({
  row,
  attended,
  onToggleVisible,
  onToggleLocked,
}: {
  readonly row: LayerRow;
  /** Whether the author is on this row — a pointer over it, or the keyboard
   *  on it. The pane's own two facts, folded into the one the row acts on. */
  readonly attended: boolean;
  readonly onToggleVisible: () => void;
  readonly onToggleLocked: () => void;
}): React.JSX.Element {
  const showVisibility = attended || row.selected || !row.visible;
  const showLock = attended || row.selected || row.locked;
  return (
    <>
      {showVisibility ? (
        <RowControl
          label={row.visible ? uiCopy.panels.hide : uiCopy.panels.show}
          pressed={row.visible}
          onClick={onToggleVisible}
        >
          {row.visible ? (
            <Glyph icon={VISIBLE_GLYPH} size={15} />
          ) : (
            <Glyph icon={HIDDEN_GLYPH} size={15} />
          )}
        </RowControl>
      ) : null}
      {showLock ? (
        <RowControl
          label={row.locked ? uiCopy.actions.unlock : uiCopy.actions.lock}
          pressed={row.locked}
          onClick={onToggleLocked}
        >
          <LockStateIcon locked={row.locked} />
        </RowControl>
      ) : null}
    </>
  );
}

/**
 * One of the row's controls: a 26px square at the control set's box, whose
 * one word is both its accessible name and its tooltip, armed from the control
 * set's one owner of the pairing so the two cannot disagree.
 *
 * `pressed` is required because both controls left here are toggles: a control
 * with no state to carry is not one of these any more.
 */
function RowControl({
  label,
  pressed,
  onClick,
  children,
}: {
  readonly label: string;
  readonly pressed: boolean;
  readonly onClick: () => void;
  readonly children: React.ReactNode;
}): React.JSX.Element {
  const ref = useRef<HTMLButtonElement>(null);
  useControlTooltip(ref, label);
  return (
    <button
      ref={ref}
      type="button"
      aria-label={label}
      aria-pressed={pressed}
      onClick={(event) => {
        // The control sits inside the row, and the row's own click selects the
        // layer. Pressing a control is not pressing the row under it.
        event.stopPropagation();
        onClick();
      }}
    >
      {children}
    </button>
  );
}

/** Locked is a filled lock and unlocked an outline one: at this size the
 *  outlines differ only by a gap in the shackle, so the state rides the icon set's
 *  `filled` escape and the vocabulary's own weight — no second glyph, no second
 *  stroke weight. */
function LockStateIcon({
  locked,
}: {
  readonly locked: boolean;
}): React.JSX.Element {
  const state = LOCK_GLYPH[locked ? "locked" : "unlocked"];
  return <Glyph icon={state.icon} size={15} filled={state.filled ?? false} />;
}
