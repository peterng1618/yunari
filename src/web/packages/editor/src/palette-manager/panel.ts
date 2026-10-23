import type { FabricPalette } from "@yunari/renderer-core";
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { TokensPane } from "../panes/tokens/tokens-pane.js";

/** An object a token is linked to. The name is what the pane shows; the id is
    the stable key the layer list and every binding use (§75). */
export interface PaletteTokenUse {
  readonly objectId: string;
  readonly name: string;
}

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
  readonly usage?: () => Readonly<Record<string, readonly PaletteTokenUse[]>>;
  /**
   * The settled boundary of a colour edit — the session's history save. Live
   * changes call the panel's `onChange` repeatedly; this fires once per gesture.
   */
  readonly onSettled?: (() => void) | undefined;
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
 * The factory keeps its signature and its `root`/`render` pair, so
 * `editor-session.ts` keeps its construction site; what changed is the
 * rendering, which is the Tokens pane's React tree. The picker and the gradient
 * editor are children of that tree rather than nested `createRoot`s.
 */
export function createPalettePanel(
  host: HTMLElement,
  onChange: (palette: FabricPalette) => void,
  onDelete?: (id: string, replacement: string) => void,
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
          onSettled: options.onSettled,
          onDelete,
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
