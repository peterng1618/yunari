import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import type * as React from "react";
import { uiCopy } from "../ui-copy.js";
import type { InstallControl } from "./install-item.js";
import { PanelBody, PanelFoot, PanelHeader } from "./item-panel.js";
import type { CellAction, StoreItem } from "./local-source.js";
import type { SubmitControl } from "./use-submit.js";

/**
 * The item's own surface: the modal a cell opens.
 *
 * **It is a viewer first.** The box is 960 × 760 against the settings sheet's
 * 560, with no title bar: the stage takes every pixel the 270px facts panel does
 * not, and the theme is contained in it rather than the stage being sized to the
 * theme. The box therefore keeps one height as a person steps between items — the
 * one thing a viewer must not do — and a portrait artboard is still seen
 * uncropped.
 *
 * **The facts and the commands are a right panel, not a band.** A band under the
 * stage spends the theme's own height on four words; a 270px column spends width
 * the preview can spare. The panel stacks the pills tight, the provenance under
 * them, and holds the four commands at its foot.
 *
 * **One modal for every kind.** `kind` is the seam the storefront reads, so what
 * changes with the kind is which pills appear and which actions the foot offers —
 * the online half carries Install, Installed or Update in place of the library's
 * grid, and the library's foot carries Publish to theme store above it.
 */

/** The stage's own reading: the size the theme is drawn at, then the fit verb.
 *  A size this record cannot read draws **no caption**, not `0 × 0` — a
 *  measurement of nothing is not a reading. */
function stageReading(item: StoreItem): string | undefined {
  const { width, height } = item.facets;
  if (!(width > 0 && height > 0)) return undefined;
  return `${width} × ${height}${uiCopy.store.readingSeparator}${uiCopy.assets.preview.fit}`;
}

export function ItemModal(props: {
  readonly item: StoreItem;
  /** The style tags the vocabulary holds, built from the listing by the surface
   *  that owns it (`settledTags`) — this modal reads the set and never the
   *  listing, so it cannot become a second source of truth about the library. */
  readonly vocabulary: readonly string[];
  readonly onClose: () => void;
  /** The one callback the cell's four actions travel through. The modal draws
   *  the same four, so it reports them the same way rather than owning a second
   *  answer to "what does this action mean". */
  readonly onAction: (action: CellAction, id: string) => void;
  /** The online half's install press, owned by the region because the re-listing
   *  it causes is the listing's fact rather than any surface's. */
  readonly install: InstallControl;
  /** The library half's submission, owned by the region for the same reason:
   *  the sign-in outlives the press that started it. */
  readonly submit: SubmitControl;
  /** Opens another item's modal — the region's own open state, which is what
   *  moves the surface from a remix to the parent it credits. */
  readonly onOpenItem?: (id: string) => void;
  /** The parent the listing resolved for this item's credit, when it holds
   *  one. A resolved `StoreItem`, never an id. */
  readonly remixParent?: StoreItem;
  /** The display choice, drawn inline where this page opened it: the assignment
   *  then happens without the page being left, and the choice confirms beside
   *  itself (`assign-display.tsx`). Absent where no assignment was started. */
  readonly assign?: React.ReactNode;
  /** The author's own commands on the store row, drawn only for the state that
   *  allows each (`status-badge.tsx`). The region posts and re-reads the
   *  author's listing; this surface only reports the press. */
  readonly onUnpublish?: (id: string) => void;
  readonly onRepublish?: (id: string) => void;
}): React.JSX.Element {
  const { item, onClose, onAction, install, submit } = props;
  // The one command a state allows, only where the region wired it.
  const authorAction =
    item.status === "published" && props.onUnpublish !== undefined
      ? ("unpublish" as const)
      : item.status === "unpublished" && props.onRepublish !== undefined
        ? ("republish" as const)
        : undefined;
  const authorPress =
    authorAction === "unpublish"
      ? props.onUnpublish
      : authorAction === "republish"
        ? props.onRepublish
        : undefined;
  const reading = stageReading(item);
  // A 0 × 0 record has no ratio to draw: the same guard the caption reads is
  // repeated here, so the picture takes the stage's box rather than a `calc`
  // that is invalid at computed-value time and collapses it.
  const sized = item.facets.width > 0 && item.facets.height > 0;

  return (
    <DialogPrimitive.Root
      defaultOpen
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogPrimitive.Portal>
        {/* The shell's own scrim; the box below is this surface's, because a
            picture's modal is not the text sheet `.editor-shell-dialog`
            describes. */}
        <DialogPrimitive.Backdrop className="editor-shell-dialog-overlay" />
        <DialogPrimitive.Popup
          data-yunari-store-item=""
          aria-label={item.name}
          className="fixed top-1/2 left-1/2 z-[71] flex h-[var(--store-item-height)] max-h-[90vh] w-[960px] max-w-[90vw] -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-[var(--radius-lg)] border border-edge bg-panel text-sm text-text shadow-[var(--elev-3)]"
        >
          {/* The stage: **every pixel the panel does not take**, and the box's
              own height, so the modal does not move as a person steps between
              items. Its ground is the viewer's fixed dark rather than a second
              dark surface with its own reason. */}
          <span
            data-yunari-store-item-stage=""
            className="relative flex min-w-0 flex-1 items-center justify-center p-[var(--space-20)] [background:var(--store-item-stage)] [container-type:size]"
          >
            {/* The picture at the theme's own ratio, contained in the stage's
                content box: the two `min()`s pick the limiting side, so a wide
                theme is capped by width and a tall one by height without either
                being stretched. */}
            <span
              data-yunari-store-item-picture=""
              className={`overflow-hidden rounded-[var(--radius-md)]${
                sized ? "" : " size-full"
              }`}
              style={{
                ...(sized
                  ? {
                      width: `min(100cqw, calc(100cqh * ${item.facets.width} / ${item.facets.height}))`,
                      height: `min(100cqh, calc(100cqw * ${item.facets.height} / ${item.facets.width}))`,
                    }
                  : {}),
                ...(item.ground === undefined
                  ? {}
                  : { background: item.ground }),
              }}
            >
              {item.thumbnailUrl === undefined ? null : (
                <img
                  src={item.thumbnailUrl}
                  alt=""
                  className="size-full object-contain"
                />
              )}
            </span>
            {reading === undefined ? null : (
              <span
                data-yunari-store-item-caption=""
                className="absolute bottom-[var(--space-12)] left-[var(--space-16)] rounded-[var(--radius-sm)] bg-panel/90 px-[var(--space-8)] py-[var(--space-4)] font-mono text-2xs text-muted"
              >
                {reading}
              </span>
            )}
          </span>

          <span
            data-yunari-store-item-panel=""
            className="flex w-[var(--store-item-panel-width)] flex-none flex-col border-l border-edge bg-panel"
          >
            <PanelHeader item={item} onClose={onClose} />
            <PanelBody
              item={item}
              vocabulary={props.vocabulary}
              remixParent={props.remixParent}
              onOpenItem={props.onOpenItem}
            />
            <PanelFoot
              item={item}
              install={install}
              submit={submit}
              onAction={onAction}
              authorAction={authorAction}
              authorPress={authorPress}
              {...(props.assign === undefined ? {} : { assign: props.assign })}
            />
          </span>
        </DialogPrimitive.Popup>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
