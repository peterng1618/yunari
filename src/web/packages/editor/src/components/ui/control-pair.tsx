import type * as React from "react";
import { ControlNumber } from "./control-number.js";
import {
  type ControlDensity,
  ControlRow,
  useControlIds,
} from "./control-well.js";

/**
 * Two numbers sharing one row, each committing its own.
 *
 * The geometry lines are pairs — `X`/`Y` on one line, `W`/`H` on another, a
 * line's two ends — and a pair is a layout, not a control: it is two wells on
 * one line, which is what DESIGN.md §5 already draws. `ControlPair` owns the row and
 * the row's label; each half is a `ControlNumber` in its `inline` form, so the
 * draft, the validation and the commit rule stay in the one control that owns
 * them rather than being re-derived here.
 *
 * **Each half writes only itself.** A pair that committed both would rewrite the
 * half the author never touched — and an object dragged to a fractional size
 * shows a rounded number in the field it did not edit, so writing the sibling
 * would quantise the dimension behind the author's back.
 *
 * The row carries `data-yunari-pair` so a suite can read which two fields share
 * a line; the halves' own hooks stay on their inputs.
 */
export function ControlPair(props: {
  readonly label: string;
  readonly halves: readonly {
    readonly label: string;
    readonly value: number;
    readonly data?: Readonly<Record<`data-${string}`, string>>;
    /** A percentage half says so; the number it shows is already scaled. */
    readonly unit?: string;
    readonly integer?: boolean;
    /** The pair's own bounds, on both halves: a width and a height the same
     *  document holds are the same size. */
    readonly min?: number;
    readonly max?: number;
    readonly onCommit: (value: number) => void;
  }[];
  readonly density?: ControlDensity;
  /** The row's own note, on both halves: a pair commits one size, so a note
   *  about what that size means describes both boxes or neither. */
  readonly describedById?: string;
}): React.JSX.Element {
  const { label, halves, density, describedById } = props;
  const ids = useControlIds(undefined);

  return (
    <div data-yunari-pair="">
      <ControlRow ids={ids} label={label} density={density}>
        {halves.map((half) => (
          <ControlNumber
            key={half.label}
            inline
            label={half.label}
            value={half.value}
            {...(density === undefined ? {} : { density })}
            {...(describedById === undefined ? {} : { describedById })}
            {...(half.data === undefined ? {} : { data: half.data })}
            {...(half.unit === undefined ? {} : { unit: half.unit })}
            {...(half.integer === undefined ? {} : { integer: half.integer })}
            {...(half.min === undefined ? {} : { min: half.min })}
            {...(half.max === undefined ? {} : { max: half.max })}
            onCommit={half.onCommit}
          />
        ))}
      </ControlRow>
    </div>
  );
}
