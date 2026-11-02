import { Toggle } from "@base-ui/react/toggle";
import { ToggleGroup } from "@base-ui/react/toggle-group";
import { hitTargetClasses } from "../components/ui/control-well.js";
import { uiCopy } from "../ui-copy.js";
import type { StoreTab } from "./region.js";

/** The order the row draws them in, which is a separate decision from what each
 *  is called — the same split `MODE_ORDER` and `MODE_NAMES` make. */
const TAB_ORDER = ["local", "online"] as const satisfies readonly StoreTab[];

/** Each half's name, as a **total** lookup: a `StoreTab` added to the union
 *  without a label fails to compile here rather than rendering a segment with no
 *  name. */
const TAB_NAMES: Record<StoreTab, string> = {
  local: uiCopy.store.halves.local,
  online: uiCopy.store.halves.online,
};

const HALVES_ID = "yunari-store-halves";

const halvesSegmentId = (tab: StoreTab): string => `${HALVES_ID}-${tab}`;

/**
 * The two halves, as the `Segmented` in its **bare** form — the well holding
 * the labels, the chosen one lifted to `--stage` with `--text`, and no row label
 * beside it. It sits in the shell's header beside the mode switch, because the
 * row it used to share with the filter and the search is the surface's own
 * toolbar and the choice is a mode-level one.
 *
 * The group is its own name (the control-id rule): a screen reader reaching two
 * segments is told what is being chosen, and each segment carries an id.
 */
export function StoreHalves(props: {
  readonly tab: StoreTab;
  readonly onTab: (tab: StoreTab) => void;
}): React.JSX.Element {
  return (
    <ToggleGroup
      id={HALVES_ID}
      data-yunari-store-halves=""
      aria-label={uiCopy.store.halves.label}
      value={[props.tab]}
      onValueChange={(next) => {
        const chosen = next[0];
        if (chosen !== undefined) props.onTab(chosen as StoreTab);
      }}
      className="flex flex-none gap-[var(--space-4)] rounded-md border border-edge bg-panel-2 p-[var(--space-4)]"
    >
      {TAB_ORDER.map((tab) => (
        <Toggle
          key={tab}
          id={halvesSegmentId(tab)}
          value={tab}
          className={`${hitTargetClasses} min-w-0 flex-1 whitespace-nowrap rounded-sm px-[var(--space-8)] py-[var(--space-4)] text-xs text-muted data-[pressed]:text-text data-[pressed]:[background:var(--stage)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent`}
        >
          {TAB_NAMES[tab]}
        </Toggle>
      ))}
    </ToggleGroup>
  );
}
