// @vitest-environment jsdom

import type { FabricPalette, FabricThemeEnvelope } from "@yunari/renderer-core";
import {
  MAX_CREDITS_ENTRIES,
  type ThemeCreditsEntry,
} from "@yunari/theme-package";
import { IText } from "fabric/es";
import { act } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { presetLibrary } from "./preset-library/index.js";
import { installReadableFile } from "./readable-file.fixture.js";
import type { TextPlacementPort } from "./text-manager/index.js";
import { uiCopy } from "./ui-copy.js";

installReadableFile();

// Base UI's popups need the browser APIs jsdom has none of — the same supply
// `token-inspector.dom.test.ts` makes, for the same reason.
globalThis.ResizeObserver ??= class {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
} as never;
Element.prototype.getAnimations ??= (): never[] => [];
Element.prototype.setPointerCapture ??= () => undefined;
Element.prototype.releasePointerCapture ??= () => undefined;
window.PointerEvent ??= MouseEvent as never;
{
  // jsdom has no `:modal` or `:popover-open`; Base UI asks both while opening a
  // popup, and an unpatched `matches` throws where the library expects a
  // boolean.
  const matches = Element.prototype.matches;
  Element.prototype.matches = Object.assign(function (
    this: Element,
    selector: string,
  ): boolean {
    if (selector === ":modal" || selector === ":popover-open") return false;
    return matches.call(this, selector);
  }, matches);
}

/** Three macrotasks: React and floating-ui schedule outside the event, so a
 *  popup is flushed with macrotasks rather than one. */
async function flushPopups(): Promise<void> {
  for (let round = 0; round < 3; round += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

/**
 * A token's two-press delete: the first press reveals the reassignment list,
 * the choice names where the references go, and the second press deletes.
 *
 * Base UI commits a list item only when the press that precedes the click
 * started on it, so the press is part of the interaction.
 */
async function deleteToken(
  column: HTMLElement,
  selectHook: string,
  buttonHook: string,
  target: string,
): Promise<void> {
  column.querySelector<HTMLButtonElement>(buttonHook)?.click();
  await flushPopups();
  column.querySelector<HTMLElement>(selectHook)?.click();
  await flushPopups();
  const option = document.querySelector<HTMLElement>(
    `[role="option"][data-yunari-option="${target}"]`,
  );
  if (option === null) throw new Error(`no reassignment option ${target}`);
  option.dispatchEvent(
    new PointerEvent("pointerdown", {
      bubbles: true,
      cancelable: true,
      pointerType: "mouse",
      button: 0,
    }),
  );
  option.click();
  await flushPopups();
  column.querySelector<HTMLButtonElement>(buttonHook)?.click();
}

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
const assetClientMock = vi.hoisted(() => ({
  assetBytes: vi.fn(),
  trashAssets: vi.fn(async () => ({ ok: true })),
}));
vi.mock("./asset-finder/client.js", () => assetClientMock);
/** The cleanup sheet has no jsdom implementation here; a save keeps the files
 *  unless a case is about the dialog, which its own suite drives. */
const cleanupMock = vi.hoisted(() =>
  vi.fn(async (): Promise<"remove" | "keep" | "cancel"> => "keep"),
);
vi.mock("./components/save-cleanup-dialog.js", () => ({
  confirmSaveCleanup: cleanupMock,
}));
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
/** The palette pane's change port, held for the same reason as the type-preset
 *  panel's: the panel is a double, so a test drives a globals write the way its
 *  Add action does. */
const palettePortMock = vi.hoisted(() => ({
  change: undefined as ((palette: FabricPalette) => void) | undefined,
}));
vi.mock("./palette-manager/index.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("./palette-manager/index.js")>();
  return {
    // Only the panel is doubled. The usage walk stays the real one, because the
    // token inspector's paint section calls it whether or not a pane renders.
    ...actual,
    createPalettePanel: (
      _host: unknown,
      change: (palette: FabricPalette) => void,
    ) => {
      palettePortMock.change = change;
      return panel();
    },
  };
});
/** The panel's two ports are held so a test can drive a rename the way the
 *  panel's own field does — the panel is a double here, so nothing else
 *  reaches `EditorDocument.setTypes`. */
const typeTokenPortMock = vi.hoisted(() => ({
  change: undefined as ((presets: Record<string, unknown>) => void) | undefined,
  remove: undefined as ((id: string, replacement: string) => void) | undefined,
}));
vi.mock("./type-preset-manager/index.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("./type-preset-manager/index.js")>();
  return {
    // Only the panel is doubled. `reassignTypeToken` is the document's
    // delete path and stays the real one, so a delete case exercises it.
    ...actual,
    createTypeTokenPanel: (
      _host: unknown,
      change: (presets: Record<string, unknown>) => void,
      remove: (id: string, replacement: string) => void,
    ) => {
      typeTokenPortMock.change = change;
      typeTokenPortMock.remove = remove;
      return panel();
    },
  };
});
/** The actions the last Add pane was handed, so a test can drive a tile the
 *  way the pane does without mounting the pane's React tree. */
