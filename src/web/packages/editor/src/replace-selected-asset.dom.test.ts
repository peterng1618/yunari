// @vitest-environment jsdom

import { objectAssetReference } from "@yunari/scene-fabric";
import { FabricImage } from "fabric/es";
import { describe, expect, it, vi } from "vitest";
import type { AssetManager } from "./asset-manager/index.js";
import type { EditorInteraction } from "./editor-interaction.js";
import { replaceSelectedAsset } from "./replace-selected-asset.js";

/** The picker is the one part a DOM test cannot operate: its `click` is
 *  captured so the chosen file can be handed to the same `change` the browser
 *  fires. */
function pick(captured: HTMLInputElement, file: File): void {
  Object.defineProperty(captured, "files", { value: [file] });
  captured.dispatchEvent(new Event("change"));
}

function staged(): {
  readonly manager: AssetManager;
  readonly editor: EditorInteraction;
  readonly object: FabricImage;
  readonly saveState: ReturnType<typeof vi.fn>;
  readonly onChanged: ReturnType<typeof vi.fn>;
  readonly onError: ReturnType<typeof vi.fn>;
} {
  const object = new FabricImage(document.createElement("img"), {
    id: "picture-1",
    left: 40,
    top: 60,
    width: 120,
    height: 80,
    scaleX: 2,
    angle: 15,
  });
  // The reference the action requires; its target id is the one the swap must
  // replace, not mutate.
  (object as unknown as { set: (key: string, value: unknown) => void }).set(
    "yunariAsset",
    { assetId: "old-picture", kind: "image" },
  );

  const remove = vi.fn(() => true);
  const manager = {
    import: vi.fn(async () => ({
      id: "new-picture",
      kind: "image" as const,
      path: "assets/new.png",
      sha256: "",
    })),
    remove,
  } as unknown as AssetManager;
  const replacement = new FabricImage(document.createElement("canvas"));
  const editor = {
    canvas: {
      getActiveObject: () => object,
      requestRenderAll: vi.fn(),
    },
    imageManager: { importImage: vi.fn(async () => ({ image: replacement })) },
    historyManager: { saveState: vi.fn() },
  } as unknown as EditorInteraction;
  const onChanged = vi.fn();
  const onError = vi.fn();

  replaceSelectedAsset({ editor, assets: manager, onChanged, onError });
  return {
    manager,
    editor,
    object,
    saveState: editor.historyManager.saveState as ReturnType<typeof vi.fn>,
    onChanged,
    onError,
  };
}

describe("replace file on the selection", () => {
  it("declares the picked file and re-points the object, keeping its box", async () => {
    const click = vi
      .spyOn(HTMLInputElement.prototype, "click")
      .mockImplementation(function (this: HTMLInputElement) {
        picker = this;
      });
    let picker: HTMLInputElement | undefined;
    try {
      const file = new File(["new"], "new.png", { type: "image/png" });
      const run = staged();
      expect(picker).toBeDefined();

      pick(picker as HTMLInputElement, file);
      // The change handler is async; one turn is enough for the stubbed
      // decode and declaration.
      await Promise.resolve();
      await Promise.resolve();

      expect(objectAssetReference(run.object)).toEqual({
        assetId: "new-picture",
        kind: "image",
      });
      expect(run.object.left).toBe(40);
      expect(run.object.top).toBe(60);
      expect(run.object.scaleX).toBe(2);
      expect(run.object.angle).toBe(15);
      expect(run.object.width).toBe(120);
      expect(run.object.height).toBe(80);
      expect(run.saveState).toHaveBeenCalledTimes(1);
      expect(run.onChanged).toHaveBeenCalledTimes(1);
      expect(run.onError).not.toHaveBeenCalled();
    } finally {
      click.mockRestore();
    }
  });
});
