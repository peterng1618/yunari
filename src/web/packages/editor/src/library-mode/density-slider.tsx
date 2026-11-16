import type * as React from "react";
import {
  GRID_DENSITY_LEVELS,
  type GridDensityLevel,
} from "../editor-shell/grid-density.js";
import { uiCopy } from "../ui-copy.js";

/**
 * The store header's density slider.
 *
 * **It chooses a level, not a count.** The level names how the gallery feels
 * (compact through spacious); the column count is the pane's own answer for
 * that level and moves with the window. A numeric well would have frozen the
 * count at the moment it was chosen, which is the defect this replaced.
 *
 * A range input rather than a select: four ordered steps with no popup, and the
 * thumb is the state. The visible word beside the track is the reading; the
 * track speaks the same word through `aria-valuetext`, which is also how the
 * input is named. **A div rather than a label**: the copy walk reads a
 * `<label>`'s whole text as one word, so wrapping the track would join the
 * concept and its reading into a string no table entry owns.
 */
export function DensitySlider(props: {
  readonly level: GridDensityLevel;
  readonly onChange: (level: GridDensityLevel) => void;
}): React.JSX.Element {
  const index = GRID_DENSITY_LEVELS.indexOf(props.level);
  const label = uiCopy.store.density.levels[props.level];

  return (
    <div
      data-yunari-store-density=""
      className="ml-auto flex flex-none items-center gap-[var(--space-8)] text-xs text-muted"
    >
      <span className="flex-none">{uiCopy.store.density.label}</span>
      <input
        type="range"
        min={1}
        max={GRID_DENSITY_LEVELS.length}
        step={1}
        value={index + 1}
        aria-label={uiCopy.store.density.label}
        aria-valuetext={label}
        data-yunari-store-density-track=""
        onChange={(event) => {
          const next = GRID_DENSITY_LEVELS[Number(event.target.value) - 1];
          if (next !== undefined) props.onChange(next);
        }}
        className="h-1 w-[var(--store-density-track-width)] flex-none cursor-pointer appearance-none rounded-full bg-edge accent-accent"
      />
      <span
        aria-hidden
        data-yunari-store-density-value=""
        className="w-[var(--store-density-reading-width)] flex-none font-mono text-2xs text-text"
      >
        {label}
      </span>
    </div>
  );
}
