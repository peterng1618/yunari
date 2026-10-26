import type { TypePreset } from "@yunari/renderer-core";
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import type { TokenSelectionStore } from "../editor-shell/shell-stores.js";
import type { CuratedFontFace } from "../font-catalog.js";
import { newPresetType } from "../new-fabric-theme-globals.js";
import {
  PresetList,
  type PresetSelection,
} from "../panes/tokens/preset-list.js";
import { uiCopy } from "../ui-copy.js";

export type TypePresets = Readonly<
  Record<string, { readonly name: string; readonly value: TypePreset }>
>;

export interface TypePresetPanel {
  readonly root: HTMLElement;
  render(presets: TypePresets | undefined): void;
  /** Unmounts the React tree, then removes the section. A React root
   *  subscribes; removing its container unsubscribes nothing, so the tree would
   *  outlive the pane for the page's lifetime (`react-root-disposal.dom.test.ts`
   *  pins this file's one root). */
  destroy(): void;
}
export interface TypePresetFontActions {
  readonly applyFace: (
    presetId: string,
    face: CuratedFontFace,
  ) => Promise<void>;
  readonly applyTrio: (trioId: string) => Promise<void>;
}

/**
 * Product-owned global type authoring. Text objects retain stable preset
 * references.
 *
 * The factory keeps its signature and its `root`/`render` pair, so
 * `editor-session.ts` keeps its construction site; what it renders is the Tokens
 * pane's React tree — the heading, the canvas-binding readout, the preset rows
 * and the add action — rather than an imperative panel, and it is a **sibling**
 * section of the palette panel's under the same Tokens-pane host (R36) — it
 * builds its own section and never reaches into the palette's tree.
 *
 * `selection` is the shell's own projection of the selection, handed in so the
 * list can say what the canvas selection is set in (`vg-094`); `tokenSelection`
 * is the shell's, handed in so a row press selects the token the inspector will
 * edit. Both are optional, and a panel built without them reads as nothing
 * selected.
 *
 * `onDelete` and `fontActions` stay on the signature even though the list no
 * longer renders a control for either: the session builds `fontActions` for the
 * selection inspector's face field as well, and this factory's positional
 * parameters are the session's call site. The preset's editable fields — and
 * the delete row among them — now belong to the token inspector.
 */
export function createTypePresetPanel(
  host: HTMLElement,
  onChange: (presets: TypePresets) => void,
  onDelete?: (id: string, replacement: string) => void,
  fontActions?: TypePresetFontActions,
  selection?: PresetSelection,
  tokenSelection?: TokenSelectionStore,
): TypePresetPanel {
  const root = document.createElement("section");
  // No `data-yunari-panel` and no title here: `Pane` owns the identity and the
  // title bar, and a second element under either is a strict-mode failure for
  // every locator that browses by it.
  host.append(root);

  const reactRoot: Root = createRoot(root);
  const draw = (presets: TypePresets | undefined): void => {
    const current = presets ?? {};
    // Flushed, so a caller that reads the pane straight after building or
    // refreshing it sees the presets rather than the frame before React commits
    // — the contract the imperative panel had.
    flushSync(() => {
      reactRoot.render(
        createElement(PresetList, {
          presets: current,
          // The list mints the id; the record is built here because `onChange`
          // is this factory's write port.
          onAdd: (id: string) =>
            onChange({
              ...current,
              [id]: { name: uiCopy.panels.newType, value: newPresetType },
            }),
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