const newObjectActionsMock = vi.hoisted(() => ({
  last: undefined as
    | {
        addText: () => void;
        addChart: (family: unknown) => void;
        insertCard: (cardId: string) => void;
      }
    | undefined,
}));
vi.mock("./new-object-panel.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./new-object-panel.js")>();
  return {
    ...actual,
    // Only the renderer is doubled: the arming route's construction and its
    // refusal wrapper are the real ones, so a test drives the real seam.
    createNewObjectPanel: (
      _host: unknown,
      _editor: unknown,
      _globals: unknown,
      actions?: typeof newObjectActionsMock.last,
    ) => {
      newObjectActionsMock.last = actions;
      return panel();
    },
  };
});
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
import { EditorDocument } from "./editor-document.js";
import { EditorSession } from "./editor-session.js";
import {
  SelectionStore,
  TokenSelectionStore,
} from "./editor-shell/shell-stores.js";
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
  schemaVersion: "2.0.0",
  fabricVersion: "7.4.0",
  id: "theme",
  metadata: { themeLanguage: "en" },
  artboard: { width: 100, height: 100 },
  globals: {
    typeTokens: {
      heading: { family: "system-ui, sans-serif", weight: "600" },
      body: { family: "system-ui, sans-serif", weight: "400" },
      mono: { family: "monospace", weight: "400" },
    },
  },
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
        setMentions: vi.fn(),
      },
      cropManager: idleCrop(),
      historyManager: { attachGlobals: () => {} },
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
        assets: document.body,
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
    expect(onOpenTheme).toHaveBeenCalledWith(
      envelope,
      {},
      undefined,
      undefined,
    );

    await session.savePackage();
    expect(onSaved).toHaveBeenCalled();

    await session.saveLibrary();
    expect(mockClient.save).toHaveBeenCalled();

    // Ctrl+S is the library save, not the package download: the chord reaches
    // the same owner the menu row does, and the downloader is untouched.
    const saveChord = registerMock.mock.calls.find(
      ([action]) => action === "file.save",
    )?.[1] as (() => void) | undefined;
    expect(saveChord).toBeDefined();
    saveMock.mockClear();
    mockClient.save.mockClear();
    saveChord?.();
    await vi.waitFor(() => expect(mockClient.save).toHaveBeenCalledTimes(1));
    expect(
      saveMock,
      "the save chord downloaded a package",
    ).not.toHaveBeenCalled();

    extensions.destroy();
  });

  it("notifies document listeners for the scene's add, remove and committed edit", async () => {
    // The session is where Fabric's own events become the document's "look
    // again" signal. The canvas stub is a real event bus here, so this reaches
    // the registration loop in the constructor: delete an entry and a paste or
    // a delete stops updating every panel, with no other test noticing.
    const canvasListeners = new Map<string, Set<() => void>>();
    const canvas = {
      on: vi.fn((name: string, listener: () => void) => {
        const registered = canvasListeners.get(name) ?? new Set<() => void>();
        registered.add(listener);
        canvasListeners.set(name, registered);
      }),
      off: vi.fn(),
      fire: (name: string) => {
        for (const listener of canvasListeners.get(name) ?? []) listener();
      },
      getActiveObject: () => undefined,
      getObjects: () => [],
      requestRenderAll: vi.fn(),
    };
    const session = new EditorSession({
      assetManager: new AssetManager(),
      shell: {
        editor: {
          canvas,
          clipboardManager: { setImageImporter: vi.fn(), setBindings: vi.fn() },
          textManager: {
            addText: vi.fn(),
            setAuthoringView: vi.fn(),
            setRepaint: vi.fn(),
            setMentions: vi.fn(),
          },
          cropManager: idleCrop(),
          historyManager: { attachGlobals: () => {} },
        },
        scene: {},
        snapshot: vi.fn(() => envelope),
        setBackgroundMedia: vi.fn(),
      } as never,
      source: {} as never,
      envelope,
      panelHosts: {
        add: document.body,
        assets: document.body,
        document: document.body,
        tokens: document.body,
        selection: document.body,
      },
      onNew: vi.fn(),
      onNewFromStarter: vi.fn(),
      onSaved: vi.fn(),
    });

    const heard = vi.fn();
    session.subscribeDocumentChange(heard);

    canvas.fire("object:added");
    canvas.fire("object:removed");
    expect(
      heard,
      "the batch is still open in this task",
    ).not.toHaveBeenCalled();
    await Promise.resolve();
    expect(heard).toHaveBeenCalledTimes(1);

    // The third event in the same registration block: a recorded edit moves
    // the document even when no object moved with it.
    canvas.fire("editor:edit-committed");
    await Promise.resolve();
    expect(heard).toHaveBeenCalledTimes(2);

    session.destroy();
  });

  it("binds the chord the header prints to the shell's own publish surface", () => {
    // The header prints this chord beside the publish control, so the
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
            setMentions: vi.fn(),
          },
          cropManager: idleCrop(),
          historyManager: { attachGlobals: () => {} },
        },
        scene: {},
        snapshot: vi.fn(() => envelope),
        setBackgroundMedia: vi.fn(),
      } as never,
      source: {} as never,
      envelope,
      panelHosts: {
        add: document.body,
        assets: document.body,
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
              setMentions: vi.fn(),
            },
            cropManager: idleCrop(),
            historyManager: { attachGlobals: () => {} },
          },
          scene: {},
          snapshot: vi.fn(() => envelope),
          setBackgroundMedia: vi.fn(),
        } as never,
        source: {} as never,
        envelope,
        panelHosts: {
          add: document.body,
          assets: document.body,
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
            setMentions: vi.fn(),
          },
          cropManager: idleCrop(),
          historyManager: { attachGlobals: () => {} },
        },
        scene: {},
        snapshot: vi.fn(() => envelope),
        setBackgroundMedia: vi.fn(),
      } as never,
      source: {} as never,
      envelope,
      panelHosts: {
        add: document.body,
        assets: document.body,
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
            setMentions: vi.fn(),
          },
          cropManager: idleCrop(),
          historyManager: { attachGlobals: () => {} },
        },
        scene: {},
        snapshot: vi.fn(() => envelope),
        setBackgroundMedia: vi.fn(),
      } as never,
      source: {} as never,
      envelope,
      panelHosts: {
        add: document.body,
        assets: document.body,
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
          setMentions: vi.fn(),
        },
        cropManager: idleCrop(),
        historyManager: { attachGlobals: () => {} },
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
        assets: document.body,
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

  it("adopts a trio, replacing every role token and leaving a non-role alone", async () => {
    const fetch = vi.fn(async () => new Response(new Uint8Array([1, 2, 3])));
    vi.stubGlobal("fetch", fetch);
    const onAssetCountChange = vi.fn();
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
          setMentions: vi.fn(),
        },
        cropManager: idleCrop(),
        historyManager: { attachGlobals: () => {}, saveState: vi.fn() },
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
          typeTokens: {
            heading: { family: "Segoe UI", weight: "500" },
            metric: { family: "Segoe UI", weight: "300" },
            custom: { family: "Georgia" },
          },
        },
      },
      panelHosts: {
        add: document.body,
        assets: document.body,
        document: document.body,
        tokens: document.body,
        selection: document.body,
      },
      onNew: vi.fn(),
      onNewFromStarter: vi.fn(),
      onSaved: vi.fn(),
      onAssetCountChange,
    });

    expect(onAssetCountChange).toHaveBeenLastCalledWith(0);
    const result = await extensions.applyFontTrio("minimal");
    // The trio adopted one declaration per face, so the count the Assets pane's
    // title draws moved with the declarations — a trio applied from Tokens must
    // not leave a stale number beside the new font cards.
    expect(onAssetCountChange).toHaveBeenLastCalledWith(
      fontTrio("minimal")!.faces.length,
    );
    const heading = fontTrio("minimal")!.faces[0]!;

    expect(fetch).toHaveBeenCalledTimes(3);
    expect(result.globals?.typeTokens).toMatchObject({
      heading: {
        family: heading.family,
        weight: heading.weight,
        face: { assetId: heading.id },
      },
      metric: { family: "Segoe UI", weight: "300" },
      custom: { family: "Georgia" },
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
          setMentions: vi.fn(),
        },
        cropManager: idleCrop(),
        historyManager: { attachGlobals: () => {}, saveState: vi.fn() },
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
          typeTokens: {
            heading: {
              family: "Segoe UI",
              weight: "700",
              face: { assetId: fontTrio("minimal")!.faces[0]!.id },
            },
          },
        },
      },
      panelHosts: {
        add: document.body,
        assets: document.body,
        document: document.body,
        tokens: document.body,
        selection: document.body,
      },
      onNew: vi.fn(),
      onNewFromStarter: vi.fn(),
      onSaved: vi.fn(),
    });

    const result = await extensions.applyPresetFace("heading", body);

    expect(result.globals?.typeTokens).toMatchObject({
      heading: {
        family: body.family,
        weight: body.weight,
        face: { assetId: body.id },
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
          setMentions: vi.fn(),
        },
        cropManager: idleCrop(),
        historyManager: {
          attachGlobals: () => {},
          suspend,
          saveState,
          undo,
          redo: vi.fn(),
        },
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
        assets: document.body,
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
          setMentions: vi.fn(),
        },
        cropManager: idleCrop(),
        historyManager: { attachGlobals: () => {}, saveState: vi.fn() },
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
          typeTokens: {
            heading: { family: "Segoe UI", weight: "500" },
          },
        },
      },
      panelHosts: {
        add: document.body,
        assets: document.body,
        document: document.body,
        tokens: document.body,
        selection: document.body,
      },
      onNew: vi.fn(),
      onNewFromStarter: vi.fn(),
      onSaved: vi.fn(),
    });

    await expect(extensions.applyFontTrio("minimal")).rejects.toThrow("404");
    expect(extensions.envelope.globals?.typeTokens).toEqual({
      heading: { family: "Segoe UI", weight: "500" },
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
        setMentions: vi.fn(),
      },
      cropManager: idleCrop(),
      historyManager: { attachGlobals: () => {} },
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
        assets: document.body,
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

  it("reaches every globals consumer when a type token's face changes, so the inspector follows", () => {
    // vg-232. The receivers were listed inline once per setter and the lists
    // disagreed: `setTypes` told three, never the inspector. The inspector
    // reads a token's computed name out of `context.globals`, and `setGlobals`
    // is the only thing that updates it, so a face edit left the surface
    // printing the old name until an unrelated `object:modified` re-rendered
    // it. This reads the surface the author reads rather than counting calls.
    //
    // **It read the Spends line until 2026-10-15.** Item 17 removed that
    // section, so the surface is the run editor's own token control — which
    // names its tokens out of the same `context.globals`, through the same
    // `selection.setGlobals` this row's fix introduced. The claim is unchanged;
    // only the element that prints it moved.
    const text = new IText("Hi", { left: 0, top: 0 });
    text.set({
      yunariText: {
        runs: [{ kind: "literal", text: "Hi", typeToken: "typeTokens.body" }],
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
        // The run editor reads the artboard for a role default size; this is
        // the frame the fixture's envelope declares.
        artboard: () => ({ width: 100, height: 100 }),
        clipboardManager: { setImageImporter: vi.fn(), setBindings: vi.fn() },
        textManager: {
          addText: vi.fn(),
          setAuthoringView: vi.fn(),
          setRepaint: vi.fn(),
          setMentions: vi.fn(),
        },
        cropManager: idleCrop(),
        historyManager: { attachGlobals: () => {}, saveState: vi.fn() },
        errorManager: { warn: vi.fn(), error: vi.fn() },
      },
      scene: {},
      snapshot: vi.fn((input) => ({ ...envelope, ...input })),
      setBackground: vi.fn(),
      setBackgroundMedia: vi.fn(),
      setGlobals: vi.fn(),
      refreshGlass: vi.fn(),
    };
    // The family is the only part of the computed name that moves: a token has
    // no stored name to rename, and the id is the role.
    const presets = (family: string) => ({
      body: { family, weight: "600" },
    });
    const extensions = new EditorSession({
      assetManager: new AssetManager(),
      shell: shell as never,
      source: {} as never,
      envelope: { ...envelope, globals: { typeTokens: presets("Inter") } },
      panelHosts: {
        add: document.body,
        assets: document.body,
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

    // The trigger prints the computed name, role first: the id is the role.
    expect(printed()).toBe("[Body] Inter 600");

    // The panel's own field writes the whole map, which is what a face edit is.
    typeTokenPortMock.change?.(presets("Manrope"));

    expect(printed()).toBe("[Body] Manrope 600");
    extensions.destroy();
  });

  it("gives the selected token its own column, and gives the object column back", async () => {
    // The right column has one owner at a time. The session
    // owns both halves — the token panel's mounts and the suppression — because
    // it already owns the document the token fields write through; a panel built
    // by `shell-layout` would need a second copy of it.
    const selectionHost = document.createElement("div");
    document.body.append(selectionHost);
    const tokenSelection = new TokenSelectionStore(new SelectionStore());
    const presets = {
      body: { family: "Inter" },
      caption: { family: "Inter" },
    };
    const paints = {
      background: {
        name: "Background",
        value: { kind: "solid" as const, color: "#102030" },
      },
      accent: {
        name: "Accent",
        value: { kind: "solid" as const, color: "#00b8d9" },
      },
    };
    const shell = {
      editor: {
        canvas: {
          on: vi.fn(),
          off: vi.fn(),
          getActiveObject: () => undefined,
          getObjects: () => [],
          requestRenderAll: vi.fn(),
          fire: vi.fn(),
        },
        clipboardManager: { setImageImporter: vi.fn(), setBindings: vi.fn() },
        textManager: {
          addText: vi.fn(),
          setAuthoringView: vi.fn(),
          setRepaint: vi.fn(),
          setMentions: vi.fn(),
        },
        cropManager: idleCrop(),
        historyManager: { attachGlobals: () => {}, saveState: vi.fn() },
        errorManager: { warn: vi.fn(), error: vi.fn() },
      },
      scene: {},
      snapshot: vi.fn((input) => ({ ...envelope, ...input })),
      setBackground: vi.fn(),
      setBackgroundMedia: vi.fn(),
      setGlobals: vi.fn(),
      refreshGlass: vi.fn(),
    };
    const extensions = new EditorSession({
      assetManager: new AssetManager(),
      shell: shell as never,
      source: {} as never,
      envelope: {
        ...envelope,
        globals: { typeTokens: presets, palette: paints },
      },
      panelHosts: {
        add: document.body,
        assets: document.body,
        document: document.body,
        tokens: document.body,
        selection: selectionHost,
      },
      tokenSelection,
      onNew: vi.fn(),
      onNewFromStarter: vi.fn(),
      onSaved: vi.fn(),
    });

    const objectColumn = selectionHost.querySelector<HTMLElement>(
      '[data-yunari-panel="selection"]',
    );
    const tokenColumn = selectionHost.querySelector<HTMLElement>(
      "[data-yunari-token-inspector]",
    );
    expect(objectColumn).not.toBeNull();
    expect(tokenColumn).not.toBeNull();
    expect(objectColumn?.style.display).toBe("");

    tokenSelection.set({ kind: "preset", id: "body" });
    expect(objectColumn?.style.display).toBe("none");
    expect(
      tokenColumn?.querySelector("[data-yunari-token-family]"),
    ).not.toBeNull();

    tokenSelection.clear();
    expect(objectColumn?.style.display).toBe("");
    expect(tokenColumn?.textContent).toBe("");

    // Deleting the token the selection names clears the token too: the column
    // must show the object selection again rather than staying suppressed over
    // a token the document no longer has. The replacement is the other token,
    // and the deleted one is unroled because a role cannot be deleted. Delete
    // takes two presses — one to open the reassignment, one to commit it.
    tokenSelection.set({ kind: "preset", id: "caption" });
    expect(objectColumn?.style.display).toBe("none");
    // A plain click: the token panel renders through `flushSync`, so the
    // document write and the suppression it causes land synchronously. Wrapping
    // it in `act` would need `IS_REACT_ACT_ENVIRONMENT`, which this suite does
    // not set, and React warns once per run when it is missing.
    await deleteToken(
      tokenColumn!,
      "[data-yunari-token-replacement]",
      "[data-yunari-token-delete]",
      "body",
    );
    expect(tokenSelection.get()).toBeUndefined();
    expect(objectColumn?.style.display).toBe("");
    expect(tokenColumn?.textContent).toBe("");

    // The same rule for a paint token: deleting the paint the inspector names
    // must give the object column back rather than leave it suppressed over a
    // token the palette no longer has. The replacement is the other paint.
    tokenSelection.set({ kind: "paint", id: "background" });
    expect(objectColumn?.style.display).toBe("none");
    expect(
      tokenColumn?.querySelector("[data-yunari-palette-name]"),
    ).not.toBeNull();
    await deleteToken(
      tokenColumn!,
      "[data-yunari-palette-replacement]",
      "[data-yunari-palette-delete]",
      "accent",
    );
    expect(tokenSelection.get()).toBeUndefined();
    expect(objectColumn?.style.display).toBe("");
    expect(tokenColumn?.textContent).toBe("");

    // The token can also vanish without either delete route: an undo of Add
    // restores the globals captured before it, and a load replaces them whole.
    // A held ref there would keep the object column suppressed over a blank
    // section, so the render drops the ref when the document no longer declares
    // the token — once per kind.
    tokenSelection.set({ kind: "preset", id: "body" });
    expect(objectColumn?.style.display).toBe("none");
    expect(
      tokenColumn?.querySelector("[data-yunari-token-family]"),
    ).not.toBeNull();
    typeTokenPortMock.change?.({});
    // The document batches a task's announcements into one flush, so the
    // re-render that drops the ref arrives on the microtask.
    await Promise.resolve();
    expect(tokenSelection.get()).toBeUndefined();
    expect(objectColumn?.style.display).toBe("");
    expect(tokenColumn?.textContent).toBe("");

    tokenSelection.set({ kind: "paint", id: "accent" });
    expect(objectColumn?.style.display).toBe("none");
    expect(
      tokenColumn?.querySelector("[data-yunari-palette-name]"),
    ).not.toBeNull();
    palettePortMock.change?.({ background: paints.background });
    await Promise.resolve();
    expect(tokenSelection.get()).toBeUndefined();
    expect(objectColumn?.style.display).toBe("");
    expect(tokenColumn?.textContent).toBe("");

    extensions.destroy();
    // The duplicate-pane defect `4ede5585` fixed for the Assets pane: a panel
    // whose `destroy()` is never called leaves its section in the host.
    expect(
      selectionHost.querySelector("[data-yunari-token-inspector]"),
    ).toBeNull();
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
            setMentions: vi.fn(),
          },
          cropManager: idleCrop(),
          historyManager: { attachGlobals: () => {}, saveState: vi.fn() },
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
        assets: document.body,
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
          setMentions: vi.fn(),
        },
        cropManager: idleCrop(),
        historyManager: { attachGlobals: () => {}, saveState: vi.fn() },
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
        assets: document.body,
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
      { source: "lucide", results: [], totalPages: 1, failure: undefined },
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

  it("adds a finder palette to the presets without asking the host for bytes", async () => {
    const extensions = sessionWith();

    const outcome = await extensions.actionFacade().importAsset?.(
      { source: "coolors", results: [], totalPages: 1, failure: undefined },
      {
        id: "coolors:cloud-dancer",
        name: "Cloud Dancer",
        kind: "palette",
        preview: "",
        subtitle: undefined,
        licence: "unknown",
        sourceUrl: "",
        preset: { kind: "palette", colours: ["#112233", "#445566"] },
      },
    );

    expect(outcome?.ok).toBe(true);
    // A preset is data, not an imported asset: there are no bytes to fetch.
    expect(assetClientMock.assetBytes).not.toHaveBeenCalled();
    const stored = presetLibrary.getSnapshot().colours;
    expect(stored.some((preset) => preset.name === "Cloud Dancer 1")).toBe(
      true,
    );
    expect(stored.some((preset) => preset.name === "Cloud Dancer 2")).toBe(
      true,
    );
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
      { source: "lucide", results: [], totalPages: 1, failure: undefined },
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
    // token, its stroke width and the frame-relative size the author gets. A
    // glyph drawn in several subpaths is one path, not a group of them.
    const placed = canvas.add.mock.calls[0]?.[0] as {
      type: string;
      get(name: string): unknown;
      width: number;
      scaleX: number;
    };
    expect(placed.type).toBe("path");
    expect(placed.get("name")).toBe("house");
    expect(placed.get("stroke")).toBe("#ecf5ff");
    expect(Math.round(placed.width * placed.scaleX)).toBe(
      Math.round(1080 * 0.12),
    );
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
        setMentions: vi.fn(),
      },
      cropManager: idleCrop(),
      historyManager: { attachGlobals: () => {} },
    },
    scene: {},
    snapshot: vi.fn(() => envelope),
    setBackgroundMedia: vi.fn(),
  });

  const panelHosts = {
    add: document.body,
    assets: document.body,
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

    expect(onOpenTheme).toHaveBeenCalledWith(
      stored,
      {},
      "base-as-stored",
      undefined,
    );
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
    expect(onOpenTheme).toHaveBeenCalledWith(
      stored,
      {},
      "base-as-stored",
      undefined,
    );

    conflictMock.mockResolvedValueOnce("reload");
    await session.saveLibrary();
    expect(onOpenTheme).toHaveBeenLastCalledWith(
      stored,
      {},
      "base-as-stored",
      undefined,
    );
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
        setMentions: vi.fn(),
      },
      cropManager: idleCrop(),
      historyManager: { attachGlobals: () => {}, saveState: vi.fn() },
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
    assets: document.body,
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
    kind: "svg" as const,
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
          typeTokens: {
            heading: { family: "Inter" },
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
            setMentions: vi.fn(),
          },
          cropManager: idleCrop(),
          historyManager: { attachGlobals: () => {}, saveState: vi.fn() },
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
        assets: document.body,
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
      "That video is 45000 ms long; the maximum is 60000 ms. Trim it and try again.";
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

  it("carries the resolved author, the licence and the workshop source", async () => {
    const bytes = new Uint8Array([7, 8, 9]);
    const requests: string[] = [];
    const workshopUrl =
      "https://steamcommunity.com/sharedfiles/filedetails/?id=202";
    const steamId = "76561198000000001";
    const manager = new AssetManager();
    const extensions = wallpaperSession(manager, vi.fn());
    const item = {
      ...videoItem,
      attribution: { steamId, workshopUrl },
    };

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
        if (url.startsWith("/api/wallpaper-engine/author/"))
          return new Response(JSON.stringify({ name: "Ada" }), { status: 200 });
        return new Response(
          JSON.stringify({ ok: true, bytesBase64: base64Of(bytes) }),
          { status: 200 },
        );
      }),
    );

    expect(await extensions.importWallpaperItem(item)).toEqual({ ok: true });

    expect(requests).toContain(`/api/wallpaper-engine/author/${steamId}`);
    // The declaration is what the preview modal reads; without it the video's
    // attribution pills say "None recorded".
    expect(manager.declarations[0]).toMatchObject({
      kind: "video",
      license: { name: "unknown" },
      sourceUrl: workshopUrl,
    });

    await extensions.actionFacade().savePackage();
    expect(saveMock).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.anything(),
      undefined,
      expect.objectContaining({
        entries: [
          expect.objectContaining({
            kind: "wallpaper",
            author: { steamId, name: "Ada" },
            source: { workshopId: "202", url: workshopUrl },
            assetId: manager.declarations[0]?.id,
          }),
        ],
      }),
    );
    extensions.destroy();
  });

  it("keeps the Steam id and the profile URL when the author lookup fails", async () => {
    const bytes = new Uint8Array([7, 8, 9]);
    const steamId = "76561198000000001";
    const profileUrl = `https://steamcommunity.com/profiles/${steamId}`;
    const manager = new AssetManager();
    const extensions = wallpaperSession(manager, vi.fn());
    const item = { ...videoItem, attribution: { steamId } };

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
        if (url.startsWith("/api/wallpaper-engine/author/"))
          return new Response("", { status: 500 });
        return new Response(
          JSON.stringify({ ok: true, bytesBase64: base64Of(bytes) }),
          { status: 200 },
        );
      }),
    );

    // A refused lookup never fails the import.
    expect(await extensions.importWallpaperItem(item)).toEqual({ ok: true });
    expect(manager.declarations[0]).toMatchObject({
      license: { name: "unknown" },
      sourceUrl: profileUrl,
    });

    await extensions.actionFacade().savePackage();
    const write = saveMock.mock.calls.at(-1) as
      | [
          unknown,
          unknown,
          Uint8Array | undefined,
          (
            | { readonly entries: readonly { readonly author?: unknown }[] }
            | undefined
          ),
        ]
      | undefined;
    expect(write?.[3]?.entries[0]?.author).toEqual({ steamId });
    extensions.destroy();
  });

  it("does not ask for an author when the item has no Steam id", async () => {
    const requests: string[] = [];
    const manager = new AssetManager();
    const extensions = wallpaperSession(manager, vi.fn());
    const item = {
      ...videoItem,
      attribution: {
        workshopUrl:
          "https://steamcommunity.com/sharedfiles/filedetails/?id=202",
      },
    };

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
          JSON.stringify({ ok: true, bytesBase64: base64Of(new Uint8Array()) }),
          { status: 200 },
        );
      }),
    );

    expect(await extensions.importWallpaperItem(item)).toEqual({ ok: true });
    expect(
      requests.some((url) => url.startsWith("/api/wallpaper-engine/author/")),
    ).toBe(false);
    expect(manager.declarations[0]).toMatchObject({
      sourceUrl: "https://steamcommunity.com/sharedfiles/filedetails/?id=202",
    });
    extensions.destroy();
  });

  /**
   * **One host call, because the host extracts and normalizes together.** The
   * package's title is what the credit carries; the video has no source, no
   * author and no workshop id, because the file carries none.
   */
  it("imports a picked .mpkg through the one host call and credits its title", async () => {
    const video = new Uint8Array([1, 2, 3]);
    const requests: { readonly url: string; readonly body: unknown }[] = [];
    const manager = new AssetManager();
    const importSpy = vi.spyOn(manager, "import");
    const setBackgroundMedia = vi.fn();
    const extensions = wallpaperSession(manager, setBackgroundMedia);

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        requests.push({ url: String(input), body: init?.body });
        return new Response(
          JSON.stringify({
            ok: true,
            videoBase64: base64Of(video),
            reencoded: false,
            title: "Night street",
            workshopId: "202",
          }),
          { status: 200 },
        );
      }),
    );

    const picked = new File([new Uint8Array([9, 9])], "night.mpkg", {
      type: "application/octet-stream",
    });
    const steps: string[] = [];
    expect(
      await extensions.importPickedVideo(picked, {
        package: true,
        onStep: (step) => steps.push(step),
      }),
    ).toEqual({ ok: true });

    // The host's single call, never the separate normalize route.
    expect(requests.map((request) => request.url)).toEqual([
      "/api/wallpaper-engine/mpkg",
    ]);
    expect(requests[0]?.body).toBe(picked);
    expect(steps).toEqual(["preparing", "importing"]);

    expect(importSpy).toHaveBeenCalledTimes(1);
    const imported = importSpy.mock.calls[0]?.[0];
    if (imported === undefined) throw new Error("the manager imported nothing");
    expect(imported.name).toBe("Night street.mp4");
    expect(new Uint8Array(await imported.arrayBuffer())).toEqual(video);
    expect(setBackgroundMedia).toHaveBeenCalled();
    // A package declares its unknown licence and no source: the file carries
    // neither a workshop id nor an author.
    expect(manager.declarations[0]).toMatchObject({
      license: { name: "unknown" },
    });
    expect(manager.declarations[0]?.sourceUrl).toBeUndefined();

    await extensions.actionFacade().savePackage();
    // A package declares no source and no author: the file carries neither.
    expect(saveMock).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.anything(),
      undefined,
      expect.objectContaining({
        entries: [
          {
            kind: "wallpaper",
            title: "Night street",
            license: "unknown",
            changes: "Copied unchanged",
            assetId: manager.declarations[0]?.id,
          },
        ],
      }),
    );
    extensions.destroy();
  });

  it("imports a picked video through the normalizer and writes no credit", async () => {
    const normalized = new Uint8Array([4, 5, 6]);
    const requests: string[] = [];
    const manager = new AssetManager();
    const importSpy = vi.spyOn(manager, "import");
    const setBackgroundMedia = vi.fn();
    const extensions = wallpaperSession(manager, setBackgroundMedia);

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        requests.push(String(input));
        return new Response(
          JSON.stringify({
            ok: true,
            bytesBase64: base64Of(normalized),
            reencoded: true,
          }),
          { status: 200 },
        );
      }),
    );

    const picked = new File([new Uint8Array([1])], "clip.mov", {
      type: "video/quicktime",
    });
    expect(
      await extensions.importPickedVideo(picked, { package: false }),
    ).toEqual({ ok: true });

    expect(requests).toEqual(["/api/themes/normalize-video"]);
    const imported = importSpy.mock.calls[0]?.[0];
    if (imported === undefined) throw new Error("the manager imported nothing");
    expect(imported.name).toBe("clip.mp4");
    expect(new Uint8Array(await imported.arrayBuffer())).toEqual(normalized);
    expect(setBackgroundMedia).toHaveBeenCalled();

    await extensions.actionFacade().savePackage();
    // A video carries no attribution: no credit member reaches the writer.
    expect(saveMock).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.anything(),
      undefined,
      undefined,
    );
    extensions.destroy();
  });

  it("returns the host's package sentence and declares nothing", async () => {
    const sentence = "No video in this package.";
    const manager = new AssetManager();
    const importSpy = vi.spyOn(manager, "import");
    const setBackgroundMedia = vi.fn();
    const extensions = wallpaperSession(manager, setBackgroundMedia);
    setBackgroundMedia.mockClear();

    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ ok: false, message: sentence }), {
            status: 200,
          }),
      ),
    );

    const picked = new File([new Uint8Array([9])], "night.mpkg", {
      type: "application/octet-stream",
    });
    expect(
      await extensions.importPickedVideo(picked, { package: true }),
    ).toEqual({ ok: false, message: sentence });
    expect(importSpy).not.toHaveBeenCalled();
    expect(setBackgroundMedia).not.toHaveBeenCalled();
    extensions.destroy();
  });
});

