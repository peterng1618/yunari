import type {
  AssetPage,
  AssetSourceListing,
  ListingCategory,
  PresetKind,
} from "@yunari/renderer-core";
import type * as React from "react";
import { uiCopy } from "../ui-copy.js";
import { FinderChip, FinderSegmented } from "./finder-controls.js";
import type { KindFilter } from "./finder-model.js";
import type { FontFilterState } from "./fonts.js";
import { FontsFilter } from "./fonts.js";

/** The tab's own filter row: font kind and sort, the Wallpaper Engine kind, or
 *  the Colours presets. */
export function FinderFilters(props: {
  readonly active: ListingCategory;
  readonly local: boolean;
  readonly fontFilter: FontFilterState;
  readonly onFontFilterChange: (next: FontFilterState) => void;
  readonly localKind: "all" | "video" | "scene";
  readonly onLocalKindChange: (kind: "all" | "video" | "scene") => void;
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
    return (
      <FinderSegmented
        label={uiCopy.assets.wallpaperEngine.filterKind}
        value={props.localKind}
        options={(["all", "video", "scene"] as const).map((kind) => ({
          id: kind,
          label:
            kind === "all"
              ? uiCopy.assets.wallpaperEngine.filterAll
              : uiCopy.assets.wallpaperEngine.kind[kind],
          data: { "data-yunari-wallpaper-engine-kind-filter": kind },
        }))}
        onChange={props.onLocalKindChange}
      />
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
