import type { TypeToken } from "@yunari/renderer-core";
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import type { TokenSelectionStore } from "../editor-shell/shell-stores.js";
import type { CuratedFontFace } from "../font-catalog.js";
import { newTypeToken } from "../new-fabric-theme-globals.js";
import { type PresetSelection, TokenList } from "../panes/tokens/token-list.js";
import { freePresetId } from "../type-preset-apply.js";
import { tokenIdOfFace } from "../type-token-manager/name.js";

export type TypeTokens = Readonly<Record<string, TypeToken>>;

export interface TypeTokenPanel {
  readonly root: HTMLElement;
  render(presets: TypeTokens | undefined): void;
  /** Unmounts the React tree, then removes the section. A React root
   *  subscribes; removing its container unsubscribes nothing, so the tree would
   *  outlive the pane for the page's lifetime (`react-root-disposal.dom.test.ts`
   *  pins this file's one root). */
  destroy(): void;
}
export interface TypeTokenFontActions {
  readonly applyFace: (
    presetId: string,
    face: CuratedFontFace,
  ) => Promise<void>;
  readonly applyTrio: (trioId: string) => Promise<void>;
}

/**
 * Product-owned global type authoring. Text objects retain stable token
 * references.
 *
 * The factory keeps its signature and its `root`/`render` pair, so
 * `editor-session.ts` keeps its construction site; what it renders is the Tokens
 * pane's React tree — the heading, the canvas-binding readout, the token rows
 * and the add action — rather than an imperative panel, and it is a **sibling**
 * section of the palette panel's under the same Tokens-pane host (R36) — it
 * builds its own section and never reaches into the palette's tree.
 *
 * `selection` is the shell's own projection of the selection, handed in so the
 * list can say what the canvas selection is set in (`vg-094`); `tokenSelection`
 * is the shell's, handed in so a row press selects the token the inspector will
 * edit and so an add that duplicates an existing face can point at it. Both are
 * optional, and a panel built without them reads as nothing selected.
 *
 * `onDelete` and `fontActions` stay on the signature even though the list no
 * longer renders a control for either: the session builds `fontActions` for the
 * selection inspector's face field as well, and this factory's positional
 * parameters are the session's call site. The token's editable fields — and the
 * delete row among them — now belong to the token inspector.
 */
export function createTypeTokenPanel(
  host: HTMLElement,
  onChange: (presets: TypeTokens) => void,
  onDelete?: (id: string, replacement: string) => void,
  fontActions?: TypeTokenFontActions,
  selection?: PresetSelection,
  tokenSelection?: TokenSelectionStore,
): TypeTokenPanel {
  const root = document.createElement("section");
  // No `data-yunari-panel` and no title here: `Pane` owns the identity and the
  // title bar, and a second element under either is a strict-mode failure for
  // every locator that browses by it.
  host.append(root);

  const reactRoot: Root = createRoot(root);
  const draw = (presets: TypeTokens | undefined): void => {
    const current = presets ?? {};
    // Flushed, so a caller that reads the pane straight after building or
    // refreshing it sees the tokens rather than the frame before React commits
    // — the contract the imperative panel had.
    flushSync(() => {
      reactRoot.render(
        createElement(TokenList, {
          presets: current,
          // The duplicate rule and the id both live here: the panel owns the
          // write port and knows every token, so a second token for a face the
          // theme already has is refused and the existing one is selected.
          onAdd: () => {
            const existing = tokenIdOfFace(
              current,
              newTypeToken.family,
              newTypeToken.weight,
            );
            if (existing !== undefined) {
              tokenSelection?.set({ kind: "preset", id: existing });
              return;
            }
            onChange({
              ...current,
              [freePresetId(current)]: newTypeToken,
            });
          },
          selection,
          tokenSelection,
        }),
      );
    });
  };
  draw(undefined);

  return {
    root,
    render: draw,
    destroy() {
      reactRoot.unmount();
      root.remove();
    },
  };
}
