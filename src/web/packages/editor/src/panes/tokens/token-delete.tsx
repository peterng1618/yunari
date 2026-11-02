import { useState } from "react";
import { ControlIconButton } from "../../components/ui/control-icon-button.js";
import { ControlSelect } from "../../components/ui/control-select.js";
import { DELETE_ITEM_GLYPH, Glyph } from "../../editor-shell/icons.js";
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
 * **A referenced token is not destroyed until a target is chosen, and the box
 * appearing is the warning.** The row opens as one button; pressing it reveals
 * the reassignment list, empty, because a token's references have to move
 * somewhere and only the author can say where. The second press deletes, and
 * it is refused until an entry is picked — so an accidental press opens a
 * question rather than removing anything.
 *
 * **An unreferenced token is deleted by the first press.** There is nothing to
 * move, so asking where to move it would be a question with no answer — or no
 * entries at all, for the last token. The caller decides `referenced` from the
 * same live walk its users list reads, so the row cannot offer a reassignment
 * the scene does not need.
 *
 * **The empty state is the primitive's, not a "None" entry.** An unselected
 * `ControlSelect` prints its placeholder; a synthetic option would put a
 * non-choice in the list, where it reads as a value the author could pick.
 *
 * The `data-*` hooks stay with the caller: they are the surface's selectors,
 * and this component knows nothing about which token kind it is deleting.
 */
export function TokenDelete(props: {
  readonly options: readonly DeleteTarget[];
  readonly referenced: boolean;
  readonly onDelete: (replacement: string | undefined) => void;
  readonly label: string;
  readonly selectData: Readonly<Record<`data-${string}`, string>>;
  readonly buttonData: Readonly<Record<`data-${string}`, string>>;
}): React.JSX.Element {
  const { options, referenced, onDelete, label, selectData, buttonData } =
    props;
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
    <div className="flex flex-col gap-[var(--space-6)]">
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
      <div className="flex justify-end">
        <ControlIconButton
          label={label}
          destructive
          ariaDisabled={referenced && revealed && chosen === undefined}
          data={buttonData}
          onClick={() => {
            if (!referenced) {
              onDelete(undefined);
              return;
            }
            if (!revealed) {
              setRevealed(true);
              return;
            }
            if (chosen !== undefined) onDelete(chosen);
          }}
        >
          <Glyph icon={DELETE_ITEM_GLYPH} size={14} />
        </ControlIconButton>
      </div>
    </div>
  );
}
