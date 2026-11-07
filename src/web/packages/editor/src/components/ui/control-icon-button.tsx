import type * as React from "react";
import { ControlTooltip } from "../../editor-shell/controls/tooltip.js";
import { destructiveMarker } from "../../object-actions.js";
import {
  type ControlProps,
  describedBy,
  isBlocked,
  useControlIds,
} from "./control-well.js";

/**
 * One string, two consumers: a control hands this its `label` and the tooltip
 * that is that label comes from the same prop, so nothing here can drift from
 * the `aria-label` the control also sets ("a glyph button whose tooltip and
 * accessible name can disagree is a defect").
 *
 * `ControlTooltip` is the one owner of what a tooltip is; this pairing is
 * `ControlIconButton`'s, and the icon-only controls that draw their own button
 * — the dock's actions, the rail's slots, a layer row's controls, the font
 * picker's star — render the same component rather than each arming a second
 * copy.
 */

/**
 * An action whose glyph is unambiguous: a 26px square at `--radius-md`, the
 * glyph and nothing else.
 *
 * The name and the tooltip are one string here: the button declares one
 * `label`, sets it as the `aria-label` and gives it to the tooltip wrapped
 * around it, so neither can be changed without the other.
 *
 * `--hot` marks the destructive ones and only those, through the registry's
 * `destructiveMarker`. The mark is not a class: a control whose action is
 * refused goes `--faint` because the marker's rule excludes disabled and
 * aria-disabled buttons.
 */
export function ControlIconButton(
  // No `hint`: this control's tooltip is its label, so there is nowhere a hint
  // could be rendered that would not be a second tooltip owner. Omitting the
  // prop is the contract half of the choice — a caller cannot hand it one and
  // then wonder why it vanished.
  props: Omit<ControlProps, "hint"> & {
    readonly destructive?: boolean;
    readonly shortcut?: { readonly printed: string; readonly spoken: string };
    /** A press that does nothing, without native `disabled`: the control keeps
     *  its focus and its tooltip, so the state it names stays reachable. */
    readonly ariaDisabled?: boolean;
    /** Whether this button is a toggle, and is on. Omitted for an action, which
     *  has no state for assistive technology to announce. */
    readonly pressed?: boolean;
    readonly onClick: () => void;
    readonly children: React.ReactNode;
  },
): React.JSX.Element {
  const {
    label,
    id,
    disabled,
    refused,
    ariaDisabled,
    pressed,
    describedById,
    data,
    destructive,
    shortcut,
    onClick,
    children,
  } = props;
  const ids = useControlIds(id);
  const blocked = isBlocked({ disabled, refused }) || ariaDisabled === true;

  const tone = blocked ? "text-faint" : "text-muted";

  return (
    <span className="inline-flex items-center gap-[var(--space-6)]">
      <ControlTooltip label={label} shortcut={shortcut}>
        <button
          {...data}
          {...(destructive === true
            ? destructiveMarker({ destructive: true })
            : {})}
          id={ids.control}
          type="button"
          aria-label={label}
          aria-pressed={pressed}
          aria-disabled={
            ariaDisabled === true || refused !== undefined ? true : undefined
          }
          // The pane's own note first, then the row's refusal, in
          // `describedBy`'s reading order. `describedById` is the one route a
          // note the control cannot mint reaches a screen reader by, and this
          // button is the one control that *draws* its reason — so accepting
          // the prop and dropping it lost a standing note silently.
          aria-describedby={describedBy(
            describedById,
            refused === undefined ? undefined : ids.reason,
          )}
          disabled={disabled}
          onClick={() => {
            if (blocked) return;
            onClick();
          }}
          className={`inline-flex size-[26px] flex-none items-center justify-center rounded-md border border-transparent bg-transparent ${tone} enabled:hover:border-muted enabled:hover:text-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent`}
        >
          {children}
        </button>
      </ControlTooltip>
      {refused === undefined ? null : (
        <span id={ids.reason} className="text-xs text-muted">
          {refused}
        </span>
      )}
    </span>
  );
}
