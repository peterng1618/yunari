import type * as React from "react";
import { ControlIconButton } from "../components/ui/control-icon-button.js";
import {
  ACTION_FAILED_GLYPH,
  CONVERT_SCENE_GLYPH,
  CONVERTED_GLYPH,
  Glyph,
  type LucideIcon,
  SET_BACKGROUND_GLYPH,
  SETTING_GLYPH,
} from "../editor-shell/icons.js";
import { uiCopy } from "../ui-copy.js";
import type { WallpaperEngineItem } from "../wallpaper-engine/client.js";

/** Which of the four states the card's one action is in. The success state
 *  persists for the modal session; a failure waits for the author to try again. */
export type WallpaperEngineCardState = "idle" | "running" | "done" | "failed";

function actionOf(
  item: WallpaperEngineItem,
  state: WallpaperEngineCardState,
  message: string | undefined,
): {
  readonly icon: LucideIcon;
  readonly label: string;
  readonly disabled: boolean;
  readonly ariaDisabled?: boolean;
} {
  const copy = uiCopy.assets.wallpaperEngine.action[item.kind];
  switch (state) {
    case "running":
      return { icon: SETTING_GLYPH, label: copy.running, disabled: true };
    case "done":
      // Final for the modal session: a second press would declare a duplicate
      // asset and spend another credit slot. `aria-disabled` rather than native
      // `disabled`, so the tooltip naming the state is reachable; the guarded
      // press in `ControlIconButton` is what refuses the second run.
      return {
        icon: CONVERTED_GLYPH,
        label: copy.done,
        disabled: false,
        ariaDisabled: true,
      };
    case "failed":
      return {
        icon: ACTION_FAILED_GLYPH,
        label: message ?? copy.idle,
        disabled: false,
      };
    default:
      return {
        icon:
          item.kind === "video" ? SET_BACKGROUND_GLYPH : CONVERT_SCENE_GLYPH,
        label: copy.idle,
        disabled: false,
      };
  }
}

/** One Wallpaper Engine card: the same card shape the finder's other grids draw,
 *  with the item's single action as an icon button (§6's icon-only rule — a card
 *  has no room for a sentence beside every tile). */
export function WallpaperEngineCard(props: {
  readonly item: WallpaperEngineItem;
  readonly state: WallpaperEngineCardState;
  readonly message?: string;
  readonly onAction: () => void;
}): React.JSX.Element {
  const { item, state, message, onAction } = props;
  const action = actionOf(item, state, message);
  const copy = uiCopy.assets.wallpaperEngine;
  const source = item.attribution?.workshopUrl;

  return (
    <div
      data-yunari-wallpaper-engine-card={item.workshopId}
      className="flex min-w-0 flex-col gap-[var(--space-4)] rounded-[var(--radius-md)] border border-edge bg-[var(--panel-2)] p-[var(--space-8)]"
    >
      <span
        aria-hidden="true"
        className="flex h-24 w-full items-center justify-center overflow-hidden rounded-[var(--radius-sm)] bg-[var(--bg)]"
      >
        {item.previewUrl === undefined ? null : (
          <img
            src={item.previewUrl}
            alt=""
            loading="lazy"
            className="size-full object-cover"
          />
        )}
      </span>
      <span className="flex w-full min-w-0 items-center gap-[var(--space-6)]">
        <span className="truncate text-xs font-medium">{item.title}</span>
        <span className="ml-auto flex-none">
          <ControlIconButton
            label={action.label}
            disabled={action.disabled}
            {...(action.ariaDisabled === true ? { ariaDisabled: true } : {})}
            data={{ "data-yunari-wallpaper-engine-action": "" }}
            onClick={onAction}
          >
            <Glyph icon={action.icon} size={14} />
          </ControlIconButton>
        </span>
      </span>
      <span className="max-w-full truncate text-[10px] text-faint">
        {copy.kind[item.kind]} · {copy.size(item.filesize)}
      </span>
      {source === undefined ? null : (
        <span className="max-w-full truncate text-[10px] text-faint">
          {source}
        </span>
      )}
    </div>
  );
}
