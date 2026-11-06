import type { ListingCategory } from "@yunari/renderer-core";
import type * as React from "react";
import { uiCopy } from "../ui-copy.js";
import type {
  WallpaperEngineAnswer,
  WallpaperEngineItem,
} from "../wallpaper-engine/client.js";
import type { FinderCardModel } from "./finder-card.js";
import { FinderGrid } from "./finder-grid.js";
import { categoryLabel } from "./finder-model.js";
import { FinderState } from "./finder-state.js";
import { FinderSkeleton } from "./skeleton.js";
import { wallpaperCards } from "./wallpaper.js";

/** The frame's content: the missing-body sentence, the Wallpaper Engine
 *  listing, or the search grid with its notice and empty state. */
export function FinderBody(props: {
  readonly active: ListingCategory;
  readonly grid: boolean;
  readonly local: boolean;
  readonly localUnavailable: string | undefined;
  readonly library: WallpaperEngineAnswer | undefined;
  readonly libraryCount: number;
  readonly localItems: readonly WallpaperEngineItem[];
  readonly localSelection: WallpaperEngineItem | undefined;
  readonly localBusyId: string | undefined;
  readonly localFailedId: string | undefined;
  readonly localDone: ReadonlySet<string>;
  readonly onSelectLocal: (card: FinderCardModel) => void;
  readonly onPreviewLocal: (card: FinderCardModel) => void;
  readonly onApplyLocal: (card: FinderCardModel) => void;
  readonly notice: string | undefined;
  readonly empty: React.ReactNode;
  readonly shownCount: number;
  readonly loading: boolean;
  readonly query: string;
  readonly cards: readonly FinderCardModel[];
  readonly selectedId: string | undefined;
  readonly busyId: string | undefined;
  readonly failedId: string | undefined;
  readonly onSelect: (card: FinderCardModel) => void;
  readonly onPreview: (card: FinderCardModel) => void;
  readonly onApply: (card: FinderCardModel) => void;
  readonly onNeedMore: () => void;
  readonly canLoadMore: boolean;
  readonly appending: boolean;
}): React.JSX.Element {
  if (!props.grid) {
    return (
      <div
        className="min-h-0 flex-1 overflow-y-auto"
        data-yunari-asset-body={props.active}
      >
        <FinderState message={uiCopy.assets.noSource} />
      </div>
    );
  }
  if (props.local) {
    if (props.localUnavailable !== undefined) {
      return (
        <div
          data-yunari-wallpaper-engine-unavailable=""
          className="min-h-0 flex-1 overflow-y-auto"
        >
          <FinderState message={props.localUnavailable} />
        </div>
      );
    }
    if (props.library === undefined) {
      return (
        <div
          data-yunari-asset-loading=""
          className="min-h-0 flex-1 overflow-y-auto"
        >
          <FinderSkeleton />
        </div>
      );
    }
    if (props.libraryCount === 0) {
      return (
        <div
          data-yunari-wallpaper-engine-empty=""
          className="min-h-0 flex-1 overflow-y-auto"
        >
          <FinderState message={uiCopy.assets.wallpaperEngine.empty} />
        </div>
      );
    }
    if (props.localItems.length === 0) {
      return (
        <div
          data-yunari-wallpaper-engine-no-matches=""
          className="min-h-0 flex-1 overflow-y-auto"
        >
          <FinderState message={uiCopy.assets.wallpaperEngine.noMatches} />
        </div>
      );
    }
    return (
      <div data-yunari-asset-grid="" className="flex min-h-0 flex-1 flex-col">
        <FinderGrid
          label={uiCopy.assets.category.local}
          cards={wallpaperCards(props.localItems)}
          selectedId={
            props.localSelection === undefined
              ? undefined
              : `wallpaper-engine:${props.localSelection.workshopId}`
          }
          {...(props.localBusyId === undefined
            ? {}
            : { busyId: props.localBusyId })}
          {...(props.localFailedId === undefined
            ? {}
            : { failedId: props.localFailedId })}
          {...(props.localDone.size === 0 ? {} : { doneIds: props.localDone })}
          onSelect={props.onSelectLocal}
          onPreview={props.onPreviewLocal}
          onApply={props.onApplyLocal}
          onNeedMore={() => {}}
          canLoadMore={false}
          appending={false}
        />
      </div>
    );
  }
  return (
    <>
      {props.notice === undefined ? null : (
        <p className="text-xs text-muted" data-yunari-asset-host-notice="">
          {uiCopy.assets.remoteHostNotice(props.notice)}
        </p>
      )}
      {props.shownCount === 0 ? (
        props.empty
      ) : (
        <div
          data-yunari-asset-grid=""
          aria-busy={props.loading ? "true" : undefined}
          className="flex min-h-0 flex-1 flex-col"
        >
          <FinderGrid
            // A question or a tab is a new grid: the scroll starts at the
            // top and the roving focus at the first card.
            key={`${props.active}:${props.query}`}
            label={categoryLabel(props.active)}
            cards={props.cards}
            selectedId={props.selectedId}
            {...(props.busyId === undefined ? {} : { busyId: props.busyId })}
            {...(props.failedId === undefined
              ? {}
              : { failedId: props.failedId })}
            onSelect={props.onSelect}
            onPreview={props.onPreview}
            onApply={props.onApply}
            onNeedMore={props.onNeedMore}
            canLoadMore={props.canLoadMore}
            appending={props.appending}
          />
        </div>
      )}
    </>
  );
}
