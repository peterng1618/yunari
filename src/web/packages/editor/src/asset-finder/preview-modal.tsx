import type * as React from "react";
import { Dialog } from "../components/ui/dialog.js";
import { uiCopy } from "../ui-copy.js";
import { type FinderAction, FinderActionButton } from "./finder-controls.js";

/**
 * One media result, enlarged, without leaving the finder (R8). The stage holds
 * the picture the card could only crop; the panel repeats the facts and draws
 * the tab's own actions, so a press here runs exactly what the footer runs.
 *
 * A video result has no playable URL — no source serves one — so it shows its
 * poster and says so rather than drawing a dead player.
 */
export interface FinderPreview {
  readonly id: string;
  readonly name: string;
  readonly meta: string;
  readonly licence: string;
  readonly sourceUrl: string;
  readonly imageUrl: string | undefined;
  readonly posterOnly: boolean;
}

export function FinderPreviewModal(props: {
  readonly preview: FinderPreview | undefined;
  readonly actions: readonly FinderAction[];
  readonly busyActionId: string | undefined;
  readonly message:
    | { readonly text: string; readonly tone: "ok" | "failed" }
    | undefined;
  readonly onRun: (action: FinderAction) => void;
  readonly onClose: () => void;
}): React.JSX.Element {
  const { preview, actions, busyActionId, message, onRun, onClose } = props;
  const copy = uiCopy.assets.previewModal;

  return (
    <Dialog
      open={preview !== undefined}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      label={preview?.name ?? uiCopy.assets.title}
      closeLabel={uiCopy.assets.close}
      closeIcon
      className="editor-shell-dialog--asset-preview"
    >
      {preview === undefined ? null : (
        <div
          data-yunari-asset-preview-modal=""
          className="flex min-h-0 min-w-0 flex-1"
        >
          <div
            data-yunari-asset-preview-stage=""
            className="relative flex min-w-0 flex-1 flex-col items-center justify-center gap-[var(--space-12)] p-[var(--space-20)] [background:var(--asset-preview-stage)]"
          >
            {preview.imageUrl === undefined ? null : (
              <img
                data-yunari-asset-preview-image=""
                className="max-h-full max-w-full rounded-[var(--radius-md)] object-contain"
                src={preview.imageUrl}
                alt=""
              />
            )}
            {preview.posterOnly ? (
              <p className="m-0 text-xs text-muted">{copy.posterOnly}</p>
            ) : null}
          </div>

          <div
            data-yunari-asset-preview-panel=""
            className="flex w-[var(--asset-preview-panel-width)] flex-none flex-col border-l border-edge bg-panel"
          >
            <div className="flex flex-none flex-col gap-[var(--space-6)] border-b border-edge pt-[var(--space-14)] pr-[var(--asset-preview-header-gutter)] pb-[var(--space-12)] pl-[var(--space-16)]">
              <span className="break-words text-lg font-semibold text-text [overflow-wrap:anywhere]">
                {preview.name}
              </span>
              {preview.meta === "" ? null : (
                <span className="truncate text-xs text-faint">
                  {preview.meta}
                </span>
              )}
            </div>

            <div className="flex min-h-0 flex-1 flex-col gap-[var(--space-10)] overflow-auto px-[var(--space-16)] py-[var(--space-12)] text-xs">
              <div className="flex flex-col gap-[var(--space-4)]">
                <span className="text-2xs font-semibold tracking-[0.11em] text-faint uppercase">
                  {copy.licence}
                </span>
                <span className="break-all font-mono text-muted">
                  {preview.licence}
                </span>
              </div>
              {preview.sourceUrl === "" ? null : (
                <div className="flex flex-col gap-[var(--space-4)]">
                  <span className="text-2xs font-semibold tracking-[0.11em] text-faint uppercase">
                    {copy.source}
                  </span>
                  <a
                    className="break-all font-mono text-muted underline"
                    href={preview.sourceUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {preview.sourceUrl}
                  </a>
                </div>
              )}
              {message === undefined ? null : (
                <p
                  data-tone={message.tone}
                  className={`m-0 text-xs ${
                    message.tone === "failed"
                      ? "text-[var(--hot)]"
                      : "text-muted"
                  }`}
                >
                  {message.text}
                </p>
              )}
            </div>

            <div className="flex flex-none flex-wrap justify-end gap-[var(--space-6)] border-t border-edge px-[var(--space-16)] py-[var(--space-12)]">
              {actions.map((action) => (
                <FinderActionButton
                  key={action.id}
                  action={action}
                  busy={busyActionId === action.id}
                  onRun={() => onRun(action)}
                  data={{ "data-yunari-asset-preview-action": action.id }}
                />
              ))}
            </div>
          </div>
        </div>
      )}
    </Dialog>
  );
}
