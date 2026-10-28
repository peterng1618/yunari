import type { FabricPalette } from "@yunari/renderer-core";
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import type { TokenSelectionStore } from "../editor-shell/shell-stores.js";
import type { TokenUsage } from "../panes/tokens/token-use.js";
import { TokensPane } from "../panes/tokens/tokens-pane.js";

export interface PalettePanelOptions {
  /**
   * The objects each token is linked to, or `undefined` when the panel has no
   * scene to read. A function, not a record, because the scene changes under
   * the panel and the figure has to be re-read on every draw rather than
   * frozen at construction.
   *
   * The count beside a token and the guard that decides whether a token may be
   * deleted come from this one source, so a token is never reported unused
   * while an object is painted with it.
   */
  readonly usage?: () => TokenUsage;
  /**
   * The settled boundary of the one discrete edit the pane still makes: adding
   * a token. Without the entry a later undo's globals restore silently removes
   * it.
   */
  readonly onSettled?: (() => void) | undefined;
  /**
   * The token selection the rows set and state. The panel renders the
   * `TokensPane`, so the store travels through this factory; a row press sets a
   * paint ref and the inspector opens.
   */
  readonly tokenSelection?: TokenSelectionStore | undefined;
}

export interface PalettePanel {
  readonly root: HTMLElement;
  render(palette: FabricPalette | undefined): void;
  /** Unmounts the React tree, then removes the section. A React root
   *  subscribes; removing its container unsubscribes nothing, so the tree would
   *  outlive the pane for the page's lifetime (`react-root-disposal.dom.test.ts`
   *  pins this file's one root). */
  destroy(): void;
}

/**
 * Product-owned palette authoring; tokens retain stable ids so references stay
 * valid.
 *
 * The factory keeps its `root`/`render` pair, so `editor-session.ts` keeps its
 * construction site; what changed is the rendering, which is the Tokens pane's
 * React tree. The picker, the gradient editor and the delete row are the token
 * inspector's now, reached through the token selection the pane's rows set.
 */
export function createPalettePanel(
  host: HTMLElement,
  onChange: (palette: FabricPalette) => void,
  options: PalettePanelOptions = {},
): PalettePanel {
  const root = document.createElement("section");
  // No `data-yunari-panel` and no title here: `Pane` owns the identity and the
  // title bar, and a second element under either is a strict-mode failure for
  // every locator that browses by it.
  host.append(root);

  const reactRoot: Root = createRoot(root);
  const paint = (palette: FabricPalette | undefined): void => {
    // Flushed, so a caller that reads the pane straight after building or
    // refreshing it sees the tokens rather than the frame before React commits
    // — the contract the imperative panel had.
    flushSync(() => {
      reactRoot.render(
        createElement(TokensPane, {
          palette: palette ?? {},
          usage: options.usage,
          onChange,
          tokenSelection: options.tokenSelection,
          onSettled: options.onSettled,
        }),
      );
    });
  };
  paint(undefined);

  return {
    root,
    render: paint,
    destroy() {
      reactRoot.unmount();
      root.remove();
    },
  };
}
