import type { FabricThemeEnvelopeInput } from "@yunari/renderer-core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AssetManager } from "./asset-manager/index.js";
import { EditorDocument } from "./editor-document.js";
import type { EditorShell } from "./editor-shell.js";
import {
  createBlankFabricTheme,
  createNewFabricTheme,
} from "./new-fabric-theme.js";
import type { ThemeLibraryClient } from "./theme-library-client.js";

/** One PNG's bytes, enough for an import to declare and digest it. */
function pngFile(name = "shot.png"): File {
  return new File([new Uint8Array([1, 2, 3])], name, { type: "image/png" });
}

/**
 * A document whose shell and consumers do nothing: these tests count the
 * notification, not what a subscriber does with it.
 */
function documentWith(
  options: {
    readonly assets?: AssetManager;
    readonly envelope?: FabricThemeEnvelopeInput;
    /** When given, `snapshot` reports the scene from this live list, so a test
     *  can move the canvas's half of the document. */
    readonly sceneObjects?: unknown[];
    readonly libraryClient?: ThemeLibraryClient;
    readonly libraryBase?: string;
  } = {},
): EditorDocument {
  const sceneObjects = options.sceneObjects;
  return new EditorDocument({
    source: {
      shell: {
        snapshot: (value: unknown) =>
          sceneObjects === undefined
            ? value
            : {
                ...(value as object),
                scene: { version: "7.4.0", objects: [...sceneObjects] },
              },
        editor: {
          errorManager: { report: () => {} },
          historyManager: { attachGlobals: () => {} },
          // The cleanup a save asks first walks the canvas for referenced
          // assets, so a fixture without one cannot save at all.
          canvas: { getObjects: () => [...(sceneObjects ?? [])] },
        },
      } as unknown as EditorShell,
      envelope:
        options.envelope ??
        (createNewFabricTheme() as unknown as FabricThemeEnvelopeInput),
      assetManager: options.assets ?? new AssetManager(),
      onNew: async () => {},
      onNewFromStarter: async () => {},
      onSaved: () => {},
      ...(options.libraryClient === undefined
        ? {}
        : { libraryClient: options.libraryClient }),
      ...(options.libraryBase === undefined
        ? {}
        : { libraryBase: options.libraryBase }),
    },
    consumers: {
      runtime: () => ({ setThemeLanguage: () => undefined }),
      selection: () => ({ setLocale: () => undefined }),
    } as never,
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("EditorDocument dirty state", () => {
  it("computes once for two reads with nothing announced between them", () => {
    const document = documentWith();
    const snapshot = vi.spyOn(document, "snapshot");

    expect(document.isDirty()).toBe(false);
    expect(document.isDirty()).toBe(false);

    expect(snapshot).toHaveBeenCalledTimes(1);
  });

  it("sees an edit once its announcement has flushed", async () => {
    const document = documentWith();
    expect(document.isDirty()).toBe(false);

    document.setMetadata({
      ...document.envelope.metadata,
      name: "Renamed",
    });
    await Promise.resolve();

    expect(document.isDirty()).toBe(true);
  });

  it("sees a canvas object:added once its flush has run", async () => {
    // The scene half of the key, through the event the bridge binds: the
    // document's own fields did not move, only the canvas's content.
    const objects: unknown[] = [];
    const document = documentWith({ sceneObjects: objects });
    const handlers = new Map<string, () => void>();
    const canvas = {
      on: (event: string, handler: () => void) => {
        handlers.set(event, handler);
      },
      fire: (event: string) => handlers.get(event)?.(),
    };
    canvas.on("object:added", document.announceChange);
    expect(document.isDirty()).toBe(false);

    objects.push({ type: "Rect", id: "added" });
    canvas.fire("object:added");
    await Promise.resolve();

    expect(document.isDirty()).toBe(true);
  });

  it("reports clean straight after a save, before the flush", async () => {
    // The downloader is the only DOM the save touches; nothing here reads the
    // file it produces.
    vi.stubGlobal("document", {
      createElement: () => ({ click: () => undefined }),
    });
    const document = documentWith({
      envelope: createBlankFabricTheme({
        width: 640,
        height: 360,
      }) as unknown as FabricThemeEnvelopeInput,
    });
    expect(document.isDirty()).toBe(false);
    document.setMetadata({
      ...document.envelope.metadata,
      name: "Renamed",
    });
    await Promise.resolve();
    expect(document.isDirty()).toBe(true);

    // The flush is what would normally move the revision, so removing it is the
    // same task as the baseline move — the case the save has to handle itself.
    vi.spyOn(document, "announceChange").mockImplementation(() => undefined);
    await document.save();

    // The announcement is stubbed out, so this is the same task as the baseline
    // move: the revision has not changed and the memo has to have been cleared
    // by the save rather than by a flush.
    expect(document.isDirty()).toBe(false);
  });

  it("does not keep a clean marker after an import that announces nothing", async () => {
    // The Add pane imports through the manager and never writes the envelope,
    // so nothing schedules a flush: the asset map is the only signal the dirty
    // answer changed.
    const assets = new AssetManager();
    const document = documentWith({ assets });
    expect(document.isDirty()).toBe(false);

    await assets.import(pngFile());

    expect(document.isDirty()).toBe(true);
  });

  it("recomputes the answer after an asset is removed as well as added", async () => {
    const assets = new AssetManager();
    const document = documentWith({ assets });
    await assets.import(pngFile());
    expect(document.isDirty()).toBe(true);

    const declared = assets.declarations[0]!;
    expect(assets.remove(declared.id)).toBe(true);

    // Back to the blank document it was opened as: a memo that only saw the
    // import would still say dirty.
    expect(document.isDirty()).toBe(false);
  });

  it("sees a load that moves only the byte map", () => {
    // The shape the mutation counter exists for: `load` rewrites the bytes and
    // the path set while the declaration list stays empty. A memo keyed on
    // declaration identity sees [] === [] and answers with the old value.
    const assets = new AssetManager();
    const document = documentWith({
      assets,
      envelope: createBlankFabricTheme({
        width: 640,
        height: 360,
      }) as unknown as FabricThemeEnvelopeInput,
    });
    expect(document.isDirty()).toBe(false);

    assets.load({ assets: [] }, { "assets/x.png": new Uint8Array([1]) });

    expect(document.isDirty()).toBe(true);
  });

  it("does not resurrect a removed last asset from the opened envelope", async () => {
    const assets = new AssetManager();
    const declared = await assets.import(pngFile());
    const document = documentWith({
      assets,
      envelope: {
        ...createBlankFabricTheme({ width: 640, height: 360 }),
        // A copy: the envelope is what the document opened from, and the
        // manager's live list is what the removal changes.
        assets: [...assets.declarations],
      } as unknown as FabricThemeEnvelopeInput,
    });
    expect(document.isDirty()).toBe(false);

    expect(assets.remove(declared.id)).toBe(true);

    // The baseline carried the asset, so the removal is a change; and the
    // snapshot describes the manager, not the envelope the document opened from.
    expect(document.isDirty()).toBe(true);
    expect(document.snapshot().assets).toEqual([]);
  });

  it("reports clean straight after a library save moved the baseline", async () => {
    const document = documentWith({
      envelope: createBlankFabricTheme({
        width: 640,
        height: 360,
      }) as unknown as FabricThemeEnvelopeInput,
      libraryClient: {
        save: async () => "stored-1",
      } as unknown as ThemeLibraryClient,
    });
    expect(document.isDirty()).toBe(false);
    document.setMetadata({
      ...document.envelope.metadata,
      name: "Renamed",
    });
    await Promise.resolve();
    expect(document.isDirty()).toBe(true);

    // The library holds its own reference to `announceChange`, so stubbing the
    // instance cannot stop the flush it schedules. Hold the microtask queue
    // instead: the markSaved port's clear is then the only invalidation.
    const queued: (() => void)[] = [];
    vi.stubGlobal("queueMicrotask", (flush: () => void) => {
      queued.push(flush);
    });
    await document.saveLibrary();

    expect(document.isDirty()).toBe(false);
    // The held flush still finds a clean document when it eventually runs.
    for (const flush of queued) flush();
    expect(document.isDirty()).toBe(false);
  });
});

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
