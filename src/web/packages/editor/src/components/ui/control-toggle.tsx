import { Switch } from "@base-ui/react/switch";
import type * as React from "react";
import {
  type ControlProps,
  ControlRow,
  type ControlShape,
  describedBy,
  hitTargetClasses,
  isBlocked,
  useControlIds,
} from "./control-well.js";

/**
 * A boolean that applies immediately, as a 26×14 pill.
 *
 * The primitive's `readOnly` is what a refusal uses: the switch stays in the
 * tab order, its reason stays readable, and the flip is refused at the source
 * rather than hidden behind a disabled attribute. `nativeButton` keeps the id
 * on the focus target, which is what the row's `<label for>` names.
 *
 * The 26×14 pill is the *paint*; the target is the 24×24 `hitTargetClasses`
 * carries, because §5's dense-chrome rule is about what can be hit, not what
 * is drawn.
 *
 * Hover raises the resting `--edge` to `--muted`, but only
 * while unchecked: the checked pill's border is `--accent`, and hover must not
 * override the state that carries the boolean.
 */
export function ControlToggle(
  props: ControlProps & {
    readonly checked: boolean;
    readonly onChange: (value: boolean) => void;
    /** The row's shape, where the surface's drawing draws this switch as
     *  something other than the inspector's labelled row — the settings modal
     *  draws it `boxed`. */
    readonly shape?: ControlShape;
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
    shape,
    checked,
    onChange,
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
      <Switch.Root
        {...data}
        nativeButton
        render={<button type="button" />}
        id={ids.control}
        checked={checked}
        readOnly={blocked}
        disabled={disabled}
        aria-disabled={refused === undefined ? undefined : true}
        aria-describedby={describedBy(
          hint === undefined ? undefined : ids.hint,
          refused === undefined ? undefined : ids.reason,
        )}
        onCheckedChange={(next) => {
          if (blocked) return;
          onChange(next);
        }}
        className={`${hitTargetClasses} flex h-[14px] w-[26px] flex-none items-center rounded-full border border-edge bg-panel-2 p-0 hover:data-[unchecked]:border-muted data-[checked]:border-accent data-[checked]:bg-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2`}
      >
        <Switch.Thumb className="block size-[10px] translate-x-[4px] rounded-full bg-muted transition-transform data-[checked]:translate-x-[10px] data-[checked]:bg-panel" />
      </Switch.Root>
    </ControlRow>
  );
}
