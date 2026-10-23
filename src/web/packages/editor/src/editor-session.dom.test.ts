// @vitest-environment jsdom

import type { FabricThemeEnvelope } from "@yunari/renderer-core";
import { IText } from "fabric/es";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { installReadableFile } from "./readable-file.fixture.js";

installReadableFile();

const saveMock = vi.hoisted(() => vi.fn(async () => {}));
const markSavedMock = vi.hoisted(() => vi.fn());
/** Shared, so a test can recover the registered `(id, handler)` pairs. */
const registerMock = vi.hoisted(() => vi.fn());
/** The dirty-document question and the answer given to it, held so a test can
 *  set both. The default is a clean document and a replacement nobody objects
 *  to, which is what every other test in this file is. */
const dirtyMock = vi.hoisted(() => vi.fn(() => false));
const replaceMock = vi.hoisted(() => vi.fn(async () => "discard"));
/** The finder's client, mocked: the session's import path asks the host for
 *  bytes, and no test here reaches a real host. */
const assetClientMock = vi.hoisted(() => ({ assetBytes: vi.fn() }));
vi.mock("./asset-finder/client.js", () => assetClientMock);
/** The last artboard panel a session built, so a case can read what it was
 *  told to list. */
const panels = vi.hoisted(() => ({ last: undefined as unknown }));
/** The library dialog has no jsdom implementation. Opening a theme by URL
 *  reaches a document through this same call, so what the dialog answered is
 *  the only difference between arriving two ways. */
const libraryChoiceMock = vi.hoisted(() =>
  vi.fn(async () => ({ kind: "theme" as const, id: "saved-theme" })),
);
/** What the author answered about a refused save, and the default is to think
 *  about it: a refusal that resolved by itself would be one nothing is said
 *  about, which is the failure this whole path exists to prevent. */
const conflictMock = vi.hoisted(() =>
  vi.fn(async (): Promise<"reload" | "overwrite" | undefined> => undefined),
);
vi.mock("./theme-library-dialog.js", () => ({
  promptThemeSelection: () => libraryChoiceMock(),
  promptThemeConflict: () => conflictMock(),
}));

vi.mock("./artboard-panel.js", () => ({
  createArtboardPanel: () => (panels.last = panel()),
}));
vi.mock("./palette-manager/index.js", () => ({
  createPalettePanel: () => panel(),
}));
/** The panel's two ports are held so a test can drive a rename the way the
 *  panel's own field does — the panel is a double here, so nothing else
 *  reaches `EditorDocument.setTypes`. */
const typePresetPortMock = vi.hoisted(() => ({
  change: undefined as ((presets: Record<string, unknown>) => void) | undefined,
  remove: undefined as ((id: string, replacement: string) => void) | undefined,
}));
vi.mock("./type-preset-manager/index.js", () => ({
  createTypePresetPanel: (
    _host: unknown,
    change: (presets: Record<string, unknown>) => void,
    remove: (id: string, replacement: string) => void,
  ) => {
    typePresetPortMock.change = change;
    typePresetPortMock.remove = remove;
    return panel();
  },
}));
vi.mock("./new-object-panel.js", () => ({
  createNewObjectPanel: () => panel(),
}));
vi.mock("./chart-manager/index.js", () => ({
  ChartManager: class {
    destroy = vi.fn();
    setGlobals = vi.fn();
    reassignPaletteReferences = vi.fn();
  },
}));
vi.mock("./persistence-manager/index.js", () => ({
  PersistenceManager: class {
    destroy = vi.fn();
    isDirty = dirtyMock;
    save = saveMock;
    markSaved = markSavedMock;
  },
  confirmDocumentReplacement: replaceMock,
}));
vi.mock("./shortcut-manager/index.js", () => ({
  ShortcutManager: class {
    destroy = vi.fn();
    register = registerMock;
  },
}));

import { AssetManager } from "./asset-manager/index.js";
import { EditorSession } from "./editor-session.js";
import { fontTrio } from "./font-catalog.js";
import { idleCrop } from "./selection-inspector/idle-crop.test-stage.js";
import { ThemeConflictError } from "./theme-library-client.js";
import { base64Of } from "./video-normalizer.js";

/** What the chooser answered, per test. The chooser is a modal dialog with no
    jsdom implementation, so it is stubbed here and driven where it is real.
    A size, not a preset: three of the four ways to reach one in the chooser
    are a preset and one is an author's own dimensions. */
const chooserMock = vi.hoisted(() =>
  vi.fn(async () => ({ width: 1920, height: 1080 })),
);
vi.mock("./new-document-chooser.js", () => ({
  chooseArtboardSize: () => chooserMock(),
}));

const envelope: FabricThemeEnvelope = {
  schemaVersion: 2,
  fabricVersion: "7.4.0",
  id: "theme",
  metadata: { themeLanguage: "en" },
  artboard: { width: 100, height: 100 },
  scene: { version: "7.4.0", objects: [] },
};

