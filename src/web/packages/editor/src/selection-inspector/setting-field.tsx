import {
  readSetting,
  type SettingsFieldDescriptor,
} from "@yunari/renderer-core";
import type * as React from "react";
import { ControlNumber } from "../components/ui/control-number.js";
import { ControlSelect } from "../components/ui/control-select.js";
import { ControlSlider } from "../components/ui/control-slider.js";
import { ControlToggle } from "../components/ui/control-toggle.js";
import { uiCopy } from "../ui-copy.js";

/**
 * One chart-setting descriptor, rendered as React.
 *
 * The descriptor is the input: a `SettingsFieldDescriptor` names the question,
 * its kind, its bounds and its optionality, and this control turns that into
 * the plan-1 control for the kind. It owns no chart and writes no setting — the
 * caller reads the value out and commits back through its own path, which is
 * also what keeps `path` and `visibleWhen` out of this file.
 *
 * `bounds` carries what only the caller can resolve: a track's ceiling read off
 * the chart's drawn box, or the discrete list a generated setting offers. A
 * field with both bounds is a track; one without is a typed box.
 */

/** The caller's resolved bounds, where the descriptor's own are not the answer. */
export interface SettingFieldBounds {
  readonly min?: number;
  readonly max?: number;
  /** The only values a discrete setting accepts, in their authored order. */
  readonly values?: readonly number[];
  readonly decimals?: number;
  readonly integer?: true;
  readonly suffix?: string;
}

export interface SettingFieldProps {
  readonly descriptor: SettingsFieldDescriptor;
  /** Overrides the id keyed by the descriptor's property, for a caller whose
   *  surface already owns the hook. */
  readonly id?: string;
  /** The value at the descriptor's path, or `undefined` when none is authored. */
  readonly value: unknown;
  readonly bounds?: SettingFieldBounds;
  /** Why this field refuses an edit. Renders `aria-disabled` and a tooltip. */
  readonly disabledReason?: string;
  /** The next value. `undefined` means remove the setting. */
  readonly onChange: (next: unknown) => void;
}

/**
 * Whether the descriptor is a question in this state at all.
 *
 * A `visibleWhen` that does not match is not a disabled field — a no is not the
 * same answer as a refusal — so the caller renders nothing for it.
 */
export function isSettingVisible(
  descriptor: SettingsFieldDescriptor,
  settings: unknown,
): boolean {
  const condition = descriptor.visibleWhen;
  if (condition === undefined) return true;

  const value = readSetting(settings, condition.path);
  if ("equals" in condition) return value === condition.equals;

  // An absent setting is not the state the question is about — a chart with no
  // authored divisor draws continuously, which is what `100` already means, so
  // asking about the segmented state would offer a choice that draws nothing.
  return value !== undefined && String(value) !== condition.notEquals;
}

export function SettingField(props: SettingFieldProps): React.JSX.Element {
  const { descriptor, bounds, disabledReason, onChange } = props;
  // Keyed by the setting itself, so the specs, the screenshots and
  // `rebuild-driver` keep addressing the same controls. A nested setting's
  // `property` is its dotted path, so its id carries the dots too.
  const id = props.id ?? `yunari-chart-setting-${descriptor.property}`;
  const data = { "data-yunari-chart-setting": descriptor.property };
  const common = {
    label: descriptor.label,
    hint: descriptor.hint,
    id,
    data,
    ...(disabledReason === undefined ? {} : { refused: disabledReason }),
  };

  if (descriptor.kind === "boolean") {
    return (
      <ControlToggle
        {...common}
        checked={props.value === true}
        onChange={(value) => onChange(value)}
      />
    );
  }

  if (descriptor.kind === "select") {
    const options = (descriptor.options ?? []).map((option) => ({
      id: option.value,
      name: option.label,
    }));
    return (
      <ControlSelect
        {...common}
        value={typeof props.value === "string" ? props.value : ""}
        // A select has no empty value of its own, and the absent state is one
        // the `optional` fields promise — so it gets a choice of its own rather
        // than being the one state the author cannot return to.
        options={
          descriptor.optional === true
            ? [{ id: "", name: uiCopy.panels.notSet }, ...options]
            : options
        }
        onChange={(value) =>
          onChange(
            descriptor.optional === true && value === "" ? undefined : value,
          )
        }
      />
    );
  }

  const authored = props.value;
  const value =
    typeof authored === "number" && Number.isFinite(authored)
      ? authored
      : undefined;

  // A measured field's ceiling can only be resolved by its owner, so the bounds
  // arrive here already read. Both ends present makes a track; a minimum alone
  // still leaves a typed box, because a track with no ceiling offers a range
  // the store does not honour.
  const min = bounds?.min ?? descriptor.min;
  const max = bounds?.max ?? descriptor.max;
  const discrete = bounds?.values;
  if (discrete !== undefined || (min !== undefined && max !== undefined)) {
    const floor = discrete?.[0] ?? min ?? 0;
    const ceiling = discrete?.at(-1) ?? max ?? floor;
    return (
      <ControlSlider
        {...common}
        value={value ?? floor}
        min={floor}
        max={ceiling}
        {...(discrete === undefined ? {} : { values: discrete })}
        {...(bounds?.integer === undefined ? {} : { integer: bounds.integer })}
        {...(bounds?.decimals === undefined
          ? {}
          : { decimals: bounds.decimals })}
        {...(bounds?.suffix === undefined ? {} : { suffix: bounds.suffix })}
        onCommit={(next) => onChange(next)}
        {...(descriptor.optional === true
          ? { onClear: () => onChange(undefined) }
          : {})}
      />
    );
  }

  return (
    <ControlNumber
      {...common}
      value={value}
      {...(min === undefined ? {} : { min })}
      {...(max === undefined ? {} : { max })}
      {...(descriptor.integer === true ? { integer: true } : {})}
      onCommit={(next) => onChange(next)}
      {...(descriptor.optional === true
        ? { onClear: () => onChange(undefined) }
        : {})}
    />
  );
}