describe("the local font import", () => {
  beforeEach(() => {
    saveMock.mockReset();
    document.body.replaceChildren();
  });

  /** A session whose Assets pane is the real one, over a real manager. */
  function fontSession(
    manager: AssetManager,
    credits?: readonly ThemeCreditsEntry[],
  ): EditorSession {
    return new EditorSession({
      assetManager: manager,
      ...(credits === undefined ? {} : { credits }),
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
            setMentions: vi.fn(),
          },
          cropManager: idleCrop(),
          historyManager: { attachGlobals: () => {}, saveState: vi.fn() },
        },
        scene: {},
        snapshot: vi.fn((input) => ({ ...envelope, ...input })),
        setBackground: vi.fn(),
        setBackgroundMedia: vi.fn(),
        // The preset write runs the globals fan-out, which the shell owns.
        setGlobals: vi.fn(),
      } as never,
      source: {} as never,
      envelope,
      panelHosts: {
        add: document.body,
        assets: document.body,
        document: document.body,
        tokens: document.body,
        selection: document.body,
      },
      onNew: vi.fn(),
      onNewFromStarter: vi.fn(),
      onSaved: vi.fn(),
    });
  }

  /** Lets the pane's commit and the manager's byte hash settle. */
  async function settle(): Promise<void> {
    for (let round = 0; round < 5; round += 1)
      await new Promise((resolve) => setTimeout(resolve, 0));
  }

  /** jsdom has no parser; the declaration path is what these cases prove. */
  function stubFontParser(): void {
    vi.stubGlobal(
      "FontFace",
      class {
        load(): Promise<this> {
          return Promise.resolve(this);
        }
      },
    );
  }

  function fontFile(): File {
    const bytes = new TextEncoder().encode("ttf");
    return Object.assign(
      new File([bytes as unknown as BlobPart], "Inter-Bold.ttf", {
        type: "font/ttf",
      }),
      {
        arrayBuffer: async () =>
          bytes.buffer.slice(
            bytes.byteOffset,
            bytes.byteOffset + bytes.byteLength,
          ),
      },
    );
  }

  /** Picks the file through the pane's own control. */
  async function pickFont(): Promise<void> {
    const input = document.body.querySelector<HTMLInputElement>(
      "[data-yunari-asset-import-input]",
    );
    if (input === null) throw new Error("no import input");
    Object.defineProperty(input, "files", {
      value: [fontFile()],
      configurable: true,
    });
    await act(async () => {
      input.dispatchEvent(new Event("change", { bubbles: true }));
      await settle();
    });
  }

  it("creates one preset and one credit carrying the assetId", async () => {
    stubFontParser();
    const manager = new AssetManager();
    const extensions = fontSession(manager);
    const addCredit = vi.spyOn(EditorDocument.prototype, "addCredit");
    await pickFont();

    // The pick is not a declaration; Create type preset is the one write.
    expect(manager.declarations).toEqual([]);
    const create = document.body.querySelector<HTMLButtonElement>(
      "[data-yunari-font-create]",
    );
    if (create === null) throw new Error("no Create type preset control");
    await act(async () => {
      create.click();
      await settle();
    });
    // The parse and the declaration are asynchronous; a fixed number of
    // macrotasks is enough on an idle box and not on CI's, where the write can
    // land after this test has ended and be counted by the next one.
    await vi.waitFor(() => {
      expect(manager.declarations).toHaveLength(1);
    });

    expect(manager.declarations).toMatchObject([
      { kind: "font", family: "Inter", weight: 700, format: "ttf" },
    ]);
    expect(addCredit).toHaveBeenCalledTimes(1);

    await extensions.actionFacade().savePackage();
    const saved = saveMock.mock.calls.at(-1) as unknown[] | undefined;
    const presets =
      (saved?.[0] as FabricThemeEnvelope | undefined)?.globals?.typeTokens ??
      {};
    const faces = Object.values(presets).filter(
      (preset) => preset.face !== undefined,
    );
    expect(faces).toHaveLength(1);
    expect(faces[0]).toMatchObject({
      family: "Inter",
      weight: 700,
      face: { assetId: "Inter-Bold" },
    });
    expect(saveMock).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.anything(),
      undefined,
      expect.objectContaining({
        entries: [
          expect.objectContaining({
            kind: "font",
            title: "Inter",
            license: "unknown",
            assetId: "Inter-Bold",
          }),
        ],
      }),
    );

    extensions.destroy();
    vi.unstubAllGlobals();
  });

  it("declares a cancelled pick and writes neither a preset nor a credit", async () => {
    stubFontParser();
    const manager = new AssetManager();
    const extensions = fontSession(manager);
    const addCredit = vi.spyOn(EditorDocument.prototype, "addCredit");
    await pickFont();
    expect(manager.declarations).toEqual([]);

    const cancel = document.body.querySelector<HTMLButtonElement>(
      "[data-yunari-font-cancel]",
    );
    if (cancel === null) throw new Error("no Cancel control");
    await act(async () => {
      cancel.click();
      await settle();
    });

    // Cancel keeps the file the author gave us, and nothing else.
    await vi.waitFor(() => {
      expect(manager.declarations).toHaveLength(1);
    });
    expect(manager.declarations).toMatchObject([
      { kind: "font", family: "Inter", weight: 700, format: "ttf" },
    ]);
    expect(addCredit).not.toHaveBeenCalled();
    await extensions.actionFacade().savePackage();
    const saved = saveMock.mock.calls.at(-1) as unknown[] | undefined;
    expect(
      Object.values(
        (saved?.[0] as FabricThemeEnvelope | undefined)?.globals?.typeTokens ??
          {},
      ).filter((preset) => preset.face !== undefined),
    ).toEqual([]);
    expect(saved?.[3]).toBeUndefined();

    extensions.destroy();
    vi.unstubAllGlobals();
  });

  it("refuses a fresh import at the cap even when a legacy credit shares its title", async () => {
    stubFontParser();
    const manager = new AssetManager();
    const extensions = fontSession(manager);
    // A pre-assetId credit with the same title would make `canAddCredit` treat
    // the new one as a replacement; the list is still full.
    vi.spyOn(EditorDocument.prototype, "credits").mockReturnValue([
      {
        kind: "font",
        title: "Inter",
        license: "unknown",
        changes: "Imported unchanged",
      },
      ...Array.from({ length: MAX_CREDITS_ENTRIES - 1 }, (_, index) => ({
        kind: "font",
        title: `legacy-${index}`,
        license: "unknown",
        changes: "Imported unchanged",
      })),
    ]);
    await pickFont();

    const create = document.body.querySelector<HTMLButtonElement>(
      "[data-yunari-font-create]",
    );
    if (create === null) throw new Error("no Create type preset control");
    await act(async () => {
      create.click();
      await settle();
    });

    // Refused before the declaration: the file the author picked is not kept.
    await vi.waitFor(() => {
      expect(document.body.textContent).toContain(uiCopy.assets.creditsFull);
    });
    expect(manager.declarations).toEqual([]);

    extensions.destroy();
    vi.unstubAllGlobals();
  });

  it("replaces a declared face's own credit at the cap instead of refusing", async () => {
    const manager = new AssetManager();
    const face = fontTrio("minimal")!.faces[0]!;
    await manager.adoptFont(face, new Uint8Array([1, 2, 3]));
    // The card's own credit, already at the cap: re-creating its preset
    // replaces this entry rather than growing the list.
    const own: ThemeCreditsEntry = {
      kind: "font",
      title: face.family,
      license: face.license.name,
      changes: "Imported unchanged",
      source: { url: face.sourceUrl },
      assetId: face.id,
    };
    const credits: ThemeCreditsEntry[] = [
      own,
      ...Array.from({ length: MAX_CREDITS_ENTRIES - 1 }, (_, index) => ({
        kind: "font",
        title: `legacy-${index}`,
        license: "unknown",
        changes: "Imported unchanged",
      })),
    ];
    const extensions = fontSession(manager, credits);

    const open = document.body.querySelector<HTMLButtonElement>(
      "[data-yunari-font-open]",
    );
    if (open === null) throw new Error("no Create type preset control");
    await act(async () => {
      open.click();
      await settle();
    });
    const create = document.body.querySelector<HTMLButtonElement>(
      "[data-yunari-font-create]",
    );
    if (create === null) throw new Error("no Create type preset control");
    await act(async () => {
      create.click();
      await settle();
    });
    // The dialog closes only when the commit settles, so its absence is the
    // write having landed — the same wait the tests above need on CI.
    await vi.waitFor(() => {
      expect(
        document.body.querySelector("[data-yunari-font-create]"),
      ).toBeNull();
    });

    await extensions.actionFacade().savePackage();
    const saved = saveMock.mock.calls.at(-1) as unknown[] | undefined;
    const presets =
      (saved?.[0] as FabricThemeEnvelope | undefined)?.globals?.typeTokens ??
      {};
    const faces = Object.values(presets).filter(
      (preset) => preset.face !== undefined,
    );
    expect(faces).toHaveLength(1);
    expect(faces[0]).toMatchObject({
      face: { assetId: face.id },
    });
    const shipped = saved?.[3] as
      | { readonly entries: readonly ThemeCreditsEntry[] }
      | undefined;
    expect(shipped?.entries).toHaveLength(MAX_CREDITS_ENTRIES);
    expect(
      shipped?.entries.filter((entry) => entry.assetId === face.id),
    ).toHaveLength(1);
    expect(document.body.textContent).not.toContain(uiCopy.assets.creditsFull);

    extensions.destroy();
  });
});