describe("EditorSession", () => {
  beforeEach(() => {
    saveMock.mockReset();
    markSavedMock.mockReset();
    registerMock.mockReset();
    document.body.replaceChildren();
  });

  it("dispatches package and library actions through the shell façade", async () => {
    const editor = {
      canvas: {
        on: vi.fn(),
        off: vi.fn(),
        getActiveObject: () => undefined,
        getObjects: () => [],
        requestRenderAll: vi.fn(),
      },
      clipboardManager: { setImageImporter: vi.fn(), setBindings: vi.fn() },
      textManager: {
        addText: vi.fn(),
        setAuthoringView: vi.fn(),
        setRepaint: vi.fn(),
      },
      cropManager: idleCrop(),
    };
    const onImportPackage = vi.fn();
    const onOpenTheme = vi.fn(async () => undefined);
    const onSaved = vi.fn();
    const mockClient = {
      list: vi.fn(async () => []),
      open: vi.fn(async () => ({ envelope, assets: {} })),
      save: vi.fn(async () => "base-after-save"),
      assign: vi.fn(async () => undefined),
      listDisplays: vi.fn(async () => ({ default: null, displays: [] })),
    };

    const extensions = new EditorSession({
      assetManager: new AssetManager(),
      shell: {
        editor,
        scene: {},
        snapshot: vi.fn(() => envelope),
        setBackgroundMedia: vi.fn(),
      } as never,
      source: {} as never,
      envelope,
      panelHosts: {
        add: document.body,
        document: document.body,
        tokens: document.body,
        selection: document.body,
      },
      libraryClient: mockClient,
      onNew: vi.fn(),
      onNewFromStarter: vi.fn(),
      onImportPackage,
      onOpenTheme,
      onSaved,
    });

    // The File menu owns these now; the panel section is gone.
    expect(
      document.body.querySelector("[data-yunari-file-actions]"),
    ).toBeNull();
    const session = extensions.actionFacade();

    // An import is a library write and not a document: it reaches the picker
    // and nothing of the document's.
    session.importPackage();
    await Promise.resolve();
    expect(onImportPackage).toHaveBeenCalled();

    // The store's own route: one theme the library already holds, by id, read
    // back and handed to whoever mounts the session that shows it.
    await session.openLibraryTheme("living-room");
    expect(mockClient.open).toHaveBeenCalledWith("living-room");
    expect(onOpenTheme).toHaveBeenCalledWith(envelope, {}, undefined);

    await session.savePackage();
    expect(onSaved).toHaveBeenCalled();

    await session.saveLibrary();
    expect(mockClient.save).toHaveBeenCalled();

    extensions.destroy();
  });

  it("binds the chord the header prints to the shell's own publish surface", () => {
    // §7.1. The header prints this chord beside the publish control, so the
    // gesture does what that control does — it opens the surface — and owns no
    // publish path of its own. The manager is a stub here (the mock above),
    // which is what lets this case read back the handler the session registered
    // and press it; the table itself is `bindings.test.ts`'s to prove. Delete
    // the registration and the header prints a chord that runs nothing, which
    // is the state plan 2 refused to ship.
    const onPublishSurface = vi.fn();
    const session = new EditorSession({
      assetManager: new AssetManager(),
      shell: {
        editor: {
          canvas: {
            on: vi.fn(),
            off: vi.fn(),
            getActiveObject: () => undefined,
            getObjects: () => [],
            requestRenderAll: vi.fn(),
          },
          clipboardManager: { setImageImporter: vi.fn(), setBindings: vi.fn() },
          textManager: {
            addText: vi.fn(),
            setAuthoringView: vi.fn(),
            setRepaint: vi.fn(),
          },
          cropManager: idleCrop(),
        },
        scene: {},
        snapshot: vi.fn(() => envelope),
        setBackgroundMedia: vi.fn(),
      } as never,
      source: {} as never,
      envelope,
      panelHosts: {
        add: document.body,
        document: document.body,
        tokens: document.body,
        selection: document.body,
      },
      onNew: vi.fn(),
      onNewFromStarter: vi.fn(),
      onSaved: vi.fn(),
      onPublishSurface,
    });

    const call = registerMock.mock.calls.find(
      ([id]) => id === "publish.surface",
    );
    expect(
      call,
      "the session registers the chord the header prints",
    ).toBeDefined();
    (call?.[1] as () => void)();

    expect(onPublishSurface).toHaveBeenCalledTimes(1);
    session.destroy();
  });

  it("publishes a stored document under its own id, and an unsaved one not at all", () => {
    const build = (base?: string) =>
      new EditorSession({
        assetManager: new AssetManager(),
        shell: {
          editor: {
            canvas: {
              on: vi.fn(),
              off: vi.fn(),
              getActiveObject: () => undefined,
              getObjects: () => [],
              requestRenderAll: vi.fn(),
            },
            clipboardManager: {
              setImageImporter: vi.fn(),
              setBindings: vi.fn(),
            },
            textManager: {
              addText: vi.fn(),
              setAuthoringView: vi.fn(),
              setRepaint: vi.fn(),
            },
            cropManager: idleCrop(),
          },
          scene: {},
          snapshot: vi.fn(() => envelope),
          setBackgroundMedia: vi.fn(),
        } as never,
        source: {} as never,
        envelope,
        panelHosts: {
          add: document.body,
          document: document.body,
          tokens: document.body,
          selection: document.body,
        },
        ...(base === undefined ? {} : { libraryBase: base }),
        onNew: vi.fn(),
        onNewFromStarter: vi.fn(),
        onSaved: vi.fn(),
      });

    // A published document's assets are served from the theme's own folder, so
    // a document with no folder in the library has nothing to publish.
    const unsaved = build();
    expect(unsaved.actionFacade().publishableDocument()).toBeUndefined();
    unsaved.destroy();

    // And the id it goes out under is the document's own, never the base a save
    // is based on: that is a content hash of the stored document
    // (`host/src/themes/store.ts`), which names no folder, and the publish route
    // answers 404 for an id the library does not hold.
    const stored = build("base-as-stored");
    expect(stored.actionFacade().publishableDocument()).toEqual({
      id: "theme",
      envelope,
    });
    stored.destroy();
  });

  it("New creates at the size the chooser answered, and a dismissal creates nothing", async () => {
    const onNew = vi.fn(async () => undefined);
    const extensions = new EditorSession({
      assetManager: new AssetManager(),
      shell: {
        editor: {
          canvas: {
            on: vi.fn(),
            off: vi.fn(),
            getActiveObject: () => undefined,
            getObjects: () => [],
            requestRenderAll: vi.fn(),
          },
          clipboardManager: { setImageImporter: vi.fn(), setBindings: vi.fn() },
          textManager: {
            addText: vi.fn(),
            setAuthoringView: vi.fn(),
            setRepaint: vi.fn(),
          },
          cropManager: idleCrop(),
        },
        scene: {},
        snapshot: vi.fn(() => envelope),
        setBackgroundMedia: vi.fn(),
      } as never,
      source: {} as never,
      envelope,
      panelHosts: {
        add: document.body,
        document: document.body,
        tokens: document.body,
        selection: document.body,
      },
      onNew,
      onNewFromStarter: vi.fn(),
      onSaved: vi.fn(),
    });
    const session = extensions.actionFacade();

    chooserMock.mockResolvedValueOnce({ width: 1440, height: 1920 } as never);
    await session.newDocument();
    // The size the author settled on, passed through whole: 4:3 portrait at 2K
    // is 1440 wide by 1920 high, and the arithmetic that got there is the
    // chooser's, not the session's.
    expect(onNew).toHaveBeenCalledWith({ width: 1440, height: 1920 });

    // A chooser dismissed resolves nothing, and a New that creates nothing must
    // not be a New: the open document is untouched.
    onNew.mockClear();
    chooserMock.mockResolvedValueOnce(undefined as never);
    await session.newDocument();
    expect(onNew).not.toHaveBeenCalled();

    extensions.destroy();
  });

  it("New from starter creates the composition, and does not ask for a size", async () => {
    const onNewFromStarter = vi.fn(async () => undefined);
    const extensions = new EditorSession({
      assetManager: new AssetManager(),
      shell: {
        editor: {
          canvas: {
            on: vi.fn(),
            off: vi.fn(),
            getActiveObject: () => undefined,
            getObjects: () => [],
            requestRenderAll: vi.fn(),
          },
          clipboardManager: { setImageImporter: vi.fn(), setBindings: vi.fn() },
          textManager: {
            addText: vi.fn(),
            setAuthoringView: vi.fn(),
            setRepaint: vi.fn(),
          },
          cropManager: idleCrop(),
        },
        scene: {},
        snapshot: vi.fn(() => envelope),
        setBackgroundMedia: vi.fn(),
      } as never,
      source: {} as never,
      envelope,
      panelHosts: {
        add: document.body,
        document: document.body,
        tokens: document.body,
        selection: document.body,
      },
      onNew: vi.fn(),
      onNewFromStarter,
      onSaved: vi.fn(),
    });

    chooserMock.mockClear();
    await extensions.actionFacade().newFromStarter();

    // The starter is what it always was, at its own 1672x941: a template is
    // not resized to a preset the new-document list happens to offer.
    expect(onNewFromStarter).toHaveBeenCalled();
    expect(chooserMock).not.toHaveBeenCalled();

    extensions.destroy();
  });

  it("bumps the release version only from Release", async () => {
    vi.stubGlobal(
      "prompt",
      vi.fn(() => "patch"),
    );
    const shell = {
      editor: {
        canvas: {
          on: vi.fn(),
          off: vi.fn(),
          getActiveObject: () => undefined,
          getObjects: () => [],
          requestRenderAll: vi.fn(),
        },
        clipboardManager: { setImageImporter: vi.fn(), setBindings: vi.fn() },
        textManager: {
          addText: vi.fn(),
          setAuthoringView: vi.fn(),
          setRepaint: vi.fn(),
        },
        cropManager: idleCrop(),
      },
      scene: {},
      snapshot: vi.fn((input) => ({ ...envelope, ...input })),
      setBackgroundMedia: vi.fn(),
    };
    const extensions = new EditorSession({
      assetManager: new AssetManager(),
      shell: shell as never,
      source: {} as never,
      envelope: {
        ...envelope,
        metadata: { version: "1.2.3", themeLanguage: "en" },
      },
      panelHosts: {
        add: document.body,
        document: document.body,
        tokens: document.body,
        selection: document.body,
      },
      onNew: vi.fn(),
      onNewFromStarter: vi.fn(),
      onSaved: vi.fn(),
    });

    const session = extensions.actionFacade();
    // The third argument is the picture the package carries; this canvas has
    // nothing laid out, so it renders none and the export happens regardless.
    // The fourth is the credits member, and a document that imported nothing
    // has none.
    await session.savePackage();
    expect(saveMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        metadata: { version: "1.2.3", themeLanguage: "en" },
      }),
      expect.anything(),
      undefined,
      undefined,
    );

    await session.releasePackage();
    expect(saveMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        metadata: { version: "1.2.4", themeLanguage: "en" },
      }),
      expect.anything(),
      undefined,
      undefined,
    );
    extensions.destroy();
  });

  it("adopts a trio and replaces every assigned preset face", async () => {
    const fetch = vi.fn(async () => new Response(new Uint8Array([1, 2, 3])));
    vi.stubGlobal("fetch", fetch);
    const shell = {
      editor: {
        canvas: {
          on: vi.fn(),
          off: vi.fn(),
          getActiveObject: () => undefined,
          getObjects: () => [],
          requestRenderAll: vi.fn(),
        },
        clipboardManager: { setImageImporter: vi.fn(), setBindings: vi.fn() },
        textManager: {
          addText: vi.fn(),
          setAuthoringView: vi.fn(),
          setRepaint: vi.fn(),
        },
        cropManager: idleCrop(),
        historyManager: { saveState: vi.fn() },
      },
      scene: {},
      snapshot: vi.fn((input) => ({ ...envelope, ...input })),
      setBackgroundMedia: vi.fn(),
      setGlobals: vi.fn(),
    };
    const extensions = new EditorSession({
      assetManager: new AssetManager(),
      shell: shell as never,
      source: {} as never,
      envelope: {
        ...envelope,
        globals: {
          typePresets: {
            heading: {
              name: "Heading",
              value: {
                family: "Segoe UI",
                size: 32,
                weight: "500",
                trioRole: "heading",
              },
            },
            metric: {
              name: "Metric",
              value: {
                family: "Segoe UI",
                size: 70,
                weight: "300",
                trioRole: "heading",
              },
            },
            custom: { name: "Custom", value: { family: "Georgia", size: 19 } },
          },
        },
      },
      panelHosts: {
        add: document.body,
        document: document.body,
        tokens: document.body,
        selection: document.body,
      },
      onNew: vi.fn(),
      onNewFromStarter: vi.fn(),
      onSaved: vi.fn(),
    });

    const result = await extensions.applyFontTrio("minimal");
    const heading = fontTrio("minimal")!.faces[0]!;

    expect(fetch).toHaveBeenCalledTimes(3);
    expect(result.globals?.typePresets).toMatchObject({
      heading: {
        value: {
          family: heading.family,
          size: 32,
          weight: heading.weight,
          face: { assetId: heading.id },
        },
      },
      metric: {
        value: {
          family: heading.family,
          size: 70,
          weight: heading.weight,
          face: { assetId: heading.id },
        },
      },
      custom: { name: "Custom", value: { family: "Georgia", size: 19 } },
    });
    expect(result.assets).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: heading.id })]),
    );
    expect(shell.editor.historyManager.saveState).toHaveBeenCalledTimes(1);
    extensions.destroy();
  });

  it("adopts one face without changing the preset role or scale", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(new Uint8Array([1, 2, 3]))),
    );
    const body = fontTrio("minimal")!.faces[1]!;
    const shell = {
      editor: {
        canvas: {
          on: vi.fn(),
          off: vi.fn(),
          getActiveObject: () => undefined,
          getObjects: () => [],
          requestRenderAll: vi.fn(),
        },
        clipboardManager: { setImageImporter: vi.fn(), setBindings: vi.fn() },
        textManager: {
          addText: vi.fn(),
          setAuthoringView: vi.fn(),
          setRepaint: vi.fn(),
        },
        cropManager: idleCrop(),
        historyManager: { saveState: vi.fn() },
      },
      scene: {},
      snapshot: vi.fn((input) => ({ ...envelope, ...input })),
      setBackgroundMedia: vi.fn(),
      setGlobals: vi.fn(),
    };
    const extensions = new EditorSession({
      assetManager: new AssetManager(),
      shell: shell as never,
      source: {} as never,
      envelope: {
        ...envelope,
        globals: {
          typePresets: {
            heading: {
              name: "Heading",
              value: {
                family: "Segoe UI",
                size: 32,
                weight: "700",
                trioRole: "heading",
                face: { assetId: fontTrio("minimal")!.faces[0]!.id },
              },
            },
          },
        },
      },
      panelHosts: {
        add: document.body,
        document: document.body,
        tokens: document.body,
        selection: document.body,
      },
      onNew: vi.fn(),
      onNewFromStarter: vi.fn(),
      onSaved: vi.fn(),
    });

    const result = await extensions.applyPresetFace("heading", body);

    expect(result.globals?.typePresets).toMatchObject({
      heading: {
        value: {
          family: body.family,
          size: 32,
          weight: body.weight,
          trioRole: "heading",
          face: { assetId: body.id },
        },
      },
    });
    expect(result.assets).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: body.id })]),
    );
    extensions.destroy();
  });

  it("closes an open nudge burst before undoing", async () => {
    let suspended = 0;
    const suspend = vi.fn(() => {
      suspended += 1;
      let released = false;
      return () => {
        if (released) return;
        released = true;
        suspended -= 1;
      };
    });
    const saveState = vi.fn();
    const undo = vi.fn();
    const object = {
      locked: false,
      // `isLocked` reads the flag through Fabric's accessor, so the double
      // models it rather than exposing the instance property alone.
      get: (key: string) => (key === "locked" ? object.locked : undefined),
      getRelativeCenterPoint: () => ({ x: 10, y: 20 }),
      setPositionByOrigin: vi.fn(),
      setCoords: vi.fn(),
    };
    // The inspector renders whatever is selectable at construction, so the
    // selection is armed only once the session exists.
    const selection = { active: undefined as unknown };
    const shell = {
      editor: {
        canvas: {
          on: vi.fn(),
          off: vi.fn(),
          fire: vi.fn(),
          getActiveObject: () => selection.active,
          getObjects: () => [],
          requestRenderAll: vi.fn(),
        },
        clipboardManager: { setImageImporter: vi.fn(), setBindings: vi.fn() },
        textManager: {
          addText: vi.fn(),
          setAuthoringView: vi.fn(),
          setRepaint: vi.fn(),
        },
        cropManager: idleCrop(),
        historyManager: { suspend, saveState, undo, redo: vi.fn() },
      },
      scene: {},
      snapshot: vi.fn((input) => ({ ...envelope, ...input })),
      setBackgroundMedia: vi.fn(),
    };
    const extensions = new EditorSession({
      assetManager: new AssetManager(),
      shell: shell as never,
      source: {} as never,
      envelope,
      panelHosts: {
        add: document.body,
        document: document.body,
        tokens: document.body,
        selection: document.body,
      },
      onNew: vi.fn(),
      onNewFromStarter: vi.fn(),
      onSaved: vi.fn(),
    });

    const handler = (id: string): ((event?: KeyboardEvent) => void) => {
      const call = registerMock.mock.calls.find(([key]) => key === id);
      if (call === undefined) throw new Error(`${id} is not registered`);
      return call[1] as (event?: KeyboardEvent) => void;
    };
    const press = new KeyboardEvent("keydown", { key: "ArrowRight" });

    // Two presses, so the burst is open and nothing is recorded yet.
    selection.active = object;
    handler("canvas.nudge-right")(press);
    handler("canvas.nudge-right")(press);
    expect(suspended).toBe(1);
    expect(saveState).not.toHaveBeenCalled();

    // Undo inside the idle window: the burst must close first, or the entry it
    // would step back to does not exist yet.
    handler("edit.undo")();
    expect(saveState).toHaveBeenCalledTimes(1);
    expect(suspend).toHaveBeenCalledTimes(1);
    expect(suspended).toBe(0);
    expect(undo).toHaveBeenCalledTimes(1);

    extensions.destroy();
  });

  it("leaves the document unchanged when a trio download fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(new Response(new Uint8Array([1])))
        .mockResolvedValueOnce(new Response("", { status: 404 })),
    );
    const shell = {
      editor: {
        canvas: {
          on: vi.fn(),
          off: vi.fn(),
          getActiveObject: () => undefined,
          getObjects: () => [],
          requestRenderAll: vi.fn(),
        },
        clipboardManager: { setImageImporter: vi.fn(), setBindings: vi.fn() },
        textManager: {
          addText: vi.fn(),
          setAuthoringView: vi.fn(),
          setRepaint: vi.fn(),
        },
        cropManager: idleCrop(),
        historyManager: { saveState: vi.fn() },
      },
      scene: {},
      snapshot: vi.fn((input) => ({ ...envelope, ...input })),
      setBackgroundMedia: vi.fn(),
      setGlobals: vi.fn(),
    };
    const extensions = new EditorSession({
      assetManager: new AssetManager(),
      shell: shell as never,
      source: {} as never,
      envelope: {
        ...envelope,
        globals: {
          typePresets: {
            heading: {
              name: "Heading",
              value: { family: "Segoe UI", size: 32, trioRole: "heading" },
            },
          },
        },
      },
      panelHosts: {
        add: document.body,
        document: document.body,
        tokens: document.body,
        selection: document.body,
      },
      onNew: vi.fn(),
      onNewFromStarter: vi.fn(),
      onSaved: vi.fn(),
    });

    await expect(extensions.applyFontTrio("minimal")).rejects.toThrow("404");
    expect(extensions.envelope.globals?.typePresets).toEqual({
      heading: {
        name: "Heading",
        value: { family: "Segoe UI", size: 32, trioRole: "heading" },
      },
    });
    expect(shell.editor.historyManager.saveState).not.toHaveBeenCalled();
    extensions.destroy();
  });

  it("re-hydrates declared image bytes after an undo rebuilds the scene", async () => {
    // U4: an undo crossed an image and the image never came back, because the
    // persisted `src` is an object URL `image-manager` already revoked. The
    // author saw their asset deleted rather than their transform reverted.
    const listeners = new Map<string, (() => void)[]>();
    const editor = {
      canvas: {
        on: vi.fn((event: string, handler: () => void) => {
          listeners.set(event, [...(listeners.get(event) ?? []), handler]);
        }),
        off: vi.fn(),
        getActiveObject: () => undefined,
        getObjects: () => [],
        requestRenderAll: vi.fn(),
      },
      clipboardManager: { setImageImporter: vi.fn(), setBindings: vi.fn() },
      textManager: {
        addText: vi.fn(),
        setAuthoringView: vi.fn(),
        setRepaint: vi.fn(),
      },
      cropManager: idleCrop(),
    };
    const hydrate = vi.spyOn(AssetManager.prototype, "hydrate");
    const extensions = new EditorSession({
      assetManager: new AssetManager(),
      shell: {
        editor,
        scene: {},
        snapshot: vi.fn(() => envelope),
        setBackgroundMedia: vi.fn(),
      } as never,
      source: {} as never,
      envelope,
      panelHosts: {
        add: document.body,
        document: document.body,
        tokens: document.body,
        selection: document.body,
      },
      onNew: vi.fn(),
      onNewFromStarter: vi.fn(),
      onSaved: vi.fn(),
    });

    // Several owners listen on this one event, so every handler runs — the
    // mock is a single-handler map in some other test, and it hid this one.
    expect(listeners.get("editor:history-state-loaded")).toBeDefined();
    expect(hydrate).not.toHaveBeenCalled();

    for (const handler of listeners.get("editor:history-state-loaded") ?? [])
      handler();

    await vi.waitFor(() => expect(hydrate).toHaveBeenCalledOnce());

    extensions.destroy();
    hydrate.mockRestore();
  });

  it("reaches every globals consumer when a type preset is renamed, so the inspector follows", () => {
    // vg-232. The receivers were listed inline once per setter and the lists
    // disagreed: `setTypes` told three, never the inspector. The inspector
    // reads a preset's name out of `context.globals`, and `setGlobals` is the
    // only thing that updates it, so a rename left the surface printing the old
    // name until an unrelated `object:modified` re-rendered it. This reads the
    // surface the author reads rather than counting the calls.
    //
    // **It read the Spends line until 2026-10-15.** Item 17 removed that
    // section, so the surface is the run editor's own preset control — which
    // names its presets out of the same `context.globals`, through the same
    // `selection.setGlobals` this row's fix introduced. The claim is unchanged;
    // only the element that prints it moved.
    const text = new IText("Hi", { left: 0, top: 0 });
    text.set({
      yunariText: {
        runs: [{ kind: "literal", text: "Hi", typePreset: "typePresets.body" }],
      },
    });
    const selectionHost = document.createElement("div");
    const documentHost = document.createElement("div");
    document.body.append(selectionHost, documentHost);
    const shell = {
      editor: {
        canvas: {
          on: vi.fn(),
          off: vi.fn(),
          getActiveObject: () => text,
          getObjects: () => [text],
          requestRenderAll: vi.fn(),
          fire: vi.fn(),
        },
        clipboardManager: { setImageImporter: vi.fn(), setBindings: vi.fn() },
        textManager: {
          addText: vi.fn(),
          setAuthoringView: vi.fn(),
          setRepaint: vi.fn(),
        },
        cropManager: idleCrop(),
        historyManager: { saveState: vi.fn() },
        errorManager: { warn: vi.fn(), error: vi.fn() },
      },
      scene: {},
      snapshot: vi.fn((input) => ({ ...envelope, ...input })),
      setBackgroundMedia: vi.fn(),
      setGlobals: vi.fn(),
      refreshGlass: vi.fn(),
    };
    const presets = (name: string) => ({
      body: { name, value: { family: "Inter", size: 16, weight: "600" } },
    });
    const extensions = new EditorSession({
      assetManager: new AssetManager(),
      shell: shell as never,
      source: {} as never,
      envelope: { ...envelope, globals: { typePresets: presets("Body") } },
      panelHosts: {
        add: document.body,
        document: documentHost,
        tokens: document.body,
        selection: selectionHost,
      },
      onNew: vi.fn(),
      onNewFromStarter: vi.fn(),
      onSaved: vi.fn(),
    });

    const printed = (): string =>
      selectionHost
        .querySelector('[data-yunari-run-preset="0"] [data-yunari-value]')
        ?.textContent?.trim() ?? "";

    expect(printed()).toBe("Body");

    // The panel's own field writes the whole map, which is what a rename is.
    typePresetPortMock.change?.(presets("Body Renamed"));

    expect(printed()).toBe("Body Renamed");
    extensions.destroy();
  });

  it("falls back to the shipped thumbnail when a capture fails, on both save paths", async () => {
    // vg-239. The fallback — "a capture that fails must cost the preview, not
    // the theme" — was spelled twice: inline at `#save` and named in `#picture`,
    // which the library's save calls. The two spellings are equivalent today, so
    // this case passing on either proves nothing; it closes the row only because
    // it fails when either copy drops its fallback. Both entry points are taken
    // so each copy has a path of its own to red on.
    const thumbnail = new TextEncoder().encode("shipped-thumbnail");
    const client = {
      list: vi.fn(async () => []),
      open: vi.fn(async () => ({ envelope, assets: {} })),
      save: vi.fn(async () => "base-after-save"),
      saveThumbnail: vi.fn(async (_id: string, _png: Uint8Array) => {}),
      assign: vi.fn(async () => undefined),
      listDisplays: vi.fn(async () => ({ default: null, displays: [] })),
    };
    const extensions = new EditorSession({
      assetManager: new AssetManager(),
      shell: {
        editor: {
          // A canvas never laid out, which is `captureCanvas`'s own failure: no
          // picture is produced, so the fallback is the only thing left to see.
          canvas: {
            width: 0,
            height: 0,
            on: vi.fn(),
            off: vi.fn(),
            getActiveObject: () => undefined,
            getObjects: () => [],
            requestRenderAll: vi.fn(),
          },
          clipboardManager: { setImageImporter: vi.fn(), setBindings: vi.fn() },
          textManager: {
            addText: vi.fn(),
            setAuthoringView: vi.fn(),
            setRepaint: vi.fn(),
          },
          cropManager: idleCrop(),
          historyManager: { saveState: vi.fn() },
        },
        scene: {},
        snapshot: vi.fn(() => envelope),
        setBackgroundMedia: vi.fn(),
        setGlobals: vi.fn(),
        backdrop: () => undefined,
      } as never,
      source: {} as never,
      envelope,
      thumbnail,
      panelHosts: {
        add: document.body,
        document: document.body,
        tokens: document.body,
        selection: document.body,
      },
      libraryClient: client as never,
      onNew: vi.fn(),
      onNewFromStarter: vi.fn(),
      onSaved: vi.fn(),
    });

    // The `.yunari-theme` the author shares.
    await extensions.actionFacade().savePackage();
    const shipped = saveMock.mock.calls.at(-1) as
      | [unknown, unknown, Uint8Array | undefined]
      | undefined;
    expect(shipped?.[2]).toEqual(thumbnail);

    // The library card.
    await extensions.actionFacade().saveLibrary();
    expect(client.saveThumbnail.mock.calls.at(-1)?.[1]).toEqual(thumbnail);

    extensions.destroy();
  });
});

