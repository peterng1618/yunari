import { useSyncExternalStore } from "react";
import { ControlIconButton } from "../components/ui/control-icon-button.js";
import { uiCopy } from "../ui-copy.js";
import { Glyph, PAUSE_GLYPH, PLAY_GLYPH } from "./icons.js";
import type { SelectionStore } from "./shell-stores.js";

/**
 * The view cluster's leading group: whether the authored backdrop is moving.
 *
 * It appears only when the document's background is a video. A moving backdrop
 * is useful while laying a composition out and distracting while reading it,
 * so the author can stop it without leaving the editor or editing the theme;
 * playback is transient and starts again on the next open. An image, a
 * gradient or no media has nothing to pause, and drawing a disabled control
 * there would claim a capability the document does not have.
 *
 * It is a group *inside* the zoom cluster rather than a second floating
 * toolbar: one view bar answers how the stage is shown, and this is one of
 * those answers. The cluster already carries the surface, so the group adds
 * only the hairline that separates it from the camera controls.
 */
export function BackgroundPlayback({
  store,
}: {
  readonly store: SelectionStore;
}): React.JSX.Element | null {
  // The shell notifies this store for every projection, including the
  // playback change the bridge subscribes to, so both facts are read after the
  // render the change requested.
  useSyncExternalStore(store.subscribe, store.get, store.get);
  const bridge = store.bridge;
  if (bridge === undefined || !bridge.backgroundVideo()) return null;
  const playing = bridge.backgroundPlaying();
  return (
    <div
      className="editor-shell-playback"
      role="group"
      aria-label={uiCopy.backgroundPlayback.label}
      data-yunari-background-playback=""
    >
      <ControlIconButton
        label={
          playing
            ? uiCopy.backgroundPlayback.pause
            : uiCopy.backgroundPlayback.play
        }
        onClick={() => bridge.setBackgroundPlaying(!playing)}
      >
        <Glyph icon={playing ? PAUSE_GLYPH : PLAY_GLYPH} size={15} />
      </ControlIconButton>
    </div>
  );
}
