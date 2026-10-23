import type { Artboard, ThemeMetadata } from "@yunari/renderer-core";
import type { SceneBox } from "@yunari/scene-fabric";
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { DocumentPane } from "./panes/document/document-pane.js";

/**
 * The canvas's own event surface, which is all this panel needs from it.
 *
 * Narrow on purpose: the panel measures a scene and prints a figure, so pulling
 * in the editor's whole interaction surface for `on` and `off` would be a
 * dependency on crop and text management this panel never touches.
 */
interface CanvasEvents {
  on(event: string, handler: () => void): void;
  off(event: string, handler: () => void): void;
}

export interface ArtboardPanel {
  readonly root: HTMLElement;
  render(artboard: Artboard, metadata?: ThemeMetadata): void;
  /** Releases the canvas subscription and the React tree. */
  destroy(): void;
}

export interface ThemeSettingsOptions {
  readonly onMetadataChange?: (metadata: ThemeMetadata) => void;
}

/**
 * Product-owned document settings: the theme's metadata and the artboard it is
 * drawn on.
 *
 * The factory keeps its `root`/`render` pair, so `editor-session.ts` keeps its
 * construction site; what changed is the rendering, which is the Document
 * pane's React tree. The panel holds the two values the session hands it — the
 * artboard and the metadata — and every field is a child of that tree rather
 * than a `createRoot` of its own.
 *
 * **It holds no palette and no asset list.** The board's colour, media and fit
 * are the background layer's, and the selection inspector's `backgroundColumn`
 * asks the document and the asset manager for them.
 */
export function createArtboardPanel(
  host: HTMLElement,
  onChange: (artboard: Artboard) => void,
  options: ThemeSettingsOptions & {
    /** The scene, so the panel can say how much of it the frame now holds.
     *  Optional, and the panel is truthful without it — it falls back to the
     *  rule alone rather than claiming a number it cannot read. */
    readonly sceneBoxes?: () => readonly SceneBox[];
    /** Subscribed so the figure follows the scene. Without it the panel is a
     *  rule with a number that only refreshes when the artboard itself changes,
     *  so an author moving an object across the edge sees no change at all. */
    readonly canvasEvents?: CanvasEvents;
  } = {},
): ArtboardPanel {
  const root = document.createElement("section");
  // No `data-yunari-panel` and no title here: `Pane` owns the identity and the
  // title bar, and a second element under either is a strict-mode failure for
  // every locator that browses by it.
  host.append(root);

  let current: Artboard | undefined;
  let metadata: ThemeMetadata | undefined;

  const reactRoot: Root = createRoot(root);

  /** The one writer of the tree, so nothing can be drawn from a half-updated
   *  panel. A caller that reads the pane straight after building or refreshing
   *  it must see the content, not the frame before React commits — the contract
   *  the imperative panel had. */
  const draw = (): void => {
    const shown = current;
    // Nothing to draw until a document arrives: `render` is the first draw, and
    // a scene event before it has no artboard to measure against.
    if (shown === undefined) return;
    flushSync(() => {
      reactRoot.render(
        createElement(DocumentPane, {
          artboard: shown,
          metadata,
          // Read at the moment of the draw: a fresh reading is what makes the
          // note follow the scene, and this is the only place that knows a draw
          // happened. It is also why an `object:modified` — or the frame of a
          // drag — may redraw the whole pane: the control set keeps an author's
          // half-typed draft in its own state, so a draw no longer rebuilds the
          // field out from under them.
          boxes: options.sceneBoxes?.(),
          onArtboard: (next) => {
            // Held before the session is told, so the controls show what was
            // committed even when a caller does not hand the value back.
            current = next;
            draw();
            onChange(next);
          },
          onMetadata: (next) => {
            metadata = next;
            draw();
            options.onMetadataChange?.(next);
          },
        }),
      );
    });
  };

  options.canvasEvents?.on("object:modified", draw);

  /** The drag's own event, coalesced onto the frame the canvas paints next.
   *
   *  Fabric reports a gesture as `object:moving` once per frame and only
   *  announces its end as `object:modified`, so a figure subscribed to the
   *  release alone stands still for the whole drag. The stream is coalesced
   *  rather than dropped: one recompute per animation frame, however many
   *  events that frame carries. */
  let pending: number | undefined;
  const follow = (): void => {
    if (pending !== undefined) return;
    pending = requestAnimationFrame(() => {
      pending = undefined;
      draw();
    });
  };
  options.canvasEvents?.on("object:moving", follow);

  return {
    root,
    render(
      artboard: Artboard,
      nextMetadata: ThemeMetadata | undefined = metadata,
    ) {
      current = artboard;
      metadata = nextMetadata;
      draw();
    },
    destroy() {
      options.canvasEvents?.off("object:modified", draw);
      options.canvasEvents?.off("object:moving", follow);
      // The frame is the second half of the subscription: one armed for a drag
      // that has not finished would draw a tree this call is about to unmount.
      if (pending !== undefined) cancelAnimationFrame(pending);
      // Unmount first, then remove: a React root subscribes, and removing its
      // container unsubscribes nothing, so the tree would outlive the pane for
      // the page's lifetime.
      reactRoot.unmount();
      root.remove();
    },
  };
}