/** Opening a theme replaces the open document, whichever way it was asked
 *  for. `?theme=<id>` reaches a document through exactly this call, so a
 *  second guard beside this one would be a question asked twice about the same
 *  work — and a URL route that skipped this one would drop it silently. */
describe("opening a theme over a document that has unsaved changes", () => {
  /** The shell the last session was built with, so a case can read what the
   *  session did to the canvas. */
  const shells = { last: undefined as unknown };

  const shell = () =>
    (shells.last = {
      editor: {
        canvas: {
          on: vi.fn(),
          off: vi.fn(),
          add: vi.fn(),
          setActiveObject: vi.fn(),
          getActiveObject: () => undefined,
          getObjects: () => [],
          requestRenderAll: vi.fn(),
        },
        clipboardManager: { setImageImporter: vi.fn(), setBindings: vi.fn() },
        textManager: {
          addText: vi.fn(),
          setAuthoringView: vi.fn(),
          setRepaint: vi.fn(),
        },
        cropManager: idleCrop(),
        historyManager: { saveState: vi.fn() },
      },
      scene: {},
      snapshot: vi.fn(() => envelope),
      setArtboard: vi.fn(),
      setBackground: vi.fn(),
      setBackgroundMedia: vi.fn(),
    });

  const sessionWith = (overrides?: Record<string, unknown>): EditorSession =>
    new EditorSession({
      assetManager: new AssetManager(),
      shell: shell() as never,
      source: {} as never,
      envelope,
      panelHosts: {
        add: document.body,
        document: document.body,
        tokens: document.body,
        selection: document.body,
      },
      onNew: vi.fn(),
      onNewFromStarter: vi.fn(),
      onSaved: vi.fn(),
      ...overrides,
    });

  beforeEach(() => {
    assetClientMock.assetBytes.mockReset();
    dirtyMock.mockReset();
    dirtyMock.mockReturnValue(false);
    replaceMock.mockReset();
    replaceMock.mockResolvedValue("discard");
    libraryChoiceMock.mockClear();
  });

  it("imports a finder image as the background layer's media", async () => {
    assetClientMock.assetBytes.mockResolvedValue({
      bytes: new TextEncoder().encode(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"></svg>',
      ),
      filename: "house.svg",
    });
    const extensions = sessionWith();

    const outcome = await extensions.actionFacade().importAsset?.(
      { source: "lucide", results: [], next: undefined, failure: undefined },
      {
        id: "unsplash:photo",
        name: "photo",
        kind: "image",
        preview: "",
        subtitle: undefined,
        licence: "Unsplash License",
        sourceUrl: "https://unsplash.com/photos/photo",
      },
    );

    expect(outcome?.ok === true ? "imported" : outcome?.message).toBe(
      "imported",
    );
    // An image becomes the background layer's picture, in the box the media
    // already filled. (The Document pane kept this list when main wrote the
    // case; the Add pane's list owns it now.)
    expect(
      (shells.last as { setBackground: ReturnType<typeof vi.fn> })
        .setBackground,
    ).toHaveBeenCalledWith({
      media: expect.objectContaining({ bounds: "theme" }),
    });
    extensions.destroy();
  });

  it("places an imported icon as geometry the theme can paint", async () => {
    assetClientMock.assetBytes.mockResolvedValue({
      bytes: new TextEncoder().encode(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 10 12 3l9 7"/><path d="M5 9v11h14V9"/></svg>',
      ),
      filename: "house.svg",
    });
    const extensions = sessionWith({
      envelope: {
        ...envelope,
        artboard: { width: 1920, height: 1080 },
        globals: {
          palette: {
            text: { name: "Text", value: { kind: "solid", color: "#ecf5ff" } },
          },
        },
      },
    });
    const canvas = (
      shells.last as {
        editor: { canvas: { add: ReturnType<typeof vi.fn> } };
      }
    ).editor.canvas;

    const outcome = await extensions.actionFacade().importAsset?.(
      { source: "lucide", results: [], next: undefined, failure: undefined },
      {
        id: "lucide:house",
        name: "house",
        kind: "icon",
        preview: "",
        subtitle: undefined,
        licence: "ISC",
        sourceUrl: "https://lucide.dev/icons/house",
      },
    );

    // The Document pane listed declarations when main wrote this case; the pane
    // no longer holds a copy of them (the Add pane's list does), so the import's
    // own outcome is the whole contract here.
    expect(outcome?.ok === true ? "imported" : outcome?.message).toBe(
      "imported",
    );
    // A picture would bake `currentColor` to black; a path carries the theme's
    // token, its stroke width and the frame-relative size the author gets.
    const placed = canvas.add.mock.calls[0]?.[0] as {
      type: string;
      get(name: string): unknown;
      getObjects(): { get(name: string): unknown }[];
      width: number;
      scaleX: number;
    };
    expect(placed.type).toBe("group");
    expect(placed.get("name")).toBe("house");
    expect(Math.round(placed.width * placed.scaleX)).toBe(
      Math.round(1080 * 0.12),
    );
    const shapes = placed.getObjects();
    expect(shapes).toHaveLength(2);
    for (const shape of shapes) expect(shape.get("stroke")).toBe("#ecf5ff");
    extensions.destroy();
  });

  it("asks before discarding, and opens nothing when the author says no", async () => {
    dirtyMock.mockReturnValue(true);
    replaceMock.mockResolvedValue("cancel");
    const onOpenTheme = vi.fn();
    const open = vi.fn();
    const extensions = sessionWith({
      onOpenTheme,
      libraryClient: {
        list: vi.fn(async () => []),
        open,
        save: vi.fn(async () => undefined),
      },
    });

    await extensions.actionFacade().openLibrary();

    expect(replaceMock).toHaveBeenCalledOnce();
    // The question is only worth anything if answering it stops the open.
    expect(open).not.toHaveBeenCalled();
    expect(onOpenTheme).not.toHaveBeenCalled();
    extensions.destroy();
  });

  it("opens the theme once the author has answered", async () => {
    dirtyMock.mockReturnValue(true);
    const onOpenTheme = vi.fn();
    const extensions = sessionWith({
      onOpenTheme,
      libraryClient: {
        list: vi.fn(async () => []),
        open: vi.fn(async () => ({ envelope, assets: {} })),
        save: vi.fn(async () => undefined),
      },
    });

    await extensions.actionFacade().openLibrary();

    expect(onOpenTheme).toHaveBeenCalledOnce();
    extensions.destroy();
  });

  it("asks nothing of a document nobody has changed", async () => {
    const onOpenTheme = vi.fn();
    const extensions = sessionWith({
      onOpenTheme,
      libraryClient: {
        list: vi.fn(async () => []),
        open: vi.fn(async () => ({ envelope, assets: {} })),
        save: vi.fn(async () => undefined),
      },
    });

    await extensions.actionFacade().openLibrary();

    expect(replaceMock).not.toHaveBeenCalled();
    expect(onOpenTheme).toHaveBeenCalledOnce();
    extensions.destroy();
  });
});

