import { Toggle } from "@base-ui/react/toggle";
import { ToggleGroup } from "@base-ui/react/toggle-group";
import type * as React from "react";
import { hitTargetClasses } from "./control-well.js";

/**
 * A well of 2–4 exclusive labels, drawn without the labelled row: the header's
 * mode-level controls and a page's own sub-filter both need the same bare
 * `Segmented`, so it is one component rather than a class list copied per
 * caller.
 *
 * The group is its own label (`aria-label`), because the labels inside are the
 * options. The arrow keys are the primitive's roving focus — one Tab stop for
 * the group — and the chosen label takes `--stage`, never an accent fill.
 */
export function BareSegmented<T extends string>(props: {
  readonly id: string;
  readonly label: string;
  readonly value: T;
  readonly options: readonly { readonly id: T; readonly name: string }[];
  readonly onChange: (id: T) => void;
  /** The caller's marker, on the group the labels sit in. */
  readonly data?: Readonly<Record<`data-${string}`, string>> | undefined;
}): React.JSX.Element {
  return (
    <ToggleGroup
      id={props.id}
      {...props.data}
      aria-label={props.label}
      value={[props.value]}
      onValueChange={(next) => {
        const chosen = next[0];
        if (chosen !== undefined) props.onChange(chosen as T);
      }}
      className="flex flex-none gap-[var(--space-4)] rounded-md border border-edge bg-panel-2 p-[var(--space-4)]"
    >
      {props.options.map((option) => (
        <Toggle
          key={option.id}
          id={`${props.id}-${option.id}`}
          value={option.id}
          className={`${hitTargetClasses} min-w-0 flex-none whitespace-nowrap rounded-sm px-[var(--space-8)] py-[var(--space-4)] text-xs text-muted data-[pressed]:text-text data-[pressed]:[background:var(--stage)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent`}
        >
          {option.name}
        </Toggle>
      ))}
    </ToggleGroup>
  );
}
