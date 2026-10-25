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

  it("delivers an announcement made during a flush after the current iteration", async () => {
    // The flush clears the schedule flag before it iterates, so an announcement
    // made from a listener is a follow-up pass, never a re-entry into the
    // iteration in progress. A listener that announces on every invocation
    // therefore keeps the follow-up loop going — that would be a bug in the
    // listener, not a bound this owner promises.
    const document = documentWith();
    const second = vi.fn();
    let secondCallsAtAnnounce = -1;
    let announced = false;
    const first = vi.fn(() => {
      if (announced) return;
      announced = true;
      document.announceChange();
      secondCallsAtAnnounce = second.mock.calls.length;
    });
    document.subscribeDocumentChange(first);
    document.subscribeDocumentChange(second);

    document.announceChange();
    await Promise.resolve();
    await Promise.resolve();

    expect(
      secondCallsAtAnnounce,
      "the follow-up pass starts after this iteration, not inside it",
    ).toBe(0);
    expect(first).toHaveBeenCalledTimes(2);
    expect(second).toHaveBeenCalledTimes(2);
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
