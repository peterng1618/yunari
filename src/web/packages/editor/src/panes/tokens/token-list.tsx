import { plainButtonClasses } from "../../components/ui/control-well.js";
import {
  type TokenSelectionStore,
  useTokenSelection,
} from "../../editor-shell/shell-stores.js";
import type { TypeTokens } from "../../type-preset-manager/panel.js";
import { orderedTokens, tokenName } from "../../type-token-manager/name.js";
import { uiCopy } from "../../ui-copy.js";
import { type TokenUsage, usageFigure } from "./token-use.js";

/**
 * The Tokens pane's type-token library as a list: every token as one pressable
 * row, with its specimen, its computed name and its usage figure, and an add
 * action.
 *
 * **A row is a selector, not a control.** Pressing it selects the token for the
 * inspector; nothing here edits the document. The row shows the specimen `Aa`
 * in the token's own family (packaged faces are already in `document.fonts`, so
 * nothing is fetched) and its computed name.
 *
 * **The name is the whole reading.** `tokenName` is the family and weight the
 * author chose, so a second line restating them said nothing; one row shape,
 * with the usage figure where the paint list puts it, is what the two libraries
 * share.
 *
 * **Nothing is re-derived here (R33).** The membership and its order are
 * `orderedTokens`'s, the name is `tokenName`'s, and the figure is
 * `usageFigure`'s.
 */
export interface TokenListProps {
  readonly presets: TypeTokens;
  /** The host's add port. The id is minted by the panel, which owns the
   *  duplicate rule and the stable ids references are written against. */
  readonly onAdd: () => void;
  /** The token selection the rows set and state. Absent reads as none. */
  readonly tokenSelection: TokenSelectionStore | undefined;
  /** The objects each token is linked to, or `undefined` when the pane has no
   *  scene to read. A function, not a record: the scene changes under the pane,
   *  so the figure is re-read on every draw rather than frozen at construction. */
  readonly usage: (() => TokenUsage) | undefined;
}

export function TokenList(props: TokenListProps): React.JSX.Element {
  const { presets, onAdd, tokenSelection, usage } = props;
  const entries = orderedTokens({ typeTokens: presets });
  const selectedToken = useTokenSelection(tokenSelection);
  const uses = usage?.();
  // A row's one gesture. The store owns the canvas clear, so this file never
  // reaches Fabric.
  const onSelect = (id: string): void =>
    tokenSelection?.set({ kind: "preset", id });

  return (
    <div
      data-yunari-type-presets=""
      className="flex flex-col gap-[var(--space-8)]"
    >
      <h2 className="text-xs font-semibold tracking-[0.11em] text-muted uppercase">
        {uiCopy.panels.typeTokens}
      </h2>
      <ul className="flex flex-col gap-[var(--space-4)]">
        {entries.map(({ id, token }) => (
          <li key={id}>
            <button
              type="button"
              data-yunari-type-preset-row={id}
              aria-pressed={
                selectedToken?.kind === "preset" && selectedToken.id === id
              }
              onClick={() => onSelect(id)}
              className="flex min-h-[26px] w-full items-center gap-[var(--space-6)] rounded-md border border-edge bg-panel-2 px-[var(--space-6)] text-left text-sm text-text hover:border-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent aria-pressed:border-accent"
            >
              <span
                data-yunari-type-preset-specimen=""
                aria-hidden="true"
                className="flex-none text-sm text-text"
                style={{ fontFamily: token.family }}
              >
                Aa
              </span>
              <span className="truncate">{tokenName(id, token)}</span>
              <span
                data-yunari-type-preset-usage=""
                className="ml-auto flex-none text-xs text-muted tabular-nums"
              >
                {usageFigure(uses, id)}
              </span>
            </button>
          </li>
        ))}
      </ul>
      <button
        type="button"
        data-yunari-type-preset-add=""
        onClick={onAdd}
        className={plainButtonClasses}
      >
        {uiCopy.panels.addType}
      </button>
    </div>
  );
}