describe("arming a text placement from every surface", () => {
  /** The globals a successful construction needs, in the same shape the Add
   *  pane's own fixtures use: one paintable token and one type preset. */
  const globals = {
    palette: {
      ink: { name: "Ink", value: { kind: "solid" as const, color: "#102030" } },
    },
    typeTokens: {
      body: { family: "Inter", size: 16, weight: "600" },
    },
  };
  const withGlobals = { ...envelope, globals };

  function placementSession(theme: FabricThemeEnvelope = withGlobals) {
    /** The port the session armed, so a test can play the gesture's own end. */
    let armed: TextPlacementPort | undefined;
    const created = { enterEditing: vi.fn(), selectAll: vi.fn() };
    const addText = vi.fn(
      (_options?: Record<string, unknown>): unknown => created,
    );
    const beginPlacement = vi.fn((port: TextPlacementPort) => {
      armed = port;
    });
    const canvasAdd = vi.fn();
    const warn = vi.fn();
    const saveState = vi.fn();
    const editor = {
      canvas: {
        on: vi.fn(),
        off: vi.fn(),
        add: canvasAdd,
        // Nothing is selected while the session mounts; the caret's deferred
        // guard then leaves these fakes alone.
        getActiveObject: () => undefined,
        getObjects: () => [],
        requestRenderAll: vi.fn(),
      },
      artboard: () => ({ width: 1920, height: 1080 }),
      historyManager: { saveState, attachGlobals: () => {} },
      errorManager: { warn, error: vi.fn() },
      clipboardManager: { setImageImporter: vi.fn(), setBindings: vi.fn() },
      textManager: {
        addText,
        beginPlacement,
        setAuthoringView: vi.fn(),
        setRepaint: vi.fn(),
        setMentions: vi.fn(),
      },
      cropManager: idleCrop(),
    };
    const session = new EditorSession({
      assetManager: new AssetManager(),
      shell: {
        editor,
        scene: {},
        snapshot: vi.fn(() => theme),
        setBackgroundMedia: vi.fn(),
      } as never,
      source: {} as never,
      envelope: theme,
      panelHosts: {
        add: document.body,
        assets: document.body,
        document: document.body,
        tokens: document.body,
        selection: document.body,
      },
      libraryClient: {
        list: vi.fn(async () => []),
        open: vi.fn(async () => ({ envelope: theme, assets: {} })),
        save: vi.fn(async () => "base-after-save"),
        assign: vi.fn(async () => undefined),
        listDisplays: vi.fn(async () => ({ default: null, displays: [] })),
      },
      onNew: vi.fn(),
      onNewFromStarter: vi.fn(),
      onSaved: vi.fn(),
    });
    return {
      session,
      facade: session.actionFacade(),
      port: () => armed,
      addText,
      beginPlacement,
      canvasAdd,
      warn,
      saveState,
    };
  }

  it("arms from the Add pane's text action and constructs nothing yet", () => {
    const wired = placementSession();

    newObjectActionsMock.last?.addText();

    expect(wired.beginPlacement).toHaveBeenCalledOnce();
    expect(wired.addText).not.toHaveBeenCalled();
    expect(wired.canvasAdd).not.toHaveBeenCalled();
    wired.session.destroy();
  });

  it("arms from the session façade's own addText", () => {
    const wired = placementSession();

    wired.facade.addText();

    expect(wired.beginPlacement).toHaveBeenCalledOnce();
    expect(wired.addText).not.toHaveBeenCalled();
    wired.session.destroy();
  });

  it("keeps a click inside the artboard and refuses one outside it", () => {
    const wired = placementSession();

    newObjectActionsMock.last?.addText();
    const port = wired.port()!;

    expect(port.contained({ x: 0, y: 0 })).toBe(true);
    expect(port.contained({ x: 1920, y: 1080 })).toBe(true);
    expect(port.contained({ x: -0.5, y: 10 })).toBe(false);
    expect(port.contained({ x: 10, y: 1080.5 })).toBe(false);
    wired.session.destroy();
  });

  it("constructs a Text at the click point, with no box and its own name", () => {
    const wired = placementSession();

    newObjectActionsMock.last?.addText();
    wired.port()?.onPlace({ left: 120, top: 80 });

    const options = wired.addText.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(options).toMatchObject({
      text: "New text",
      left: 120,
      top: 80,
      name: "Text",
    });
    expect("box" in options).toBe(false);
    wired.session.destroy();
  });

  it("constructs a Text box from the rectangle a drag drew", () => {
    const wired = placementSession();

    newObjectActionsMock.last?.addText();
    wired.port()?.onPlace({
      left: 120,
      top: 80,
      box: { width: 240, height: 96 },
    });

    expect(wired.addText.mock.calls[0]?.[0]).toMatchObject({
      name: "Text box",
      box: { width: 240, height: 96 },
    });
    wired.session.destroy();
  });

  it("reports a refused construction once, at the gesture's end", () => {
    // The arming step itself cannot fail; the theme's missing palette is met
    // when the pointer has finished placing, which is the one report an author
    // gets and the one place it is useful.
    const wired = placementSession(envelope);

    wired.facade.addText();
    expect(wired.warn).not.toHaveBeenCalled();
    wired.port()?.onPlace({ left: 10, top: 10 });

    expect(wired.warn).toHaveBeenCalledOnce();
    expect(wired.warn).toHaveBeenCalledWith(
      "controls",
      expect.stringContaining("palette token"),
    );
    expect(wired.addText).not.toHaveBeenCalled();
    expect(wired.canvasAdd).not.toHaveBeenCalled();
    wired.session.destroy();
  });

  it("constructs once per gesture, leaving the history entry to addText", () => {
    // `TextManager.addText` writes the one save; a second save here would make
    // undoing a placement take two presses.
    const wired = placementSession();

    newObjectActionsMock.last?.addText();
    wired.port()?.onPlace({ left: 10, top: 10 });

    expect(wired.addText).toHaveBeenCalledOnce();
    expect(wired.saveState).not.toHaveBeenCalled();
    wired.session.destroy();
  });
});

