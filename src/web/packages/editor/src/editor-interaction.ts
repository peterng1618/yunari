import type { Canvas, FabricObject, IText } from "fabric/es";
import type { ClipboardManager } from "./clipboard-manager/index.js";
import type { CropManager } from "./crop-manager/index.js";
import type { DeletionManager } from "./deletion-manager/index.js";
import type { ErrorManager } from "./error-manager/index.js";
import type { GroupingManager } from "./grouping-manager/index.js";
import type { HistoryGlobalsPort } from "./history-manager/index.js";
import type {
  TextCreationOptions,
  TextPlacementPort,
} from "./text-manager/index.js";
import type { ViewportManager } from "./viewport-manager/index.js";

/** Product panels depend only on the editor mechanics they exercise. */
export interface EditorInteraction {
  readonly canvas: Canvas;
  /**
   * The authored frame the canvas is a viewport onto, as it is *now*.
   *
   * A getter because the artboard is resizable, and a placement computed
   * against the frame the author has since replaced is a ladder that no longer
   * ends inside the picture.
   */
  readonly artboard: () => { readonly width: number; readonly height: number };
  /** The camera over the canvas: the single writer of its viewport transform. */
  readonly viewport: ViewportManager;
  readonly imageManager: {
    importImage(options: {
      readonly source: File;
      readonly withoutAdding?: boolean;
      readonly withoutSave?: boolean;
    }): Promise<{ readonly image: FabricObject } | null>;
    destroy(): void;
  };
  readonly textManager: {
    /** The class the request chose — an `IText` with no box, a `Textbox` with
     *  one — as a text object so the caller can put the caret in it. */
    addText(options?: TextCreationOptions): IText;
    /** Arms the one-shot placement gesture the session's text route owns. */
    beginPlacement(port: TextPlacementPort): void;
    /**
     * Installs who paints an object's authoring view when the author starts
     * editing it. The session owns the run display that comes from, and the
     * shell that creates the manager has no session yet.
     */
    setAuthoringView(paint: (object: IText) => void): void;
    /**
     * Installs what puts an object's authored runs back after an in-place edit
     * was refused. The runtime owns what an object paints, so the put-back is
     * asked for rather than done here.
     */
    setRepaint(paint: (object: IText) => void): void;
  };
  readonly layerManager: {
    bringToFront(object?: FabricObject): void;
    bringForward(object?: FabricObject): void;
    sendToBack(object?: FabricObject): void;
    sendBackwards(object?: FabricObject): void;
  };
  readonly objectLockManager: {
    lockObject(input?: { readonly object?: FabricObject }): void;
    unlockObject(input?: { readonly object?: FabricObject }): void;
    destroy(): void;
  };
  readonly historyManager: {
    /** Where an entry's palette comes from and goes back to; the document owns
     *  the envelope, so history is handed it rather than importing it. */
    attachGlobals(port: HistoryGlobalsPort): void;
    saveState(): void;
    resetHistory(): void;
    undo(): Promise<void>;
    redo(): Promise<void>;
    suspend(): () => void;
  };
  readonly errorManager: ErrorManager;
  readonly cropManager: CropManager;
  readonly deletionManager: DeletionManager;
  readonly clipboardManager: ClipboardManager;
  readonly groupingManager: GroupingManager;
  destroy(): void;
}
