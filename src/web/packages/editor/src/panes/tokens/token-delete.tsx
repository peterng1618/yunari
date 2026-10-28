import { useState } from "react";
import { ControlSelect } from "../../components/ui/control-select.js";
import { plainButtonClasses } from "../../components/ui/control-well.js";
import { uiCopy } from "../../ui-copy.js";

/** One token a deletion may move references to. The name is what the list
 *  offers; the id is the stable key references are rewritten onto. */
export interface DeleteTarget {
  readonly id: string;
  readonly name: string;
}

/**
 * Deleting a token, behind the reassignment its references need.
 *
 * **Nothing is destroyed until a target is chosen, and the box appearing is
 * the warning.** The row opens as one button; pressing it reveals the
 * reassignment list, empty, because a token's references have to move
 * somewhere and only the author can say where. The second press deletes, and
 * it is refused until an entry is picked — so an accidental press opens a
 * question rather than removing anything.
 *
 * **The empty state is the primitive's, not a "None" entry.** An unselected
 * `ControlSelect` prints its placeholder; a synthetic option would put a
 * non-choice in the list, where it reads as a value the author could pick
 * (`decisions/0130`).
 *
 * The `data-*` hooks stay with the caller: they are the surface's selectors,
 * and this component knows nothing about which token kind it is deleting.
 */
export function TokenDelete(props: {
  readonly options: readonly DeleteTarget[];
  readonly onDelete: (replacement: string) => void;
  readonly label: string;
  readonly selectData: Readonly<Record<`data-${string}`, string>>;
  readonly buttonData: Readonly<Record<`data-${string}`, string>>;
}): React.JSX.Element {
  const { options, onDelete, label, selectData, buttonData } = props;
  const [revealed, setRevealed] = useState(false);
  const [picked, setPicked] = useState<string | undefined>(undefined);
  // The list can lose the entry that was picked — an undo can restore a palette
  // without it — and a target the palette no longer declares must not be
  // written into a reference.
  const chosen =
    picked !== undefined && options.some((option) => option.id === picked)
      ? picked
      : undefined;
  return (
    <>
      {revealed ? (
        <ControlSelect
          label={uiCopy.panels.reassign}
          data={selectData}
          value={chosen ?? ""}
          placeholder={uiCopy.panels.reassignPlaceholder}
          options={options}
          onChange={setPicked}
        />
      ) : null}
      <button
        type="button"
        {...buttonData}
        disabled={revealed && chosen === undefined}
        onClick={() => {
          if (!revealed) {
            setRevealed(true);
            return;
          }
          if (chosen !== undefined) onDelete(chosen);
        }}
        className={`${plainButtonClasses} text-hot disabled:text-faint`}
      >
        {label}
      </button>
    </>
  );
}
