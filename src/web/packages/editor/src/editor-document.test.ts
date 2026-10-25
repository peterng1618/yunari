import type { FabricThemeEnvelopeInput } from "@yunari/renderer-core";
import { describe, expect, it, vi } from "vitest";
import { AssetManager } from "./asset-manager/index.js";
import { EditorDocument } from "./editor-document.js";
import type { EditorShell } from "./editor-shell.js";
import { createNewFabricTheme } from "./new-fabric-theme.js";

/**
 * A document whose shell and consumers do nothing: these tests count the
 * notification, not what a subscriber does with it.
 */
function documentWith(): EditorDocument {
  return new EditorDocument({
    source: {
      shell: {
        snapshot: (value: unknown) => value,
        editor: {
          errorManager: { report: () => {} },
          historyManager: { attachGlobals: () => {} },
        },
      } as unknown as EditorShell,
      envelope: createNewFabricTheme() as unknown as FabricThemeEnvelopeInput,
      assetManager: new AssetManager(),
      onNew: async () => {},
      onNewFromStarter: async () => {},
      onSaved: () => {},
    },
    consumers: {} as never,
  });
}

describe("EditorDocument change notification", () => {
  it("notifies once for fifty synchronous announcements, after the task", async () => {
    // A paste, a delete of a selection and a revive's remove-then-add storm all
    // announce several times in one task. Each announcement used to run every
    // subscriber, so the bridge recomputed the document, the dirty marker and
    // the layer tree once per event.
    const document = documentWith();
    const heard = vi.fn();
    document.subscribeDocumentChange(heard);

    for (let index = 0; index < 50; index += 1) document.announceChange();
    expect(
      heard,
      "the batch is still open in this task",
    ).not.toHaveBeenCalled();

    await Promise.resolve();
    expect(heard).toHaveBeenCalledTimes(1);
    document.destroy();
  });

  it("notifies again for an announcement made after the batch flushed", async () => {
    const document = documentWith();
    const heard = vi.fn();
    document.subscribeDocumentChange(heard);

    document.announceChange();
    await Promise.resolve();
    document.announceChange();
    await Promise.resolve();

    expect(heard).toHaveBeenCalledTimes(2);
    document.destroy();
  });

  it("does not recurse without bound when a listener announces from the flush", async () => {
    // A listener reacting to the notification by touching the document is a
    // second batch, not a second notification of the same one. The flag is
    // cleared before the listeners run, so this lands as one extra pass; the
    // listener announces only once, which is what stops it there.
    const document = documentWith();
    let announced = false;
    const heard = vi.fn(() => {
      if (announced) return;
      announced = true;
      document.announceChange();
    });
    document.subscribeDocumentChange(heard);

    document.announceChange();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(heard).toHaveBeenCalledTimes(2);
    document.destroy();
  });

  it("does not call a listener removed in the same task as the announcement", async () => {
    const document = documentWith();
    const heard = vi.fn();
    const unsubscribe = document.subscribeDocumentChange(heard);

    document.announceChange();
    unsubscribe();
    await Promise.resolve();

    expect(heard).not.toHaveBeenCalled();
    document.destroy();
  });
});
