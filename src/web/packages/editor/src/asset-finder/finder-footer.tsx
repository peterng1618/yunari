import type * as React from "react";
import { ControlIconButton } from "../components/ui/control-icon-button.js";
import { Glyph, PREVIEW_GLYPH } from "../editor-shell/icons.js";
import { uiCopy } from "../ui-copy.js";
import type { FinderAction } from "./finder-controls.js";
import { FinderActionButton } from "./finder-controls.js";

/** The frame's footer actions, for the active tab's own row. */
export function FinderFooterActions(props: {
  readonly grid: boolean;
  readonly previewable: boolean;
  readonly onOpenPreview: () => void;
  readonly local: boolean;
  readonly localActions: readonly FinderAction[];
  readonly localRunning: string | undefined;
  readonly onRunLocal: (action: FinderAction) => void;
  readonly font: boolean;
  readonly fontActions: readonly FinderAction[];
  readonly running: string | undefined;
  readonly onRunFont: (action: FinderAction) => void;
  readonly assetActions: readonly FinderAction[];
  readonly busy: boolean;
}): React.ReactNode {
  if (!props.grid) return undefined;
  return (
    <>
      {props.previewable ? (
        <ControlIconButton
          label={uiCopy.assets.previewOpen}
          data={{ "data-yunari-asset-preview-open": "" }}
          onClick={props.onOpenPreview}
        >
          <Glyph icon={PREVIEW_GLYPH} size={14} />
        </ControlIconButton>
      ) : null}
      {props.local
        ? props.localActions.map((action) => (
            <FinderActionButton
              key={action.id}
              action={action}
              busy={props.localRunning === action.id}
              onRun={() => props.onRunLocal(action)}
              data={{ "data-yunari-asset-action": "" }}
            />
          ))
        : props.font
          ? props.fontActions.map((action) => (
              <FinderActionButton
                key={action.id}
                action={action}
                busy={props.running === action.id}
                onRun={() => props.onRunFont(action)}
                data={
                  action.tone === "accent"
                    ? { "data-yunari-asset-action": "" }
                    : { "data-yunari-font-action": action.id }
                }
              />
            ))
          : props.assetActions.map((action) => (
              <FinderActionButton
                key={action.id}
                action={action}
                busy={props.busy}
                onRun={() => {
                  void action.run();
                }}
                data={
                  action.id === "place"
                    ? { "data-yunari-asset-place": "" }
                    : { "data-yunari-asset-action": "" }
                }
              />
            ))}
    </>
  );
}