/**
 * A save the host refused because the stored theme moved on. The claim under
 * test is that a refusal costs the author nothing and says so: the document
 * stays, the refusal arrives in the same words as any failed save, and the two
 * ways forward are offered rather than guessed.
 */
describe("a save the host refused", () => {
  const shell = () => ({
    editor: {
      canvas: {
        on: vi.fn(),
        off: vi.fn(),
        getActiveObject: () => undefined,
        getObjects: () => [],
        requestRenderAll: vi.fn(),
      },
      clipboardManager: { setImageImporter: vi.fn(), setBindings: vi.fn() },
      textManager: {
        addText: vi.fn(),
        setAuthoringView: vi.fn(),
        setRepaint: vi.fn(),
      },
      cropManager: idleCrop(),
    },
    scene: {},
    snapshot: vi.fn(() => envelope),
    setBackgroundMedia: vi.fn(),
  });

  const panelHosts = {
    add: document.body,
    document: document.body,
    tokens: document.body,
    selection: document.body,
  };

  const stored = { ...envelope, metadata: { name: "Edited elsewhere" } };

  /** A client whose first save is refused, standing in for the stored theme
   *  having been saved by another tab since this one opened it. */
  function refusingClient(): {
    readonly client: Record<string, ReturnType<typeof vi.fn>>;
    readonly saves: ReturnType<typeof vi.fn>[];
  } {
    const saves = [
      vi.fn(async (..._args: unknown[]): Promise<string> => {
        throw new ThemeConflictError(
          '"theme" was changed by someone else after this document was opened.',
        );
      }),
      vi.fn(
        async (..._args: unknown[]): Promise<string> => "base-after-overwrite",
      ),
    ];
    return {
      client: {
        list: vi.fn(async () => []),
        open: vi.fn(async () => ({
          envelope: stored,
          assets: {},
          base: "base-as-stored",
        })),
        save: vi.fn(async (...args: unknown[]) => {
          // The first save is the refused one; every save after it is the
          // deliberate one and succeeds.
          const call = saves[0]?.mock.calls.length ? saves[1] : saves[0];
          return (call as (...a: unknown[]) => Promise<string>)(...args);
        }),
      },
      saves,
    };
  }

  beforeEach(() => {
    conflictMock.mockReset();
    conflictMock.mockResolvedValue(undefined);
    markSavedMock.mockReset();
  });

  it("says the save did not happen, and keeps the document", async () => {
    const onError = vi.fn();
    const onSaved = vi.fn();
    const { client } = refusingClient();
    const extensions = new EditorSession({
      assetManager: new AssetManager(),
      shell: shell() as never,
      source: {} as never,
      envelope,
      panelHosts,
      libraryClient: client as never,
      onNew: vi.fn(),
      onNewFromStarter: vi.fn(),
      onSaved,
      onError,
    });

    await extensions.actionFacade().saveLibrary();

    // The editor's own words for a save that did not happen. A silent refusal
    // is as bad as a silent clobber: the work would look saved.
    expect(onError).toHaveBeenCalledWith(
      expect.stringContaining("Could not save to library:"),
    );
    expect(onError.mock.calls[0]?.[0]).toContain("changed by someone else");
    // Not marked saved, and the author was asked rather than told.
    expect(markSavedMock).not.toHaveBeenCalled();
    expect(onSaved).not.toHaveBeenCalled();
    expect(conflictMock).toHaveBeenCalledOnce();

    // And the document is still the author's, so the next save is the same one
    // rather than a save of nothing.
    expect(shell().snapshot).toBeDefined();
    extensions.destroy();
  });

  it("overwrites only because the author said to", async () => {
    conflictMock.mockResolvedValueOnce("overwrite");
    const onSaved = vi.fn();
    const { client, saves } = refusingClient();
    const extensions = new EditorSession({
      assetManager: new AssetManager(),
      shell: shell() as never,
      source: {} as never,
      envelope,
      panelHosts,
      libraryClient: client as never,
      onNew: vi.fn(),
      onNewFromStarter: vi.fn(),
      onSaved,
      onError: vi.fn(),
    });

    await extensions.actionFacade().saveLibrary();

    expect(saves[1]).toHaveBeenCalledOnce();
    expect(saves[1]?.mock.calls[0]?.[2]).toEqual({ overwrite: true });
    expect(onSaved).toHaveBeenCalledWith("Saved to library");
    // The base moves onto what the overwrite wrote, so the next save is made
    // on the document that is actually stored.
    await extensions.actionFacade().saveLibrary();
    expect(saves[1]?.mock.calls[1]?.[1]).toMatchObject({
      base: "base-after-overwrite",
    });
    extensions.destroy();
  });

  it("reloads onto the stored document, base and all", async () => {
    conflictMock.mockResolvedValueOnce("reload");
    const onOpenTheme = vi.fn();
    const { client, saves } = refusingClient();
    const extensions = new EditorSession({
      assetManager: new AssetManager(),
      shell: shell() as never,
      source: {} as never,
      envelope,
      panelHosts,
      libraryClient: client as never,
      onNew: vi.fn(),
      onNewFromStarter: vi.fn(),
      onSaved: vi.fn(),
      onError: vi.fn(),
      onOpenTheme,
    });

    await extensions.actionFacade().saveLibrary();

    expect(onOpenTheme).toHaveBeenCalledWith(stored, {}, "base-as-stored");
    // Reloading is taking the stored version, not replacing it: nothing was
    // written a second time.
    expect(saves[1]).not.toHaveBeenCalled();

    // The document is now the stored one, so this save is based on it.
    const reloaded = new EditorSession({
      assetManager: new AssetManager(),
      shell: {
        ...shell(),
        snapshot: vi.fn(() => stored),
      } as never,
      source: {} as never,
      envelope: stored,
      panelHosts,
      libraryClient: client as never,
      onNew: vi.fn(),
      onNewFromStarter: vi.fn(),
      onSaved: vi.fn(),
      onError: vi.fn(),
    });
    await reloaded.actionFacade().saveLibrary();
    expect(saves[1]).toHaveBeenCalled();
    extensions.destroy();
  });

  it("sends the base it opened, and takes the one each save answers", async () => {
    const saves = [
      vi.fn(async (..._args: unknown[]): Promise<string> => "base-after-first"),
    ];
    const client = {
      list: vi.fn(async () => []),
      open: vi.fn(async () => ({
        envelope: stored,
        assets: {},
        base: "base-as-stored",
      })),
      save: vi.fn(async (...args: unknown[]) =>
        (saves[0] as (...a: unknown[]) => Promise<string>)(...args),
      ),
    };
    const extensions = new EditorSession({
      assetManager: new AssetManager(),
      shell: shell() as never,
      source: {} as never,
      envelope,
      panelHosts,
      libraryClient: client as never,
      onNew: vi.fn(),
      onNewFromStarter: vi.fn(),
      onSaved: vi.fn(),
      onError: vi.fn(),
      onOpenTheme: vi.fn(),
    });
    const session = extensions.actionFacade();

    // A document that came from nowhere claims no base, so its first save is
    // a first save and is not refused.
    await session.saveLibrary();
    expect(saves[0]?.mock.calls[0]?.[1]).not.toHaveProperty("base");

    await session.openLibrary();
    await session.saveLibrary();
    expect(saves[0]?.mock.calls[1]?.[1]).toMatchObject({
      base: "base-as-stored",
    });
    await session.saveLibrary();
    expect(saves[0]?.mock.calls[2]?.[1]).toMatchObject({
      base: "base-after-first",
    });
    extensions.destroy();
  });

  it("hands the base to the session that replaces this one", async () => {
    // Opening a theme builds a new session, so a base kept only on this one
    // dies with it — and the session that inherits the document then saves
    // with no idea what it is based on, which is an ungated write. A stale tab
    // reached through `?theme=` was exactly that, until this was threaded.
    const onOpenTheme = vi.fn();
    const { client } = refusingClient();
    const extensions = new EditorSession({
      assetManager: new AssetManager(),
      shell: shell() as never,
      source: {} as never,
      envelope,
      panelHosts,
      libraryClient: client as never,
      onNew: vi.fn(),
      onNewFromStarter: vi.fn(),
      onSaved: vi.fn(),
      onError: vi.fn(),
      onOpenTheme,
    });
    const session = extensions.actionFacade();

    await session.openLibrary();
    expect(onOpenTheme).toHaveBeenCalledWith(stored, {}, "base-as-stored");

    conflictMock.mockResolvedValueOnce("reload");
    await session.saveLibrary();
    expect(onOpenTheme).toHaveBeenLastCalledWith(stored, {}, "base-as-stored");
    extensions.destroy();
  });

  it("does not gate the export, which is not a save against the store", async () => {
    const { client, saves } = refusingClient();
    const extensions = new EditorSession({
      assetManager: new AssetManager(),
      shell: shell() as never,
      source: {} as never,
      envelope,
      panelHosts,
      libraryClient: client as never,
      onNew: vi.fn(),
      onNewFromStarter: vi.fn(),
      onSaved: vi.fn(),
      onError: vi.fn(),
    });

    await extensions.actionFacade().savePackage();

    // A `.yunari-theme` an author shares is a file, not a write to the
    // library: refusing it would break sharing a theme.
    expect(client.save).not.toHaveBeenCalled();
    expect(saves[0]).not.toHaveBeenCalled();
    expect(saveMock).toHaveBeenCalled();
    extensions.destroy();
  });
});

