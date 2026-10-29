import { Select } from "@base-ui/react/select";
import type * as React from "react";
import {
  type ControlProps,
  ControlRow,
  type ControlShape,
  describedBy,
  isBlocked,
  useControlIds,
  wellClasses,
} from "./control-well.js";

/** One entry in a well that opens a list. `disabled` states a reading rather
 *  than a choice — the artboard's `Custom` — and keeps it out of the keyboard
 *  model while the trigger still prints it as the current value. `group` is the
 *  heading the entry sits under, if any: consecutive entries carrying the same
 *  group render together under one label, and an entry without one renders in
 *  the flat list. The list's own layout, not a second control. */
export type ControlOption = {
  readonly id: string;
  readonly name: string;
  readonly disabled?: boolean;
  readonly group?: string;
};

/** Runs of consecutive options sharing a group, in the order offered. A change
 *  of group starts a new run, so an ungrouped option after a grouped one is its
 *  own flat entry rather than joining the run above it.
 *
 *  Exported because the store's facet popover groups its values the same way and
 *  draws them with a heading of its own: two implementations of "consecutive
 *  values sharing a group render together under one label" is one too many. */
export function optionRuns<T extends { readonly group?: string }>(
  options: readonly T[],
): {
  readonly group: string | undefined;
  readonly options: readonly T[];
}[] {
  const runs: {
    group: string | undefined;
    options: T[];
  }[] = [];
  for (const option of options) {
    const last = runs.at(-1);
    if (last !== undefined && last.group === option.group)
      last.options.push(option);
    else runs.push({ group: option.group, options: [option] });
  }
  return runs;
}

/**
 * A value from a closed list, in a well with a chevron.
 *
 * Base UI's Select is the keyboard model and the popup; what this adds is
 * DESIGN.md's treatment and its refusal rule. A refused select uses the primitive's
 * `readOnly` rather than `disabled`: §5.3 wants the row present, the reason
 * readable and the tab order unchanged, and browsing a list you cannot choose
 * from is exactly what `readOnly` means here. `aria-disabled` is announced as
 * well, because the reason is a refusal and not an alternative meaning.
 */
export function ControlSelect(
  props: ControlProps & {
    /** The empty string states that nothing is chosen yet — a list that opens
     *  empty and forces a choice rather than starting on its first entry. */
    readonly value: string;
    readonly options: readonly ControlOption[];
    readonly onChange: (id: string) => void;
    /** What the trigger prints while `value` is empty. Absent reads as blank,
     *  which is what a select whose value is always a real id wants. */
    readonly placeholder?: string;
    /** The row's shape, where the surface's drawing draws this picker as
     *  something other than the labelled row — the Add pane's asset picker is
     *  `headed`. */
    readonly shape?: ControlShape;
  },
): React.JSX.Element {
  return <SelectControl {...props} />;
}

/**
 * The shared body of the select: one keyboard model, one popup, one refusal
 * rule, and one optional adornment in front of the value. `ControlSwatch` is
 * its only composition.
 */
