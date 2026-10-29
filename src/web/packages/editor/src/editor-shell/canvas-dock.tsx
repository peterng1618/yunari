import { useEffect, useRef, useState } from "react";
import { useControlTooltip } from "../components/ui/control-icon-button.js";
import {
  destructiveMarker,
  type ObjectActionId,
  objectActionsFor,
} from "../object-actions.js";
import { useActiveShortcuts } from "../shortcut-manager/bindings.js";
import {
  shortcutLabel,
  shortcutSpokenLabel,
} from "../shortcut-manager/display.js";
import { uiCopy } from "../ui-copy.js";
import type { EditorShellBridge } from "./bridge.js";
import { Glyph } from "./icons.js";

/**
 * One dock button. The tooltip is a DOM control, so React owns the button and
 * the control set's `useControlTooltip` owns the popup — a React tooltip here
 * would be a second owner for something the selection inspector, which never
 * sees React, also has to use.
 */
function Action({
  bridge,
  id,
  label,
  shortcut,
  mark,
  children,
}: {
  readonly bridge: EditorShellBridge | undefined;
  readonly id: ObjectActionId;
  readonly label: string;
  readonly shortcut:
    | { readonly printed: string; readonly spoken: string }
    | undefined;
  /** The destructive mark the registry hands the surface; empty for an action
   *  that does not destroy. */
  readonly mark: Readonly<Record<`data-${string}`, string>>;
  readonly children: React.ReactNode;
}): React.JSX.Element {
  const ref = useRef<HTMLButtonElement>(null);
  // The chord is part of the popup, so a rebind has to rebuild it — the control
  // set's one tooltip owner re-runs on the chord rather than only on the label.
  useControlTooltip(ref, label, shortcut);
  return (
    <button
      ref={ref}
      type="button"
      aria-label={label}
      // A `data-*` hook is the mark, not an ARIA state: nothing about a
      // destructive action is a toggle or a pressed state to announce. The
      // registry decides which actions carry it, not the dock.
      {...mark}
      onClick={() => bridge?.run(id)}
    >
      {children}
    </button>
  );
}

/**
 * The one contextual toolbar on the canvas: the object actions this selection
 * can run, and nothing it cannot.
 *
 * **The eight arrange actions are not here.** They are the selection
 * inspector's now (`vg-463`) — the author's own ruling, and the reversal of
 * `vg-016`'s: the Arrange *menu* went because this toolbar already had all
 * eight, and a toolbar that no longer carries them would make that sentence
 * false. One surface owns them, and it is the column that names the selection
 * they act on: `selection-inspector/selection-lead.tsx`.
 *
 * What is left renders from the registry and asks it the same way, so the
 * surface never re-decides eligibility: an action this selection cannot run is
 * filtered out rather than drawn refused.
 */
export function CanvasDock({
  bridge,
}: {
  readonly bridge: EditorShellBridge | undefined;
}): React.JSX.Element {
  // Every read below goes through the bridge, which projects the live selection
  // on demand — so the notification only has to force a render, and the set it
  // draws follows the selection without holding a copy of it. There is no greyed
  // half here: `vg-463` moved the arrange actions to the inspector, which greys
  // them, and this surface filters.
  const [, setRevision] = useState(0);
  // And the chords the tooltips print follow the live binding table, for the
  // same reason: `tooltip()` is rebuilt from the chord on every change, so a
  // rebind has to re-render this surface rather than only reach the dispatcher.
  useActiveShortcuts();
  useEffect(
    () => bridge?.subscribe(() => setRevision((revision) => revision + 1)),
    [bridge],
  );

  return (
    <nav
      className="editor-shell-dock editor-glass"
      role="toolbar"
      aria-label={uiCopy.canvasToolbar.label}
      data-yunari-canvas-toolbar=""
      // The surface derives its own visibility: it is present as soon as a
      // document is, and the object half appears on it as the selection becomes
      // eligible — the absent half is an empty row, not an absent surface.
      data-visible={bridge !== undefined}
    >
      {bridge === undefined
        ? null
        : objectActionsFor(bridge).map((action) => (
            <Action
              key={action.id}
              bridge={bridge}
              id={action.id}
              label={action.label}
              mark={destructiveMarker(action)}
              shortcut={
                action.shortcut === undefined
                  ? undefined
                  : {
                      printed: shortcutLabel(action.shortcut),
                      spoken: shortcutSpokenLabel(action.shortcut),
                    }
              }
            >
              <Glyph icon={action.icon} size={15} />
            </Action>
          ))}
    </nav>
  );
}
