import type { ListingCategory } from "@yunari/renderer-core";
import type { VideoTrimRange } from "@yunari/theme-package";
import { useEffect, useState } from "react";
import { uiCopy } from "../ui-copy.js";
import {
  fetchWallpaperEngine,
  type WallpaperEngineAnswer,
  type WallpaperEngineItem,
} from "../wallpaper-engine/client.js";
import type { ClientOptions } from "./client.js";
import type { FinderCardModel } from "./finder-card.js";
import type { FinderAction } from "./finder-controls.js";
import {
  EMPTY_LOCAL,
  type LocalView,
  type PreviewTarget,
} from "./finder-model.js";
import type { WallpaperActions } from "./wallpaper.js";
import { wallpaperActionsOf } from "./wallpaper.js";

/** The Wallpaper Engine tab's sort fields and the two orders. */
export type WallpaperSort = "name" | "updated" | "size";
export type WallpaperDirection = "asc" | "desc";

/** A field the host could not read sorts last in both orders rather than
 *  reading as the oldest or the smallest: absent is not zero. */
function compareWallpapers(
  left: WallpaperEngineItem,
  right: WallpaperEngineItem,
  sort: WallpaperSort,
  direction: WallpaperDirection,
): number {
  const factor = direction === "asc" ? 1 : -1;
  if (sort === "name") return left.title.localeCompare(right.title) * factor;
  const a = sort === "updated" ? left.updatedAt : left.filesize;
  const b = sort === "updated" ? right.updatedAt : right.filesize;
  if (a === undefined && b === undefined) return 0;
  if (a === undefined) return 1;
  if (b === undefined) return -1;
  return (a - b) * factor;
}

/** The Wallpaper Engine tab's lifecycle: the library fetched once on first
 *  activation, its own filter, sort, selection and completed writes, and the
 *  one write each card can run. */
export function useWallpaperTab(props: {
  readonly open: boolean;
  readonly active: ListingCategory | undefined;
  readonly client: ClientOptions | undefined;
  readonly wallpaper: WallpaperActions | undefined;
  readonly setPreviewing: (target: PreviewTarget | undefined) => void;
}) {
  const { open, active, client, wallpaper, setPreviewing } = props;
  const [library, setLibrary] = useState<WallpaperEngineAnswer | undefined>();
  const [local, setLocal] = useState<LocalView>(EMPTY_LOCAL);
  const [sort, setSort] = useState<WallpaperSort>("name");
  const [direction, setDirection] = useState<WallpaperDirection>("asc");
  const [localRunning, setLocalRunning] = useState<string | undefined>();
  /** The Wallpaper Engine video whose span the author is choosing. A video's
   *  "set background" opens the trim surface before the host normalizer runs. */
  const [trimming, setTrimming] = useState<WallpaperEngineItem | undefined>();

  // A closed finder is not a status surface: the sentence a write left belongs
  // to the session that ran it, so reopening starts without one.
  useEffect(() => {
    if (open) return;
    setLocal((current) =>
      current.message === undefined
        ? current
        : { ...current, message: undefined },
    );
  }, [open]);

  /** The library reads this PC once, on the tab's first activation. It is not
   *  a search: nothing is asked again as the author types, and the filter
   *  narrows what already landed. */
  useEffect(() => {
    if (!open || active !== "local" || library !== undefined) return undefined;
    let live = true;
    void fetchWallpaperEngine(client).then((next) => {
      if (live) setLibrary(next);
    });
    return () => {
      live = false;
    };
  }, [open, active, library, client]);

  const libraryItems = library?.available === true ? library.items : [];
  const unavailable =
    library !== undefined && library.available === false
      ? uiCopy.assets.wallpaperEngine.reason[library.reason]
      : undefined;
  const needle = local.query.trim().toLowerCase();
  const items = libraryItems
    .filter(
      (item) =>
        (local.kind === "all" || item.kind === local.kind) &&
        (needle === "" || item.title.toLowerCase().includes(needle)),
    )
    .sort((left, right) => compareWallpapers(left, right, sort, direction));
  const footer = wallpaperActionsOf(local.selection, wallpaper);
  const busyId =
    localRunning !== undefined && local.selection !== undefined
      ? local.selection.workshopId
      : undefined;

  const runActionNow = (
    action: FinderAction,
    item: WallpaperEngineItem | undefined,
    trim?: VideoTrimRange,
  ): void => {
    const chosen =
      trim === undefined
        ? action
        : (wallpaperActionsOf(item, wallpaper, trim).find(
            (entry) => entry.id === action.id,
          ) ?? action);
    setLocalRunning(action.id);
    void Promise.resolve(chosen.run()).then((result) => {
      setLocalRunning(undefined);
      setLocal((current) => ({
        ...current,
        done:
          result.ok && item !== undefined
            ? new Set([...current.done, item.workshopId])
            : current.done,
        message: {
          text: result.message ?? uiCopy.assets.done.local,
          tone: result.ok ? "ok" : "failed",
          ...(result.ok || item === undefined
            ? {}
            : { failedId: item.workshopId }),
        },
      }));
    });
  };
  /** A video's span is asked for first; every other write runs as it stands. */
  const runAction = (
    action: FinderAction,
    item: WallpaperEngineItem | undefined = local.selection,
  ): void => {
    if (action.id === "set-background" && item?.kind === "video") {
      setTrimming(item);
      return;
    }
    runActionNow(action, item);
  };
  const select = (card: FinderCardModel): void => {
    const item = items.find((entry) => entry.workshopId === card.id);
    if (item !== undefined)
      setLocal((current) => ({ ...current, selection: item }));
  };
  const preview = (card: FinderCardModel): void => {
    const item = items.find((entry) => entry.workshopId === card.id);
    if (item !== undefined) setPreviewing({ kind: "local", item });
  };
  const apply = (card: FinderCardModel): void => {
    const item = items.find((entry) => entry.workshopId === card.id);
    setLocal((current) => ({ ...current, selection: item }));
    const first = wallpaperActionsOf(item, wallpaper)[0];
    if (first !== undefined) runAction(first, item);
  };
  const setQuery = (value: string): void => {
    setLocal((current) => ({ ...current, query: value }));
  };
  const setKind = (kind: "all" | "video" | "scene"): void => {
    setLocal((current) => ({ ...current, kind }));
  };
  const refresh = (): void => {
    // The host re-checks the library fingerprint on every listing, so clearing
    // the answer is the refresh.
    setLibrary(undefined);
  };
  const showMessage = (message: string): void => {
    setLocal((current) => ({
      ...current,
      message: { text: message, tone: "ok" },
    }));
  };
  const actionsFor = (item: WallpaperEngineItem): readonly FinderAction[] =>
    wallpaperActionsOf(item, wallpaper);
  const confirmTrim = (trim: VideoTrimRange | undefined): void => {
    const item = trimming;
    setTrimming(undefined);
    if (item === undefined) return;
    const action = wallpaperActionsOf(item, wallpaper, trim).find(
      (entry) => entry.id === "set-background",
    );
    if (action !== undefined) runActionNow(action, item);
  };

  return {
    library,
    libraryItems,
    unavailable,
    items,
    local,
    localRunning,
    trimming,
    footer,
    busyId,
    runAction,
    select,
    preview,
    apply,
    setQuery,
    setKind,
    sort,
    direction,
    setSort,
    setDirection,
    refresh,
    showMessage,
    actionsFor,
    confirmTrim,
    cancelTrim: () => {
      setTrimming(undefined);
    },
  };
}