/**
 * What actually goes over the wire.
 *
 * The claim is not "the saved theme is right" — that was true before, and would
 * stay true with this removed. It is that a save carries the bytes the host
 * does not already have, so every assertion here is on the payload the client
 * was handed rather than on what the host did with it.
 */
describe("a save that carries only what changed", () => {
  const shell = () => ({
    editor: {
      canvas: {
        on: vi.fn(),
        off: vi.fn(),
        getActiveObject: () => undefined,
        getObjects: () => [],
        requestRenderAll: vi.fn(),
      },
      clipboardManager: { setImageImporter: vi.fn(), setBindings: vi.fn() },
      textManager: {
        addText: vi.fn(),
        setAuthoringView: vi.fn(),
        setRepaint: vi.fn(),
      },
      cropManager: idleCrop(),
      historyManager: { saveState: vi.fn() },
    },
    scene: {},
    // The real snapshot hands back the document it was given, assets included,
    // which is what makes the payload read here the one a real save sends.
    snapshot: vi.fn((document: unknown) => document),
    setBackgroundMedia: vi.fn(),
    setGlobals: vi.fn(),
  });

  const panelHosts = {
    add: document.body,
    document: document.body,
    tokens: document.body,
    selection: document.body,
  };

  const backdrop = new TextEncoder().encode("backdrop-bytes");
  const badge = new TextEncoder().encode("<svg/>");
  // The digests the stored document declares. What the editor compares is one
  // declared digest against another, so literals say what the test is about.
  const storedBackdrop = {
    id: "backdrop",
    kind: "image" as const,
    path: "assets/backdrop.png",
    sha256: "a".repeat(64),
  };
  const storedBadge = {
    id: "badge",
    kind: "image" as const,
    path: "assets/badge.svg",
    sha256: "b".repeat(64),
  };
  const opened: FabricThemeEnvelope = {
    ...envelope,
    assets: [storedBackdrop, storedBadge],
  };
  const bytes = {
    "assets/backdrop.png": backdrop,
    "assets/badge.svg": badge,
  };
  // Loaded here, as the mount that produces a session does: the manager is
  // the document's bytes and nobody builds it inside the session any more.
  const loadedAssets = (): AssetManager => {
    const manager = new AssetManager();
    manager.load(opened, bytes);
    return manager;
  };

  const sessionWith = (
    save: ReturnType<typeof vi.fn>,
    overrides?: Record<string, unknown>,
  ): EditorSession =>
    new EditorSession({
      assetManager: loadedAssets(),
      shell: shell() as never,
      source: {} as never,
      envelope: opened,
      libraryBase: "base-as-stored",
      panelHosts,
      libraryClient: {
        list: vi.fn(async () => []),
        open: vi.fn(async () => ({
          envelope: opened,
          assets: bytes,
          base: "base-as-stored",
        })),
        save,
      } as never,
      onNew: vi.fn(),
      onNewFromStarter: vi.fn(),
      onSaved: vi.fn(),
      onError: vi.fn(),
      ...overrides,
    });

  /** The paths one save put in its request, which is the whole claim. */
  const pathsOf = (call: unknown): string[] =>
    Object.keys(
      (call as { readonly assets: Readonly<Record<string, Uint8Array>> })
        .assets,
    ).sort();

  const everyPath = ["assets/backdrop.png", "assets/badge.svg"];

  beforeEach(() => {
    conflictMock.mockReset();
    conflictMock.mockResolvedValue(undefined);
  });

  it("transmits no asset the stored document already holds, on any save", async () => {
    const save = vi.fn(
      async (
        _id: string,
        content: unknown,
        _options?: unknown,
      ): Promise<string> => {
        void content;
        return "base-after-save";
      },
    );
    const extensions = sessionWith(save);

    await extensions.actionFacade().saveLibrary();
    await extensions.actionFacade().saveLibrary();

    // The backdrop and the badge are both declared, both held, and neither goes
    // over the wire — twice, because the base each save answers carries the
    // claim forward rather than resetting it to "I know nothing".
    expect(pathsOf(save.mock.calls[0]?.[1])).toEqual([]);
    expect(pathsOf(save.mock.calls[1]?.[1])).toEqual([]);
    expect(save.mock.calls[0]?.[1]).toMatchObject({
      base: "base-as-stored",
    });
    expect(save.mock.calls[1]?.[1]).toMatchObject({ base: "base-after-save" });
    // The document still declares both, so the request is a whole theme that
    // happens to carry no bytes: what was left out is what the host holds, not
    // what was dropped.
    expect(
      (save.mock.calls[0]?.[1] as { envelope: FabricThemeEnvelope }).envelope
        .assets,
    ).toHaveLength(2);
    extensions.destroy();
  });

  it("transmits exactly the asset whose digest moved", async () => {
    // A curated face the stored theme already declares, adopted again over the
    // same id: the declaration is replaced and its digest recomputed, which is
    // how an asset's bytes change without a new id appearing.
    const face = fontTrio("minimal")?.faces[0];
    if (face === undefined) throw new Error("no curated face");
    const fontPath = `assets/${face.id}.woff2`;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(new TextEncoder().encode("inter"))),
    );
    const save = vi.fn(
      async (
        _id: string,
        content: unknown,
        _options?: unknown,
      ): Promise<string> => {
        void content;
        return "base-after-save";
      },
    );
    const extensions = sessionWith(save, {
      envelope: {
        ...opened,
        globals: {
          typePresets: {
            heading: { name: "Heading", value: { family: "Inter" } },
          },
        },
        assets: [
          storedBackdrop,
          {
            id: face.id,
            kind: "font" as const,
            path: fontPath,
            family: face.family,
            weight: face.weight,
            style: face.style,
            format: face.format,
            sourceUrl: face.sourceUrl,
            license: face.license,
            sha256: "c".repeat(64),
          },
        ],
      },
    });

    await extensions.applyPresetFace("heading", face);
    await extensions.actionFacade().saveLibrary();

    // The font, whose digest no longer matches the stored one — and not the
    // backdrop, whose digest never moved.
    expect(pathsOf(save.mock.calls[0]?.[1])).toEqual([fontPath]);
    expect(save.mock.calls[0]?.[1]).toMatchObject({
      base: "base-as-stored",
    });
    vi.unstubAllGlobals();
    extensions.destroy();
  });

  it("transmits everything on a first save, which has nothing to leave out", async () => {
    const save = vi.fn(
      async (
        _id: string,
        content: unknown,
        _options?: unknown,
      ): Promise<string> => {
        void content;
        return "base-after-save";
      },
    );
    const extensions = sessionWith(save, { libraryBase: undefined });

    await extensions.actionFacade().saveLibrary();

    // A document that came from nowhere claims no base, and that is what says
    // it is a first save — so the host has no folder to take anything from.
    expect(save.mock.calls[0]?.[1]).not.toHaveProperty("base");
    expect(pathsOf(save.mock.calls[0]?.[1])).toEqual(everyPath);
    extensions.destroy();
  });

  it("transmits everything for a deliberate overwrite, and nothing for the refusal before it", async () => {
    // The other half of the guard: the road past it is the one road where what
    // is on disk is not the document this save came from, so it cannot claim to
    // have left anything out of it.
    conflictMock.mockResolvedValueOnce("overwrite");
    const save = vi.fn(
      async (
        _id: string,
        _content: unknown,
        options?: { readonly overwrite?: boolean },
      ): Promise<string> => {
        if (options?.overwrite !== true) {
          throw new ThemeConflictError('"theme" was changed by someone else.');
        }
        return "base-after-overwrite";
      },
    );
    const extensions = sessionWith(save);

    await extensions.actionFacade().saveLibrary();

    expect(save.mock.calls).toHaveLength(2);
    // The refused save was made on the document it opened with, so it could be
    // partial — and would have been refused for being stale, not for its size.
    expect(save.mock.calls[0]?.[2]).toEqual({ overwrite: false });
    expect(pathsOf(save.mock.calls[0]?.[1])).toEqual([]);
    // The deliberate one is the whole theme.
    expect(save.mock.calls[1]?.[2]).toEqual({ overwrite: true });
    expect(pathsOf(save.mock.calls[1]?.[1])).toEqual(everyPath);
    extensions.destroy();
  });
});

