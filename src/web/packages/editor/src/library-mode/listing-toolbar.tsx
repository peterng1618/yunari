import type * as React from "react";
import { useState } from "react";
import { ControlSelect } from "../components/ui/control-select.js";
import {
  createGridDensityPreference,
  DEFAULT_GRID_DENSITY,
  type GridDensityLevel,
} from "../editor-shell/grid-density.js";
import type { FacetSelection } from "../store-mode/local-source.js";
import { uiCopy } from "../ui-copy.js";
import { DensitySlider } from "./density-slider.js";
import type { Facet } from "./facet-row.js";
import { FacetRow } from "./facet-row.js";
import { SORT_KEYS } from "./sort-orders.js";

/** The browser's own storage, or nothing where the accessor itself refuses — a
 *  private window throws on the read. */
function browserStorage(): Storage | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

/**
 * The chosen card density, read once and written back through the same
 * preference. It is a view choice, so it lives in the browser's storage and
 * never in a theme document.
 */
export function useGridDensity(): {
  readonly level: GridDensityLevel;
  set(level: GridDensityLevel): void;
} {
  const [preference] = useState(() =>
    createGridDensityPreference(browserStorage()),
  );
  const [level, setLevel] = useState<GridDensityLevel>(
    () => preference.read() ?? DEFAULT_GRID_DENSITY,
  );
  return {
    level,
    set: (next) => {
      setLevel(next);
      preference.write(next);
    },
  };
}

const SORT_ID = "yunari-library-sort";

/**
 * The listing's one toolbar: the facets the rows offer, the sort well, and the
 * density slider.
 *
 * **It draws values it is given and derives none.** The facets come from the
 * rows and the choices are the page's, so a second copy of the selection cannot
 * drift from the list it filters.
 */
export function ListingToolbar(props: {
  readonly facets: readonly Facet[];
  readonly chosen: FacetSelection;
  readonly onToggle: (facetId: string, optionId: string) => void;
  readonly sort: string;
  readonly onSort: (id: string) => void;
  readonly densityLevel: GridDensityLevel;
  readonly onDensity: (level: GridDensityLevel) => void;
}): React.JSX.Element {
  return (
    <div
      data-yunari-library-toolbar=""
      className="flex flex-none flex-wrap items-center gap-[var(--space-12)] px-[var(--space-16)] pt-[var(--space-12)] pb-[var(--space-8)]"
    >
      <FacetRow
        facets={props.facets}
        chosen={props.chosen}
        onToggle={props.onToggle}
      />
      <ControlSelect
        id={SORT_ID}
        label={uiCopy.store.sort.label}
        data={{ "data-yunari-library-sort": "" }}
        value={props.sort}
        options={SORT_KEYS}
        onChange={(id) => {
          if (!SORT_KEYS.some((key) => key.id === id)) return;
          props.onSort(id);
        }}
      />
      <DensitySlider level={props.densityLevel} onChange={props.onDensity} />
    </div>
  );
}
