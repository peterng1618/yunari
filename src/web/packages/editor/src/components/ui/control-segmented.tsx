import { Toggle } from "@base-ui/react/toggle";
import { ToggleGroup } from "@base-ui/react/toggle-group";
import type * as React from "react";
import {
  type ControlProps,
  ControlRow,
  describedBy,
  hitTargetClasses,
  isBlocked,
  useControlIds,
} from "./control-well.js";

/**
 * A 2–4 way exclusive choice where every option has to stay readable: a
 * `--panel-2` well holding the labels, the active one lifted to `--stage`.
 *
 * The arrow keys are the primitive's roving focus rather than one Tab stop per
 * label, and the group carries the row's label as its accessible name — the
 * labels inside are the options, so naming the group is what makes "Align:
 * Center" mean anything. A refusal leaves the group browsable and refuses the
 * press, so the reason stays readable where a disabled group would take it out
 * of the tab order.
 *
 * Each label is a target in its own right, so each carries the 24×24 hit area
 * through `hitTargetClasses`; the label's own box is 22px tall, and the rows'
 * 4px gap keeps the two expanded targets from meeting.
 *
 * The caller's `data` rides every segment, not the group: a `Toggle` is the
 * focus target and the `ToggleGroup` is a wrapper (control-well.tsx), so the
 * attribute has to be on whichever segment the person is on.
 */
export function ControlSegmented<T extends string>(
  props: ControlProps & {
    readonly value: T;
    readonly options: readonly { readonly id: T; readonly name: string }[];
    readonly onChange: (id: T) => void;
  },
): React.JSX.Element {
  const {
    label,
    id,
    disabled,
    refused,
    hint,
    density,
    data,
    value,
    options,
    onChange,
  } = props;
  const ids = useControlIds(id);
  const blocked = isBlocked({ disabled, refused });
  const refusedState = refused === undefined ? undefined : true;

  return (
    <ControlRow
      ids={ids}
      label={label}
      refused={refused}
      hint={hint}
      density={density}
    >
      <ToggleGroup
        id={ids.control}
        value={[value]}
        aria-labelledby={ids.label}
        aria-disabled={refusedState}
        aria-describedby={describedBy(
          hint === undefined ? undefined : ids.hint,
          refused === undefined ? undefined : ids.reason,
        )}
        onValueChange={(next) => {
          const chosen = next[0];
          if (blocked || chosen === undefined) return;
          onChange(chosen as T);
        }}
        className="flex w-full gap-[var(--space-4)] rounded-md border border-edge bg-panel-2 p-[var(--space-4)]"
      >
        {options.map((option) => (
          <Toggle
            {...data}
            key={option.id}
            value={option.id}
            aria-disabled={refusedState}
            className={`${hitTargetClasses} rounded-sm px-[var(--space-8)] py-[var(--space-4)] text-xs text-muted data-[pressed]:text-text data-[pressed]:[background:var(--stage)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent`}
          >
            {option.name}
          </Toggle>
        ))}
      </ToggleGroup>
    </ControlRow>
  );
}
