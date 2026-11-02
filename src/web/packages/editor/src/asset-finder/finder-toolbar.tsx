import type {
  AssetPage,
  AssetSourceListing,
  ListingCategory,
  PresetKind,
} from "@yunari/renderer-core";
import type * as React from "react";
import { ASCENDING_GLYPH, DESCENDING_GLYPH } from "../editor-shell/icons.js";
import { uiCopy } from "../ui-copy.js";
import { FinderChip, FinderSegmented } from "./finder-controls.js";
import type { KindFilter } from "./finder-model.js";
import type { FontFilterState } from "./fonts.js";
import { FontsFilter } from "./fonts.js";
import type { WallpaperDirection, WallpaperSort } from "./use-wallpaper-tab.js";

/** The tab's own filter row: font kind and sort, the Wallpaper Engine kind, or
 *  the Colours presets. */
export function FinderFilters(props: {
  readonly active: ListingCategory;
  readonly local: boolean;
  readonly fontFilter: FontFilterState;
  readonly onFontFilterChange: (next: FontFilterState) => void;
  readonly localKind: "all" | "video" | "scene";
  readonly onLocalKindChange: (kind: "all" | "video" | "scene") => void;
  readonly localSort: WallpaperSort;
  readonly onLocalSortChange: (sort: WallpaperSort) => void;
  readonly localDirection: WallpaperDirection;
  readonly onLocalDirectionChange: (direction: WallpaperDirection) => void;
  readonly kinds: readonly PresetKind[];
  readonly presetFilter: KindFilter;
  readonly onPresetFilterChange: (kind: KindFilter) => void;
}): React.ReactNode {
  if (props.active === "font") {
    return (
      <FontsFilter
        filter={props.fontFilter}
        onChange={props.onFontFilterChange}
      />
    );
  }
  if (props.local) {
    const copy = uiCopy.assets.wallpaperEngine;
    return (
      <div className="flex flex-wrap items-center gap-[var(--space-8)]">
        <FinderSegmented
          label={copy.filterKind}
          value={props.localKind}
          options={(["all", "video", "scene"] as const).map((kind) => ({
            id: kind,
            label: kind === "all" ? copy.filterAll : copy.kind[kind],
            data: { "data-yunari-wallpaper-engine-kind-filter": kind },
          }))}
          onChange={props.onLocalKindChange}
        />
        <FinderSegmented
          label={copy.sortLabel}
          value={props.localSort}
          options={(["name", "updated", "size"] as const).map((sort) => ({
            id: sort,
            label: copy.sort[sort],
            // The pressed button carries the order; pressing it again is how
            // the other order is asked for, so there is no second row.
            ...(sort !== props.localSort
              ? {}
              : {
                  glyph:
                    props.localDirection === "asc"
                      ? ASCENDING_GLYPH
                      : DESCENDING_GLYPH,
                  ariaLabel: `${copy.sort[sort]}, ${copy.direction[props.localDirection]}`,
                }),
            data: { "data-yunari-wallpaper-engine-sort": sort },
          }))}
          onChange={props.onLocalSortChange}
          onPressedAgain={() => {
            props.onLocalDirectionChange(
              props.localDirection === "asc" ? "desc" : "asc",
            );
          }}
        />
      </div>
    );
  }
  if (props.active === "colour" && props.kinds.length > 1) {
    const kindOptions: readonly KindFilter[] = ["all", ...props.kinds];
    return (
      <FinderSegmented
        label={uiCopy.assets.kindFilterLabel}
        value={props.presetFilter}
        options={kindOptions.map((kind) => ({
          id: kind,
          label: uiCopy.assets.kindFilter[kind],
          data: { "data-yunari-asset-kind": kind },
        }))}
        onChange={props.onPresetFilterChange}
      />
    );
  }
  return undefined;
}

/** The chip per visible source. A lone source still draws its chip: the
 *  kind-off sentence says to turn one on above, and with the chip hidden there
 *  would be nothing above to turn on (`vg-710`). */
export function FinderSourceChips(props: {
  readonly sources: readonly AssetSourceListing[];
  readonly disabled: ReadonlySet<string>;
  readonly failures: ReadonlyMap<string, AssetPage>;
  readonly onToggle: (sourceId: string) => void;
}): React.ReactNode {
  if (props.sources.length === 0) return undefined;
  return (
    <>
      {props.sources.map((source) => {
        const off = props.disabled.has(source.id);
        return (
          <FinderChip
            key={source.id}
            label={source.label}
            pressed={!off}
            failed={props.failures.has(source.id)}
            disabled={!source.configurable}
            data={
              off
                ? {
                    "data-yunari-asset-chip": source.id,
                    "data-disabled": "",
                  }
                : { "data-yunari-asset-chip": source.id }
            }
            onToggle={() => props.onToggle(source.id)}
          />
        );
      })}
    </>
  );
}
