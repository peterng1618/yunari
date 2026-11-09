import { uiCopy } from "../ui-copy.js";
import { ControlTooltip } from "./controls/tooltip.js";
import { Glyph, RAIL_GLYPHS, SETTINGS_GLYPH } from "./icons.js";

/** The rail's six slots. Named here rather than in
 *  `shell-layout.tsx` because the rail is what enumerates them — two owners of
 *  "which slots there are" would drift. The settings gear is deliberately not
 *  one of them: it switches the shell to the Settings mode rather than
 *  choosing a pane, so it is outside this set. */
export type RailSlot =
  | "composition"
  | "add"
  | "widgets"
  | "assets"
  | "tokens"
  | "document";

/** The gear's own id: the shell may return focus to it when a surface it
 *  opened withdraws, and tests address the one gear by this handle rather than
 *  by position. */
export const SETTINGS_TRIGGER_ID = "editor-shell-settings-trigger";

/** The slots, in rail order. This is the one place that says how many there
 *  are; `shell-layout` and the tests read it rather than restating the set. */
export const RAIL_SLOTS: readonly RailSlot[] = [
  "composition",
  "add",
  "widgets",
  "assets",
  "tokens",
  "document",
];

/** One slot: a 36px icon-only control whose one word is both its tooltip and
 *  its accessible name, so the two cannot disagree.
 *
 *  The tooltip is the control set's one owner of the pairing
 *  (`ControlTooltip`), rendered around the button on the same `label` the
 *  `aria-label` takes, so the two cannot disagree. The rail renders its own
 *  button rather than `ControlIconButton`
 *  because a slot carries `aria-pressed` — which one is chosen — and the
 *  control set's icon button, a plain 26px action, has no such state.
 *
 *  **`aria-pressed` is the whole of a slot's own state, and there is no
 *  `aria-expanded` beside it.** Whether the pane column is out is a fact about
 *  the shell, not about a slot: put on every slot it read `true` on one whose
 *  pane was `hidden` behind another's, and put on each slot it would be a
 *  second attribute restating what `aria-pressed` already decides. The shell
 *  publishes that one fact once, on the rail.
 */
function RailSlotButton({
  slot,
  label,
  pressed,
  disabled,
  onChoose,
}: {
  readonly slot: RailSlot;
  readonly label: string;
  readonly pressed: boolean;
  readonly disabled: boolean;
  readonly onChoose: (slot: RailSlot) => void;
}): React.JSX.Element {
  return (
    <ControlTooltip label={label}>
      <button
        type="button"
        className="editor-shell-rail-slot"
        data-rail-slot={slot}
        aria-label={label}
        // Pressed says which slot is chosen and stays true while the pane is
        // closed, so the rail still shows what reopening restores.
        aria-pressed={pressed}
        disabled={disabled}
        onClick={() => onChoose(slot)}
      >
        <Glyph icon={RAIL_GLYPHS[slot]} size={17} />
      </button>
    </ControlTooltip>
  );
}

/** The settings gear, pinned to the rail's foot.
 *
 *  It draws its own button for the reason the slots do — the control set's icon
 *  button is a 26px action and this is the rail's 36px rhythm — and it carries
 *  no `aria-pressed`, because it chooses nothing: pressing it switches the
 *  shell to Settings and nothing else. The name and the tooltip are one string, the rail's slot rule.
 */
function SettingsGear({
  label,
  onClick,
}: {
  readonly label: string;
  readonly onClick: () => void;
}): React.JSX.Element {
  return (
    <ControlTooltip label={label}>
      <button
        id={SETTINGS_TRIGGER_ID}
        type="button"
        className="editor-shell-rail-settings"
        data-rail-settings=""
        aria-label={label}
        onClick={onClick}
      >
        <Glyph icon={SETTINGS_GLYPH} size={17} />
      </button>
    </ControlTooltip>
  );
}

/** The left edge's vertical glyph strip: one slot per pane, and the settings
 *  gear at the foot.
 *
 *  It draws no pane content — React positions one persistent host per pane and
 *  hides the ones that are not showing — and it decides nothing: asking for
 *  the slot already open is a collapse, and the shell is what turns the
 *  gesture into a close (its `choosePane`), because the rail cannot tell a
 *  swap from a close. The gear is not a slot and opens no pane; it is the one
 *  thing on the rail whose surface is the Settings mode. */
export function Rail(props: {
  readonly slot: RailSlot;
  readonly collapsed: boolean;
  readonly onChoose: (slot: RailSlot) => void;
  /** Opens Settings. Required rather than optional: the gear is on every rail,
   *  and a rail with a dead gear is the defect this exists to fix. */
  readonly onOpenSettings: () => void;
  readonly disabled?: boolean;
}): React.JSX.Element {
  return (
    <nav
      className="editor-shell-rail editor-glass"
      aria-label={uiCopy.rail.label}
      // The column's state, said once for the rail rather than four times for
      // the slots: which pane is shown is the slots' `aria-pressed`, and
      // whether any is out at all is the rail's own.
      data-collapsed={props.collapsed}
    >
      {RAIL_SLOTS.map((id) => (
        <RailSlotButton
          key={id}
          slot={id}
          label={uiCopy.rail.slots[id]}
          pressed={props.slot === id}
          disabled={props.disabled ?? false}
          onChoose={props.onChoose}
        />
      ))}
      <SettingsGear
        label={uiCopy.settings.title}
        onClick={props.onOpenSettings}
      />
    </nav>
  );
}