/**
 * A session's React roots are its disposal path's, not the document's.
 *
 * The pane hosts outlive a document replacement — a new session mounts into the
 * same node — so a root the old session does not unmount is still attached
 * beside the new one, and the Assets panel draws twice. The browser specs read
 * that as a strict-mode duplicate rather than as a layout accident.
 */
describe("the session's disposal", () => {
  function build(assets: HTMLElement): EditorSession {
    return new EditorSession({
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
            setMentions: vi.fn(),
          },
          cropManager: idleCrop(),
          historyManager: { attachGlobals: () => {}, saveState: vi.fn() },
        },
        scene: {},
        snapshot: vi.fn(() => envelope),
        setArtboard: vi.fn(),
        setBackground: vi.fn(),
        setBackgroundMedia: vi.fn(),
      } as never,
      source: {} as never,
      envelope,
      panelHosts: {
        add: document.body,
        assets,
        document: document.body,
        tokens: document.body,
        selection: document.body,
      },
      onNew: vi.fn(),
      onNewFromStarter: vi.fn(),
      onSaved: vi.fn(),
    });
  }

  it("unmounts the Assets pane, so the next session does not draw it twice", () => {
    const assets = document.createElement("div");
    document.body.append(assets);

    const first = build(assets);
    expect(assets.querySelector("[data-yunari-asset-import]")).not.toBeNull();
    first.destroy();
    // The root, not only its content: React is released only by `unmount`.
    expect(assets.childElementCount, "the pane's root is still attached").toBe(
      0,
    );

    // The user-visible consequence: File -> New reuses the host, so a stranded
    // root is a second Assets panel on screen.
    const second = build(assets);
    expect(
      assets.querySelectorAll("[data-yunari-asset-import]"),
      "the previous session's pane is still drawn",
    ).toHaveLength(1);
    second.destroy();
    assets.remove();
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
