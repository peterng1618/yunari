import type * as React from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { ControlIconButton } from "../components/ui/control-icon-button.js";
import { Glyph } from "../editor-shell/icons.js";
import { type ObjectActionId, objectAction } from "../object-actions.js";

/**
 * The block that leads the column, under the subject: what the selection itself
 * has to say before its properties say anything.
 *
 * One thing lives here, and it is here for the same reason — there is nowhere
 * else left to put it: **the arrange actions** (`vg-463`). The dock carried the
 * eight; a multi-selection gets them at the top of the column now. The registry
 * is still their one owner: the ids and labels cross as values from `index.ts`,
 * the glyph is asked of it by id, and the run is its own — so a surface cannot
 * advertise an action `applyArrange` would refuse.
 *
 * Values in, a callback out: `index.ts` projects the buttons from the live
 * selection and hands the run back, so React holds no Fabric object and
 * decides no eligibility of its own.
 */

/**
 * One arrange action as a value: the registry's id and label, and whether this
 * selection clears the action's own threshold — `Distribute` needs three where
 * an align needs two, so two selected objects draw it disabled rather than
 * absent, which is the treatment the dock gave them.
 *
 * The glyph is deliberately not here: a React component is not a value, so
 * {@link ArrangeRow} asks the registry for it by id and which family and weight
 * a chrome icon is drawn in stays decided in one place (§6).
 */
export interface ArrangeButtonView {
  readonly id: ObjectActionId;
  readonly label: string;
  readonly enabled: boolean;
}

export interface SelectionLeadView {
  readonly arrange: readonly ArrangeButtonView[];
}

export interface SelectionLeadProps extends SelectionLeadView {
  readonly run: (id: ObjectActionId) => void;
}

/**
 * The eight, in the registry's order. Each is a §5 icon button carrying its
 * action's own label, so the glyph and the accessible name cannot disagree.
 *
 * **No group name.** A labelled group here would repeat the dock's own
 * `canvasToolbar` label on a second surface and name two toolbars the same
 * thing; the buttons name themselves, and the row's place in the panel is what
 * groups them.
 */
function ArrangeRow({
  actions,
  run,
}: {
  readonly actions: readonly ArrangeButtonView[];
  readonly run: (id: ObjectActionId) => void;
}): React.JSX.Element | null {
  if (actions.length === 0) return null;

  return (
    <div
      className="flex flex-wrap items-center gap-[var(--space-6)]"
      data-yunari-arrange-row=""
    >
      {actions.map((action) => (
        <ControlIconButton
          key={action.id}
          label={action.label}
          disabled={!action.enabled}
          data={{ "data-yunari-arrange-action": "" }}
          onClick={() => run(action.id)}
        >
          <Glyph icon={objectAction(action.id).icon} size={15} />
        </ControlIconButton>
      ))}
    </div>
  );
}

/**
 * The block, or nothing at all: a single object has no arrange action to
 * offer, and an empty block would still be a boundary in the panel with nothing
 * between the rules.
 *
 * **It closes with its own edge**, because it stands between the subject's
 * hairline and the sections. The first section draws no rule of its own
 * (`vg-466`): with the subject's edge above it, that was the column's one
 * boundary. This block is a second one — what the selection can *do* is not a
 * field of it — so the rule that closes it is its own, and the boundary count
 * stays one per boundary whether the block renders or not. A rule inside the
 * subject's block instead, or a `first` the sections had to know about, would
 * have put this block's boundary in someone else's component.
 */
export function SelectionLead({
  arrange,
  run,
}: SelectionLeadProps): React.JSX.Element | null {
  if (arrange.length === 0) return null;

  return (
    <div
      className="flex flex-col gap-[var(--space-8)] border-b border-edge pt-[var(--space-12)] pb-[var(--space-8)]"
      data-yunari-selection-lead=""
    >
      <ArrangeRow actions={arrange} run={run} />
    </div>
  );
}

/**
 * The block's React root. A publish is flushed synchronously, the contract the
 * subject's and the column's roots keep: a caller that reads the panel straight
 * after a selection change sees it.
 */
export function createSelectionLeadRoot(host: HTMLElement): {
  readonly publish: (
    view: SelectionLeadView,
    run: (id: ObjectActionId) => void,
  ) => void;
  readonly destroy: () => void;
} {
  const root: Root = createRoot(host);

  return {
    publish(view, run) {
      flushSync(() => {
        root.render(<SelectionLead arrange={view.arrange} run={run} />);
      });
    },
    destroy() {
      root.unmount();
    },
  };
}
