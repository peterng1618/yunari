/**
 * The state every button shares, in the one spelling DESIGN.md names.
 *
 * Hover, focus and selected are states a control owns by existing: `:hover`,
 * `:focus-visible`, `aria-pressed`/`aria-checked`. The three below are the ones a
 * caller sets, because only the caller knows an action is out or how it ended.
 *
 * `busy` is announced with `aria-busy`; the caller also disables the control,
 * because a busy control that can be pressed again is the defect. `success` and
 * `failure` are outcomes the caller keeps until the next attempt.
 *
 * One attribute, so the stylesheet paints every surface's outcome from one rule
 * (`editor-shell.css`, the `data-yunari-control-state` block). The host's own
 * pages cannot import this module and spell the same documented attribute.
 */
export type ControlState = "busy" | "success" | "failure";

export const CONTROL_STATE_ATTRIBUTE = "data-yunari-control-state";

/** The attributes a control carries for one state, or none. */
export type ControlStateAttributes = {
  readonly "data-yunari-control-state"?: ControlState;
  readonly "aria-busy"?: "true";
};

export function controlStateAttributes(
  state: ControlState | undefined,
): ControlStateAttributes {
  if (state === undefined) return {};
  return state === "busy"
    ? { "data-yunari-control-state": state, "aria-busy": "true" }
    : { "data-yunari-control-state": state };
}
