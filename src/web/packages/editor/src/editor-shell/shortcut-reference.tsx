import type * as React from "react";
import { Dialog } from "../components/ui/dialog.js";
import { useActiveShortcuts } from "../shortcut-manager/bindings.js";
import { shortcutReferenceGroups } from "../shortcut-manager/reference.js";
import { uiCopy } from "../ui-copy.js";

/**
 * The reference, as a surface rather than as content.
 *
 * Every row comes from `shortcut-manager/reference.ts` and every word from
 * `uiCopy`, so this file owns layout and nothing else — the same reason
 * `object-actions.ts` owns which actions exist and the dock only draws them.
 *
 * It is React rather than one of the editor's three native `<dialog>`s: the
 * Dialog comes from the editor's one primitive library — Base UI — and a fourth
 * hand-rolled modal is the outcome that argument exists to prevent.
 */
export function ShortcutReference({
  open,
  onOpenChange,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}): React.JSX.Element {
  // The sheet prints the *effective* chord, so it re-reads the live table on
  // every render and redraws when a rebind changes it — the same read the
  // settings tab and the tooltips make.
  useActiveShortcuts();
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      label={uiCopy.shortcuts.reference}
    >
      <h2 className="editor-shell-dialog-lead">{uiCopy.shortcuts.reference}</h2>
      {shortcutReferenceGroups().map((group) => (
        <section key={group.label}>
          <h3>{group.label}</h3>
          <dl>
            {group.rows.map((row) => (
              <div key={row.action} data-yunari-reference-row={row.action}>
                <dt>{row.label}</dt>
                <dd>
                  <kbd aria-label={row.spoken}>{row.chord}</kbd>
                </dd>
              </div>
            ))}
          </dl>
        </section>
      ))}
      <button type="button" onClick={() => onOpenChange(false)}>
        {uiCopy.shortcuts.close}
      </button>
    </Dialog>
  );
}
