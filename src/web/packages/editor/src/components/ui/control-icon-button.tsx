import type * as React from "react";
import { useEffect, useRef } from "react";
import { tooltip } from "../../editor-shell/controls/tooltip.js";
import {
  type ControlProps,
  describedBy,
  isBlocked,
  useControlIds,
} from "./control-well.js";

/**
 * One string, two consumers: a control hands this its `label` and gets the
 * tooltip that is that label, so nothing here can drift from the `aria-label`
 * the control also sets ("a glyph button whose tooltip and accessible
 * name can disagree is a defect").
 *
 * It is `ControlIconButton`'s own pairing, extracted so the icon-only controls
 * that draw their own button — the dock's actions, the rail's slots, a layer
 * row's controls, the font picker's star — take the same one rather than each
 * arming `tooltip()` beside a second copy of the label. `tooltip()` itself
 * stays the one owner of what a tooltip *is*.
 */
export function useControlTooltip(
  ref: React.RefObject<HTMLElement | null>,
  label: string,
  shortcut?: { readonly printed: string; readonly spoken: string },
): void {
  // The dependencies are the primitive strings, not the `shortcut` object: a
  // caller building it inline hands a fresh object every render, which would
  // tear down and rebuild the tooltip on each one.
  const printed = shortcut?.printed;
  const spoken = shortcut?.spoken;

  useEffect(() => {
    const trigger = ref.current;
    if (trigger === null) return;
    // Two calls rather than one with a conditional field: with
    // `exactOptionalPropertyTypes` on, a caller with no chord must omit it.
    return (
      printed === undefined || spoken === undefined
        ? tooltip({ trigger, text: label })
        : tooltip({ trigger, text: label, shortcut: { printed, spoken } })
    ).destroy;
  }, [ref, label, printed, spoken]);
}

/**
 * An action whose glyph is unambiguous: a 26px square at `--radius-md`, the
 * glyph and nothing else.
 *
 * The name and the tooltip are one string here: the button declares one
 * `label`, sets it as the `aria-label` and mounts {@link useControlTooltip} on
 * it, so neither can be changed without the other.
 *
 * `--hot` marks the destructive ones and only those; a destructive control
 * whose action is refused goes `--faint` rather than dimming red.
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
    describedById,
    data,
    destructive,
    shortcut,
    onClick,
    children,
  } = props;
  const ids = useControlIds(id);
  const blocked = isBlocked({ disabled, refused }) || ariaDisabled === true;
  const ref = useRef<HTMLButtonElement>(null);
  useControlTooltip(ref, label, shortcut);

  const tone = blocked
    ? "text-faint"
    : destructive === true
      ? "text-hot"
      : "text-muted";

  return (
    <span className="inline-flex items-center gap-[var(--space-6)]">
      <button
        {...data}
        ref={ref}
        id={ids.control}
        type="button"
        aria-label={label}
        aria-disabled={
          ariaDisabled === true || refused !== undefined ? true : undefined
        }
        // The pane's own note first, then the row's refusal, in `describedBy`'s
        // reading order. `describedById` is the one route a note the control
        // cannot mint reaches a screen reader by, and this button is the one
        // control that *draws* its reason — so accepting the prop and dropping
        // it lost a standing note silently (`vg-483`).
        aria-describedby={describedBy(
          describedById,
          refused === undefined ? undefined : ids.reason,
        )}
        disabled={disabled}
        onClick={() => {
          if (blocked) return;
          onClick();
        }}
        className={`inline-flex size-[26px] flex-none items-center justify-center rounded-md border border-transparent bg-transparent ${tone} enabled:hover:border-edge enabled:hover:text-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent`}
      >
        {children}
      </button>
      {refused === undefined ? null : (
        <span id={ids.reason} className="text-xs text-muted">
          {refused}
        </span>
      )}
    </span>
  );
}
