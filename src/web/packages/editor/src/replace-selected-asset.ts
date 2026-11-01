import {
  objectAssetReference,
  setObjectAssetReference,
} from "@yunari/scene-fabric";
import { FabricImage } from "fabric/es";
import type {
  AssetManager,
  LocalAssetReference,
} from "./asset-manager/index.js";
import type { EditorInteraction } from "./editor-interaction.js";
import { REPLACE_FILE_ACCEPT } from "./panes/assets/asset-rows.js";
import { uiCopy } from "./ui-copy.js";

/**
 * **Replace file…** on the selection: declares a picked image or SVG and
 * re-points the active object at it.
 *
 * The object survives the swap. `setElement` takes the authored `width` and
 * `height`, so the new file fills the box the old one occupied and every
 * transform the author set — position, angle, scale, flip — is untouched.
 * A new declaration is made rather than the old id's bytes being replaced: a
 * replace is about *this* object, and another object holding the same id must
 * keep its picture. The old declaration is left to the save-time prune.
 */
export interface ReplaceSelectedAssetHost {
  readonly editor: EditorInteraction;
  readonly assets: AssetManager;
  /** Told the declaration list moved, so the file section and the background
   *  column re-resolve. */
  readonly onChanged?: () => void;
  /** Reported to the shell's status line, where every refusal is read. */
  readonly onError?: (message: string) => void;
}

export function replaceSelectedAsset(host: ReplaceSelectedAssetHost): void {
  const object = host.editor.canvas.getActiveObject();
  if (!(object instanceof FabricImage)) return;
  if (objectAssetReference(object) === undefined) return;

  const picker = document.createElement("input");
  picker.type = "file";
  picker.accept = REPLACE_FILE_ACCEPT;
  picker.addEventListener(
    "change",
    () => {
      const file = picker.files?.[0];
      if (file !== undefined) void swap(host, object, file);
    },
    { once: true },
  );
  picker.click();
}

async function swap(
  host: ReplaceSelectedAssetHost,
  object: FabricImage,
  file: File,
): Promise<void> {
  let declared: LocalAssetReference | undefined;
  let applied = false;
  try {
    declared = await host.assets.import(file);
    if (declared.kind !== "image" && declared.kind !== "svg") {
      throw new Error(uiCopy.panels.replaceUnsupported);
    }
    const imported = await host.editor.imageManager.importImage({
      source: file,
      withoutAdding: true,
      withoutSave: true,
    });
    if (imported === null || !(imported.image instanceof FabricImage)) {
      throw new Error(uiCopy.panels.replaceUnsupported);
    }
    object.setElement(imported.image.getElement(), {
      width: object.width,
      height: object.height,
    });
    setObjectAssetReference(object, {
      assetId: declared.id,
      kind: declared.kind,
    });
    applied = true;
    object.setCoords();
    host.editor.canvas.requestRenderAll();
    host.editor.historyManager.saveState();
    host.onChanged?.();
  } catch (error) {
    // A declared file whose pixels or kind cannot replace the object is
    // dropped again. Once the object points at it, removing the declaration
    // would leave the scene naming an asset the document does not hold.
    if (declared !== undefined && !applied) host.assets.remove(declared.id);
    host.onError?.(error instanceof Error ? error.message : String(error));
  }
}
