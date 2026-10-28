import type * as React from "react";
import { uiCopy } from "../../ui-copy.js";
import type { TokenUse } from "./token-use.js";

/**
 * The layers a design token is used by, in the token inspector.
 *
 * **An entry is a link to the layer, not a label.** The author is asking "who
 * uses this token"; the next thing they want is to look at one of them, so a
 * press selects it on the canvas and shows the Composition pane, which is also
 * how the object column comes back (`onRevealLayer`). Absent that port — a
 * mount with no shell behind it — an entry is a reading rather than a control,
 * because a link that goes nowhere is a lie.
 *
 * One component for both token kinds: a paint and a type token answer the same
 * question, and two lists would be two spellings of it.
 */
export function LayerUses(props: {
  readonly uses: readonly TokenUse[];
  readonly onRevealLayer?: ((objectId: string) => void) | undefined;
}): React.JSX.Element {
  const { uses, onRevealLayer } = props;
  return (
    <>
      <h3 className="text-xs text-muted">{uiCopy.panels.layers}</h3>
      <ul
        data-yunari-token-users=""
        className="flex flex-col gap-[var(--space-4)] text-xs text-text"
      >
        {uses.map((use) => (
          <li key={use.objectId}>
            {onRevealLayer === undefined ? (
              use.name
            ) : (
              <button
                type="button"
                data-yunari-token-user={use.objectId}
                onClick={() => onRevealLayer(use.objectId)}
                className="rounded-sm text-left underline decoration-edge underline-offset-2 hover:text-accent hover:decoration-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
              >
                {use.name}
              </button>
            )}
          </li>
        ))}
      </ul>
    </>
  );
}
