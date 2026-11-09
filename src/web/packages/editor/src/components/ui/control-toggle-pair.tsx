import type * as React from "react";
import { ControlToggle } from "./control-toggle.js";
import {
  type ControlDensity,
  ControlRow,
  useControlIds,
} from "./control-well.js";

/**
 * Two independent booleans sharing one row, each committing its own.
 *
 * The background's two mirrors are one concept — how its picture is flipped —
 * so they belong on one line, the way the offsets do. `ControlPair` owns that
 * shape for numbers; a switch is a different control, not a number half, so
 * this is its own component rather than a union arm there.
 *
 * The row owns the label; each half is a `ControlToggle` in its `inline` form,
 * so the checked state, the refusal and the focus target stay in the one
 * switch owner rather than being re-derived here. The row carries
 * `data-yunari-pair` so a suite can read which two fields share a line.
 */
export function ControlTogglePair(props: {
  readonly label: string;
  readonly halves: readonly {
    readonly label: string;
    readonly checked: boolean;
    readonly data?: Readonly<Record<`data-${string}`, string>>;
    readonly onChange: (value: boolean) => void;
  }[];
  readonly density?: ControlDensity;
}): React.JSX.Element {
  const { label, halves, density } = props;
  const ids = useControlIds(undefined);

  return (
    <div data-yunari-pair="">
      <ControlRow ids={ids} label={label} density={density}>
        {halves.map((half) => (
          <ControlToggle
            key={half.label}
            inline
            label={half.label}
            checked={half.checked}
            {...(density === undefined ? {} : { density })}
            {...(half.data === undefined ? {} : { data: half.data })}
            onChange={half.onChange}
          />
        ))}
      </ControlRow>
    </div>
  );
}