export function SelectControl(
  props: ControlProps & {
    readonly value: string;
    readonly options: readonly ControlOption[];
    readonly onChange: (id: string) => void;
    readonly adornment?: React.ReactNode;
    readonly placeholder?: string;
    readonly shape?: ControlShape;
  },
): React.JSX.Element {
  const {
    label,
    id,
    disabled,
    refused,
    hint,
    describedById,
    density,
    data,
    shape,
    value,
    options,
    onChange,
    adornment,
    placeholder,
  } = props;
  const ids = useControlIds(id);
  const blocked = isBlocked({ disabled, refused });

  return (
    <ControlRow
      ids={ids}
      label={label}
      labelFor={ids.control}
      refused={refused}
      hint={hint}
      density={density}
      shape={shape}
    >
      <Select.Root
        items={options.map((option) => ({
          value: option.id,
          label: option.name,
        }))}
        value={value}
        readOnly={blocked}
        onValueChange={(next, details) => {
          // **Only an author's choice is a change.** Base UI reports
          // `reason: "none"` for the updates it makes itself, and one of those
          // is destructive: when the option list loses the item it had selected
          // — a palette token deleted under a paint picker — the primitive
          // clears its value and reports `""`, which this control would write
          // as "not set". The document has already re-pointed that reference by
          // then (`reassignPaletteToken`), so committing the empty value undoes
          // the reassignment and leaves the object unpainted. Measured: the
          // author's own choices arrive as `item-press`, the spurious one as
          // `none`.
          if (blocked || next === null || details.reason === "none") return;
          onChange(next);
        }}
      >
        <Select.Trigger
          {...data}
          id={ids.control}
          disabled={disabled}
          aria-disabled={refused === undefined ? undefined : true}
          aria-describedby={describedBy(
            describedById,
            hint === undefined ? undefined : ids.hint,
            refused === undefined ? undefined : ids.reason,
          )}
          className={`${wellClasses(density, blocked)} w-full justify-between gap-[var(--space-6)] text-sm text-text`}
        >
          {adornment === undefined ? null : (
            <span aria-hidden className="flex flex-none items-center">
              {adornment}
            </span>
          )}
          <Select.Value
            className="flex-1 truncate text-left font-mono"
            // The primitive's own empty state: an empty value is "nothing
            // chosen", so the trigger says what to do rather than nothing at
            // all.
            placeholder={placeholder}
            // The chosen id, on the element that prints the label. A driver
            // reads the value it must not guess at, and reads it by a hook
            // rather than by the `font-mono` beside it — a presentation class
            // is the design language's to rename, and an assertion keyed on one
            // would be a timeout naming nothing.
            data-yunari-value={value}
          />
          <Select.Icon aria-hidden className="flex-none text-2xs text-faint">
            ▼
          </Select.Icon>
        </Select.Trigger>
        <Select.Portal>
          {/* **Above the dialog pair, because a select can be inside a dialog.**
              The shell's floating layers are ordered tooltip 50 / menu and
              select 60 / dialog scrim 70 / dialog 71 (`editor-shell.css`), and a
              popup portalled to `body` from inside a `Dialog` is a sibling of
              that dialog's scrim rather than a descendant of its popup — at 60
              the scrim covers the list and every option is unclickable, which is
              what the new-theme chooser and the library chooser both did. 80
              keeps one order for both places. */}
          <Select.Positioner sideOffset={6} className="z-80">
            {/* **A list taller than the room it opens into scrolls.** Base UI
                measures the space on the popup's chosen side and publishes it as
                `--available-height`; without reading it the popup simply grows,
                and since it is portalled and fixed-positioned, the page cannot
                be scrolled to reach the rest. The clock's zone select is why
                this is not hypothetical — `Intl.supportedValuesOf("timeZone")`
                is 418 entries, so every zone past the fold was unreachable by
                any means. `.editor-shell-menu-popup` states the same rule for
                menus, which is where the failure was found the first time. */}
            <Select.Popup className="max-h-[var(--available-height)] min-w-[10rem] overflow-y-auto rounded-md border border-edge bg-panel p-[var(--space-6)] text-sm text-text shadow-[var(--elev-2)]">
              {optionRuns(options).map((run) => {
                const items = run.options.map((option) => (
                  <Select.Item
                    key={option.id}
                    value={option.id}
                    disabled={option.disabled ?? false}
                    // The value behind the choice, on the element a driver clicks.
                    // Base UI keeps the id in its store and renders only the label,
                    // so without this an option whose label is *document data* — a
                    // type preset's `Card title`, a token's `Muted text` — can only
                    // be named by copying the document's glossary into the suite.
                    // Namespaced like every other hook, so the string a locator
                    // names and the string the control commits are one string.
                    data-yunari-option={option.id}
                    className="cursor-default rounded-sm px-[var(--space-8)] py-[var(--space-4)] data-[highlighted]:bg-panel-2"
                  >
                    <Select.ItemText>{option.name}</Select.ItemText>
                  </Select.Item>
                ));
                // A heading is the run's own label, drawn above its items rather
                // than as a disabled option: a disabled option is still announced
                // as a choice this control will not commit.
                return run.group === undefined ? (
                  items
                ) : (
                  <Select.Group key={run.group}>
                    <Select.GroupLabel className="px-[var(--space-8)] pt-[var(--space-6)] pb-[var(--space-2)] text-2xs uppercase tracking-wide text-faint">
                      {run.group}
                    </Select.GroupLabel>
                    {items}
                  </Select.Group>
                );
              })}
            </Select.Popup>
          </Select.Positioner>
        </Select.Portal>
      </Select.Root>
    </ControlRow>
  );
}