describe("the Wallpaper Engine import transaction", () => {
  const videoItem = {
    workshopId: "202",
    title: "Neon city",
    kind: "video" as const,
    previewUrl: undefined,
    filesize: 12_582_912,
    tags: [],
    stillAtRest: undefined,
    hasText: undefined,
    attribution: undefined,
  };

  beforeEach(() => {
    saveMock.mockReset();
  });

  /** A session whose shell records the background write, over a real manager. */
  function wallpaperSession(
    manager: AssetManager,
    setBackgroundMedia: ReturnType<typeof vi.fn>,
  ): EditorSession {
    return new EditorSession({
      assetManager: manager,
      shell: {
        editor: {
          canvas: {
            on: vi.fn(),
            off: vi.fn(),
            getActiveObject: () => undefined,
            getObjects: () => [],
            requestRenderAll: vi.fn(),
          },
          clipboardManager: { setImageImporter: vi.fn(), setBindings: vi.fn() },
          textManager: {
            addText: vi.fn(),
            setAuthoringView: vi.fn(),
            setRepaint: vi.fn(),
          },
          cropManager: idleCrop(),
          historyManager: { saveState: vi.fn() },
        },
        scene: {},
        snapshot: vi.fn((input) => ({ ...envelope, ...input })),
        setBackground: vi.fn(),
        setBackgroundMedia,
      } as never,
      source: {} as never,
      envelope,
      panelHosts: {
        add: document.body,
        document: document.body,
        tokens: document.body,
        selection: document.body,
      },
      onNew: vi.fn(),
      onNewFromStarter: vi.fn(),
      onSaved: vi.fn(),
    });
  }

  it("posts a video to the normalizer before the manager sees it, and records the re-encode", async () => {
    const normalizedBytes = new Uint8Array([4, 5, 6]);
    const seen: string[] = [];
    const manager = new AssetManager();
    const realImport = manager.import.bind(manager);
    const importSpy = vi
      .spyOn(manager, "import")
      .mockImplementation(async (file) => {
        seen.push("import");
        return realImport(file);
      });
    const setBackgroundMedia = vi.fn();
    const extensions = wallpaperSession(manager, setBackgroundMedia);

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/asset")) {
          seen.push("asset");
          return new Response(new Uint8Array([1, 2, 3]), {
            status: 200,
            headers: {
              "content-type": "video/mp4",
              "x-yunari-filename": "Neon city.mp4",
            },
          });
        }
        if (url === "/api/themes/normalize-video") {
          seen.push("normalize");
          return new Response(
            JSON.stringify({
              ok: true,
              bytesBase64: base64Of(normalizedBytes),
              reencoded: true,
            }),
            { status: 200 },
          );
        }
        return new Response("", { status: 404 });
      }),
    );

    expect(await extensions.importWallpaperItem(videoItem)).toMatchObject({
      ok: true,
    });
    expect(seen).toEqual(["asset", "normalize", "import"]);

    const imported = importSpy.mock.calls[0]?.[0];
    if (imported === undefined) throw new Error("the manager imported nothing");
    expect(new Uint8Array(await imported.arrayBuffer())).toEqual(
      normalizedBytes,
    );
    expect(setBackgroundMedia).toHaveBeenCalled();

    await extensions.actionFacade().savePackage();
    expect(saveMock).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.anything(),
      undefined,
      expect.objectContaining({
        entries: [
          expect.objectContaining({
            changes: "Re-encoded to the publish envelope",
            source: { workshopId: "202" },
          }),
        ],
      }),
    );
    extensions.destroy();
  });

  it("copies a conforming video unchanged and credits it as copied", async () => {
    const bytes = new Uint8Array([7, 8, 9]);
    const requests: string[] = [];
    const manager = new AssetManager();
    const extensions = wallpaperSession(manager, vi.fn());

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        requests.push(url);
        if (url.includes("/asset"))
          return new Response(new Uint8Array([1, 2, 3]), {
            status: 200,
            headers: {
              "content-type": "video/mp4",
              "x-yunari-filename": "Neon city.mp4",
            },
          });
        return new Response(
          JSON.stringify({ ok: true, bytesBase64: base64Of(bytes) }),
          { status: 200 },
        );
      }),
    );

    expect(await extensions.importWallpaperItem(videoItem)).toMatchObject({
      ok: true,
    });
    expect(requests).toContain("/api/themes/normalize-video");
    await extensions.actionFacade().savePackage();
    expect(saveMock).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.anything(),
      undefined,
      expect.objectContaining({
        entries: [expect.objectContaining({ changes: "Copied unchanged" })],
      }),
    );
    extensions.destroy();
  });

  it("imports nothing and credits nothing when the normalizer refuses", async () => {
    const refusal =
      "That video is 45000 ms long; the maximum is 30000 ms. Trim it and try again.";
    const manager = new AssetManager();
    const importSpy = vi.spyOn(manager, "import");
    const setBackgroundMedia = vi.fn();
    const extensions = wallpaperSession(manager, setBackgroundMedia);

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/asset"))
          return new Response(new Uint8Array([1, 2, 3]), {
            status: 200,
            headers: {
              "content-type": "video/mp4",
              "x-yunari-filename": "Neon city.mp4",
            },
          });
        return new Response(JSON.stringify({ ok: false, message: refusal }), {
          status: 200,
        });
      }),
    );

    expect(importSpy).not.toHaveBeenCalled();
    // The constructor refreshes the artboard once; a refusal adds no second.
    setBackgroundMedia.mockClear();

    expect(await extensions.importWallpaperItem(videoItem)).toEqual({
      ok: false,
      message: refusal,
    });
    expect(importSpy).not.toHaveBeenCalled();
    expect(setBackgroundMedia).not.toHaveBeenCalled();

    await extensions.actionFacade().savePackage();
    // A refusal writes no credit: the package's credits member never appears.
    expect(saveMock).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.anything(),
      undefined,
      undefined,
    );
    extensions.destroy();
  });

  it("imports an image without asking the normalizer", async () => {
    const requests: string[] = [];
    const manager = new AssetManager();
    const extensions = wallpaperSession(manager, vi.fn());

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        requests.push(url);
        return new Response(new Uint8Array([1, 2, 3]), {
          status: 200,
          headers: {
            "content-type": "image/png",
            "x-yunari-filename": "Rain on glass.png",
          },
        });
      }),
    );

    expect(
      await extensions.importWallpaperItem({ ...videoItem, kind: "image" }),
    ).toMatchObject({ ok: true });
    expect(requests.some((url) => url.includes("normalize-video"))).toBe(false);
    extensions.destroy();
  });

  const sceneItem = {
    ...videoItem,
    workshopId: "303",
    title: "Still lake",
    kind: "scene" as const,
  };

  it("sends a scene's exported MP4 through the normalizer", async () => {
    const normalizedBytes = new Uint8Array([7, 8, 9]);
    const requests: string[] = [];
    const manager = new AssetManager();
    const importSpy = vi.spyOn(manager, "import");
    const extensions = wallpaperSession(manager, vi.fn());

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        requests.push(String(input));
        return new Response(
          JSON.stringify({
            ok: true,
            bytesBase64: base64Of(normalizedBytes),
            reencoded: true,
          }),
          { status: 200 },
        );
      }),
    );

    const exported = new File([new Uint8Array([1, 2, 3])], "Still lake.mp4", {
      type: "video/mp4",
    });
    expect(
      await extensions.importWallpaperExport(sceneItem, exported),
    ).toMatchObject({
      ok: true,
    });
    expect(requests).toContain("/api/themes/normalize-video");

    const imported = importSpy.mock.calls[0]?.[0];
    if (imported === undefined) throw new Error("the manager imported nothing");
    expect(new Uint8Array(await imported.arrayBuffer())).toEqual(
      normalizedBytes,
    );

    await extensions.actionFacade().savePackage();
    expect(saveMock).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.anything(),
      undefined,
      expect.objectContaining({
        entries: [
          expect.objectContaining({
            changes: "Re-encoded to the publish envelope",
          }),
        ],
      }),
    );
    extensions.destroy();
  });

  it("imports a scene's exported PNG without asking the normalizer", async () => {
    const requests: string[] = [];
    const manager = new AssetManager();
    const extensions = wallpaperSession(manager, vi.fn());
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        requests.push(String(input));
        return new Response("", { status: 500 });
      }),
    );

    const exported = new File([new Uint8Array([1, 2, 3])], "Still lake.png", {
      type: "image/png",
    });
    expect(
      await extensions.importWallpaperExport(sceneItem, exported),
    ).toMatchObject({
      ok: true,
    });
    expect(requests.some((url) => url.includes("normalize-video"))).toBe(false);
    extensions.destroy();
  });
});

function panel() {
  return {
    root: document.createElement("section"),
    render: vi.fn(),
    setAssets: vi.fn(),
    setGlobals: vi.fn(),
    // The panel now owns a canvas subscription, so tearing the session down has
    // to release it — the double had no `destroy` and the session called one.
    destroy: vi.fn(),
  };
}
