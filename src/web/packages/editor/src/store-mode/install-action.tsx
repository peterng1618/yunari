import type * as React from "react";
import {
  CHECK_GLYPH,
  EXPORT_ITEM_GLYPH,
  Glyph,
  INSTALL_ITEM_GLYPH,
} from "../editor-shell/icons.js";
import { uiCopy } from "../ui-copy.js";
import type { InstallControl } from "./install-item.js";
import type { InstallState } from "./install-state.js";
import type { StoreItem } from "./local-source.js";

/**
 * The online cell's action slot: one of the three readings, never the
 * library's four actions.
 *
 * **Installed is a mark, not a control** — there is nothing to do, and the
 * cell draws no button there. **Install and Update post the item to the
 * host**, and the control disables itself while that press is in flight so a
 * double press cannot install twice; the region re-lists on success, so the
 * word this draws comes from the listing rather than from a copy kept here.
 */
export function InstallAction(props: {
  readonly item: StoreItem;
  readonly state: Exclude<InstallState, "none">;
  readonly install: InstallControl;
  /** The card the control belongs to. Several member rows install the same
   *  listing, so the item id alone would draw duplicate DOM ids. */
  readonly controlKey?: string;
  /** What the press does instead of posting an install. A collection's press
   *  opens its sheet; posting here would install every include with no consent. */
  readonly onPress?: (() => void) | undefined;
}): React.JSX.Element {
  const { item, state, install } = props;
  const controlKey = props.controlKey ?? item.id;

  if (state === "installed") {
    return (
      <span
        data-yunari-store-cell-install={state}
        className="flex flex-none items-center gap-[var(--space-6)] text-xs text-muted"
      >
        {/* The word is muted like every other reading in the band; only the
            check carries the rationed accent. */}
        <span className="flex-none text-accent">
          <Glyph icon={CHECK_GLYPH} size={13} />
        </span>
        {uiCopy.store.cell.installStates.installed}
      </span>
    );
  }

  const busy = install.installingIds.has(item.id);
  return (
    <button
      type="button"
      id={`yunari-store-cell-${controlKey}-install`}
      data-yunari-store-cell-install={state}
      disabled={busy}
      aria-busy={busy}
      onClick={props.onPress ?? (() => install.onInstall(item))}
      className="inline-flex flex-none items-center gap-[var(--space-6)] rounded-md border border-edge bg-panel px-[var(--space-10)] py-[var(--space-4)] text-xs text-text disabled:text-faint"
    >
      <Glyph
        icon={state === "install" ? INSTALL_ITEM_GLYPH : EXPORT_ITEM_GLYPH}
        size={13}
      />
      {uiCopy.store.cell.installStates[state]}
    </button>
  );
}
