import { Radio } from "@base-ui/react/radio";
import type * as React from "react";
import {
  type ControlProps,
  describedBy,
  useControlIds,
} from "./control-well.js";

/**
 * The shapes a drawing gives a choice. `row` is §5's **choice row** and the
 * default; `card` is the settings modal's palette tile, which
 * `mockups/current/settings.html:44-87` draws as a `--radius-lg` card at
 * `--panel-2` carrying the caller's swatch *above* the name, the chosen one
 * marked by the accent border and its 3px glow rather than by a lift. `chip` is
 * §5's **preset chip**: a 24px rounded square carrying the swatch alone, its
 * name staying the programmatic label — the shape a swatch library takes when
 * the swatch is what the author recognises. All three are shapes of this
 * control rather than separate controls: the radio, the group's ownership of
 * the checked bit and its roving focus are the same in all, and only the
 * geometry differs — exactly as `ControlRow`'s three shapes divide.
 */
type ChoiceShape = "row" | "card" | "chip";

/**
 * One member of a closed set where every member has its own colour: a
 * `--radius-md` row at `--panel-2` carrying an adornment and a name, the chosen
 * one lifted to `--stage` behind an accent border (DESIGN.md §5) — or, where the
 * surface's own drawing shapes the choice as a tile, a `--radius-lg` card with
 * the adornment above the name (`ChoiceShape`).
 *
 * It is a **radio**, and the group owns which one is checked: `Radio.Root`
 * derives `aria-checked` from the enclosing `RadioGroup`'s value, so a `checked`
 * prop here would be a second source of truth for one bit that could disagree
 * with the primitive's. The group is also where the keyboard model lives — one
 * Tab stop with arrow keys between the rows is `RadioGroup`'s roving focus, not
 * a `tabIndex` this control would have to keep in step.
 *
 * The adornment is the caller's `ReactNode` rather than a palette, the same way
 * `ControlSwatch` takes its swatch: what a swatch looks like is the vocabulary of
 * the surface that has one, and a control set that knew about palettes would be
 * a control set with a renderer in it.
 */
export function ControlChoiceRow(
  props: ControlProps & {
    readonly value: string;
    readonly swatch: React.ReactNode;
    readonly shape?: ChoiceShape | undefined;
  },
): React.JSX.Element {
  const { label, id, disabled, refused, hint, data, value, swatch, shape } =
    props;
  const ids = useControlIds(id);
  // The two shapes share everything but their geometry: the same 1px `--edge`
  // at `--panel-2`, the same §5 rule 6 hover, the same §5.4 focus outline and
  // the same accent boundary when chosen. What differs is the axis — the card
  // stacks — and what *chosen* adds: the row lifts to `--stage`, the card keeps
  // its `--panel-2` ground and takes the drawing's glow.
  const shapeClasses = {
    row: "flex min-h-[32px] w-full flex-row items-center gap-[var(--space-8)] rounded-md px-[var(--space-10)] py-[var(--space-6)] text-muted data-[checked]:text-text data-[checked]:[background:var(--stage)]",
    card: "flex w-full flex-col gap-[var(--space-6)] rounded-lg p-[var(--space-8)] text-text data-[checked]:ring-3 data-[checked]:ring-accent/18",
    // The chip's own edge is the swatch's boundary; the chosen one takes the
    // accent border and §4's translucent accent halo, the same chosen marker
    // the card uses. The swatch fills it, so there is no padding to lose height.
    chip: "relative size-6 flex-none overflow-hidden rounded-sm p-0 data-[checked]:ring-2 data-[checked]:ring-accent/18",
  }[shape ?? "row"];

  return (
    <>
      <Radio.Root
        {...data}
        nativeButton
        render={<button type="button" />}
        id={ids.control}
        value={value}
        aria-label={label}
        disabled={disabled}
        // A refusal blocks the choice without leaving the tab order, which §5.3
        // requires: a natively disabled radio is announced by nobody who is not
        // already holding a pointer.
        readOnly={refused !== undefined}
        aria-disabled={refused === undefined ? undefined : true}
        aria-describedby={describedBy(
          hint === undefined ? undefined : ids.hint,
          refused === undefined ? undefined : ids.reason,
        )}
        className={`${shapeClasses} border border-edge bg-panel-2 text-left text-xs hover:border-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2 data-[checked]:border-accent`}
      >
        {swatch}
        {/* A chip's whole visible content is the swatch; its name is the
            accessible label, and printing it is the row this shape replaces. */}
        {shape === "chip" ? null : label}
      </Radio.Root>
      {/* The ids live in the row rather than in a `ControlRow`: a choice row is
          itself the whole row, so a label-and-control pair beside it would be a
          second thing to read. The description is the same description. */}
      {hint === undefined ? null : (
        <p id={ids.hint} className="sr-only">
          {hint}
        </p>
      )}
      {refused === undefined ? null : (
        <p id={ids.reason} className="text-xs text-muted">
          {refused}
        </p>
      )}
    </>
  );
}
