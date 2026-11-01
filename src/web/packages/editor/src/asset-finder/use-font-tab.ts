import type { ListingCategory } from "@yunari/renderer-core";
import { useState } from "react";
import { uiCopy } from "../ui-copy.js";
import type { FinderAction } from "./finder-controls.js";
import type { TabView } from "./finder-model.js";
import type { FontResult } from "./font-preview-panel.js";
import {
  type FontActions,
  type FontFilterState,
  type FontPreviewState,
  fontActionsOf,
  fontDoneMessage,
} from "./fonts.js";
import type { FinderRow } from "./tab-data.js";
import { useFontFavorites } from "./use-font-favorites.js";

/** The Fonts tab's own filter, preview choices, host favourites and running
 *  write. Filtering and sorting narrow what is drawn; they never change what
 *  was asked. */
export function useFontTab(props: {
  readonly open: boolean;
  readonly active: ListingCategory | undefined;
  readonly selection: FinderRow | undefined;
  readonly font: FontActions | undefined;
  readonly patch: (
    category: ListingCategory,
    update: (current: TabView) => TabView,
  ) => void;
}) {
  const { open, active, selection, font, patch } = props;
  const [fontFilter, setFontFilter] = useState<FontFilterState>({
    kind: "all",
    sort: "name",
  });
  const [fontPreview, setFontPreview] = useState<FontPreviewState>({
    sample: uiCopy.assets.fontPreview.sampleDefault,
    cutId: undefined,
    role: "body",
  });
  /** The footer action whose write is out, so one spinner is not every one. */
  const [running, setRunning] = useState<string | undefined>(undefined);
  const { favorites, toggleFavorite } = useFontFavorites({
    open,
    active,
    font,
  });

  const footer: readonly FinderAction[] =
    active === "font" && selection !== undefined
      ? fontActionsOf(selection, fontFilter, fontPreview, font)
      : [];
  const selected: FontResult | undefined =
    active === "font" && selection?.result.font !== undefined
      ? (selection.result as FontResult)
      : undefined;
  /** The star belongs to a trio; a family has no favourite id. */
  const favoriteTrioId = selected?.font.trio?.id;
  const favorite =
    favoriteTrioId === undefined || font?.saveFavorites === undefined
      ? undefined
      : {
          on: (favorites ?? []).includes(favoriteTrioId),
          toggle: (): void => {
            toggleFavorite(favoriteTrioId);
          },
        };

  const run = (action: FinderAction): void => {
    if (active === undefined) return;
    setRunning(action.id);
    const rowId = selection?.result.id;
    const outcome = action.run();
    void Promise.resolve(outcome).then((result) => {
      setRunning(undefined);
      patch(active, (current) => ({
        ...current,
        message: {
          text: result.ok ? fontDoneMessage(action.id) : result.message,
          tone: result.ok ? "ok" : "failed",
          ...(result.ok || rowId === undefined ? {} : { failedId: rowId }),
        },
      }));
    });
  };
  const firstFor = (row: FinderRow): FinderAction | undefined =>
    fontActionsOf(row, fontFilter, fontPreview, font)[0];

  return {
    fontFilter,
    setFontFilter,
    fontPreview,
    setFontPreview,
    footer,
    selection: selected,
    favorite,
    running,
    run,
    firstFor,
  };
}
