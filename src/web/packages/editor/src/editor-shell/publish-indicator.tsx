import { useSyncExternalStore } from "react";
import { uiCopy } from "../ui-copy.js";
import type { HostingStore } from "./hosting-store.js";
import { CHECK_GLYPH, Glyph } from "./icons.js";

/**
 * The status bar's one mark of its own: the host is serving this editor on the
 * LAN.
 *
 * The answer is `HostingStore`'s — the same one the header's publish control
 * reads — and the mark is drawn **only** when the host reports the LAN on. An
 * unknown or absent host renders nothing rather than "not live": until the host
 * has answered the editor has nothing to say, and a mark invented for it would
 * be a fact the product does not have. Nothing here polls the host;
 * a state changed outside the editor is stale until reload (`vg-214`).
 */
export function PublishIndicator({
  store,
}: {
  readonly store: HostingStore;
}): React.JSX.Element | null {
  const state = useSyncExternalStore(store.subscribe, store.get, store.get);
  if (state.kind !== "known" || !state.answer.lan) return null;

  // No live-region role: the mark mounts with its content, and a live region has
  // to be present before its text changes for a screen reader to speak it — one
  // inserted already carrying its text is not announced. The footer's
  // always-mounted regions are the ones that speak.
  return (
    <p className="editor-shell-live">
      {/* the icon set names the live check as a **filled** glyph at 12px: a 1.8px stroke
          on a 12px check reads faint, and the answer DESIGN.md gives is the
          fill rather than a second stroke weight. */}
      <Glyph icon={CHECK_GLYPH} size={12} filled />
      {uiCopy.statusBar.live}
    </p>
  );
}
