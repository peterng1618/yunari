// @vitest-environment jsdom
import type {
  FabricThemeEnvelopeInput,
  FontCut,
  FontTrioInfo,
} from "@yunari/renderer-core";
import { setObjectAssetReference } from "@yunari/scene-fabric";
import type { ThemeCreditsEntry } from "@yunari/theme-package";
import { type FabricObject, Rect } from "fabric/es";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AssetManager,
  type LocalAssetReference,
} from "./asset-manager/index.js";
import { EditorDocument } from "./editor-document.js";
import type { EditorShell } from "./editor-shell.js";
import type { HistoryGlobalsPort } from "./history-manager/index.js";
import { createNewFabricTheme } from "./new-fabric-theme.js";
import { serializeThemePackage } from "./persist.js";
import { PersistenceManager } from "./persistence-manager/index.js";
import { fontAssetId } from "./type-preset-apply.js";
import type { TypeTokens } from "./type-preset-manager/index.js";
import { uiCopy } from "./ui-copy.js";

/** The host's byte and trash routes, mocked: no document test reaches a real
 *  host. */
const assetBytesMock = vi.hoisted(() => vi.fn());
const trashAssetsMock = vi.hoisted(() => vi.fn());
vi.mock("./asset-finder/client.js", () => ({
  assetBytes: assetBytesMock,
  trashAssets: trashAssetsMock,
}));

/** The cleanup sheet is a React surface with its own suite; here it is the one
 *  answer a save reads. */
const cleanupMock = vi.hoisted(() => vi.fn());
vi.mock("./components/save-cleanup-dialog.js", () => ({
  confirmSaveCleanup: cleanupMock,
}));

/** The replacement question is a modal too, so its answer is injected and the
 *  manager stays the real one. */
const replacementMock = vi.hoisted(() => vi.fn());
vi.mock("./persistence-manager/index.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("./persistence-manager/index.js")>();
  return { ...actual, confirmDocumentReplacement: replacementMock };
});

/** The package writer, recorded without changing what it writes: a cleanup
 *  that only checks its candidate must not compress a package. */
const writeThemePackageMock = vi.hoisted(() => vi.fn());
vi.mock("@yunari/theme-package", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@yunari/theme-package")>();
  return {
    ...actual,
    writeThemePackage: (
      input: Parameters<typeof actual.writeThemePackage>[0],
    ) => {
      writeThemePackageMock();
      return actual.writeThemePackage(input);
    },
  };
});

/**
 * The document's credits collection: what an import adds, what the package it
 * opened seeded, and the one rule that makes it a collection rather than a log.
 *
 * The shell and the consumers are stubs because nothing here fans out: these
 * two methods own a list and the save path reads it.
 */
function documentWith(
  credits?: readonly ThemeCreditsEntry[],
  seams: {
    readonly assetManager?: AssetManager;
    readonly objects?: readonly FabricObject[];
    readonly unsaved?: boolean;
    readonly envelope?: FabricThemeEnvelopeInput;
    readonly onSaved?: (message?: string) => void;
    readonly onError?: (message: string) => void;
  } = {},
): EditorDocument {
  return new EditorDocument({
    source: {
      shell: {
        snapshot: (value: unknown) => value,
        backdrop: () => undefined,
        editor: {
          errorManager: { report: () => {} },
          historyManager: { attachGlobals: () => {} },
          canvas: { getObjects: () => seams.objects ?? [] },
        },
      } as unknown as EditorShell,
      envelope:
        seams.envelope ??
        (createNewFabricTheme() as unknown as FabricThemeEnvelopeInput),
      assetManager: seams.assetManager ?? new AssetManager(),
      ...(credits === undefined ? {} : { credits }),
      ...(seams.unsaved === true ? { unsaved: true } : {}),
      onNew: async () => {},
      onNewFromStarter: async () => {},
      onSaved: seams.onSaved ?? (() => {}),
      ...(seams.onError === undefined ? {} : { onError: seams.onError }),
    },
    consumers: {
      runtime: () => ({ setThemeLanguage: () => {} }),
      selection: () => ({ setLocale: () => {} }),
    } as never,
  });
}

/** A manager declaring these assets, with one byte each, without a browser. */
function managerWith(assets: readonly LocalAssetReference[]): AssetManager {
  const manager = new AssetManager();
  manager.load(
    { assets },
    Object.fromEntries(
      assets.map((asset) => [asset.path, new Uint8Array([1])]),
    ),
  );
  return manager;
}

/** A declaration the release's export check accepts. */
const RELEASABLE_IMAGE: LocalAssetReference = {
  id: "photo",
  kind: "image",
  path: "assets/photo.png",
  sha256: "a".repeat(64),
};

/** The starter without its background and its own declarations: the release
 *  export check reads reachability, and a case about the cleanup question must
 *  not fail on the starter's assets. */
function bareEnvelope(): FabricThemeEnvelopeInput {
  const starter = createNewFabricTheme() as unknown as Record<string, unknown>;
  const { background: _background, assets: _assets, ...bare } = starter;
  return bare as unknown as FabricThemeEnvelopeInput;
}

function imageAsset(id: string): LocalAssetReference {
  return { id, kind: "image", path: `assets/${id}.png`, sha256: "0" };
}

function placedObject(assetId: string): FabricObject {
  const object = new Rect();
  setObjectAssetReference(object, { assetId, kind: "image" });
  return object;
}

const entry = (title: string, url: string): ThemeCreditsEntry => ({
  kind: "icon",
  title,
  license: "ISC",
  changes: "Imported unchanged",
  source: { url },
});

describe("EditorDocument credits", () => {
  it("adds each import's attribution, in arrival order", () => {
    const document = documentWith();
    expect(document.credits()).toEqual([]);

    document.addCredit(entry("house", "https://lucide.dev/icons/house"));
    document.addCredit(entry("star", "https://lucide.dev/icons/star"));

    expect(document.credits().map((credit) => credit.title)).toEqual([
      "house",
      "star",
    ]);
  });

  it("replaces the credit for the same source item rather than listing it twice", () => {
    const document = documentWith();
    document.addCredit(entry("house", "https://lucide.dev/icons/house"));
    document.addCredit({
      ...entry("house", "https://lucide.dev/icons/house"),
      license: "ISC v2",
    });

    expect(document.credits()).toHaveLength(1);
    expect(document.credits()[0]?.license).toBe("ISC v2");
  });

  it("keeps two assets' credits apart, and replaces one asset's own", () => {
    // Pruning names an asset id, so a credit that survived a re-import under
    // another asset's identity would be removed for the wrong asset.
    const document = documentWith();
    const assetA: ThemeCreditsEntry = {
      ...entry("house", "https://lucide.dev/icons/house"),
      assetId: "asset-a",
    };
    const assetB: ThemeCreditsEntry = { ...assetA, assetId: "asset-b" };
    document.addCredit(assetA);
    document.addCredit(assetB);
    expect(document.credits().map((credit) => credit.assetId)).toEqual([
      "asset-a",
      "asset-b",
    ]);

    document.addCredit({ ...assetB, license: "ISC v2" });
    expect(document.credits()).toEqual([
      assetA,
      { ...assetB, license: "ISC v2" },
    ]);
  });

  it("refuses the entry past the package's own cap, but not a repeat", () => {
    const document = documentWith();
    const first = entry("icon-0", "https://lucide.dev/icons/icon-0");
    document.addCredit(first);
    for (let index = 1; index < 256; index += 1) {
      document.addCredit(
        entry(`icon-${index}`, `https://lucide.dev/icons/${index}`),
      );
    }

    // The writer refuses a 257th entry, so the collection stops one short.
    expect(document.canAddCredit(entry("one-more", "https://x.test/1"))).toBe(
      false,
    );
    // An item already credited is a replacement, which never grows the list.
    expect(document.canAddCredit(first)).toBe(true);
  });

  it("seeds the collection from the package it opened", () => {
    const seeded = entry("house", "https://lucide.dev/icons/house");
    const document = documentWith([seeded]);

    expect(document.credits()).toEqual([seeded]);
  });

  it("prunes bytes, declarations and the linked credit", async () => {
    const asset = imageAsset("photo");
    const assetManager = managerWith([asset]);
    const linked: ThemeCreditsEntry = {
      ...entry("photo", "https://example.test/photo"),
      assetId: "photo",
    };
    const document = documentWith(
      [linked, entry("house", "https://lucide.dev/icons/house")],
      { assetManager },
    );
    const changed = vi.fn();
    document.subscribeDocumentChange(changed);

    document.pruneAssets(document.unusedAssets().map((unused) => unused.id));

    expect(assetManager.declarations).toEqual([]);
    expect(assetManager.assets).toEqual({});
    expect(document.credits().map((credit) => credit.title)).toEqual(["house"]);
    // One prune is one whole announcement: a batch of them in one task reaches
    // its listeners once, on the flush.
    await Promise.resolve();
    expect(changed).toHaveBeenCalledTimes(1);
    document.destroy();
  });

  it("keeps a credit with no assetId", () => {
    const assetManager = managerWith([imageAsset("photo"), imageAsset("logo")]);
    const unlinked = entry("house", "https://lucide.dev/icons/house");
    const linked: ThemeCreditsEntry = {
      ...entry("logo", "https://example.test/logo"),
      assetId: "logo",
    };
    const document = documentWith([unlinked, linked], {
      assetManager,
      objects: [placedObject("logo")],
    });

    document.pruneAssets(["photo"]);

    // The unlinked credit has nothing to match, and the linked one names an
    // asset that is still on the canvas — neither follows the pruned photo.
    expect(assetManager.declarations.map((asset) => asset.id)).toEqual([
      "logo",
    ]);
    expect(assetManager.assets["assets/logo.png"]).toEqual(new Uint8Array([1]));
    expect(document.credits()).toEqual([unlinked, linked]);
    document.destroy();
  });

  it("leaves a requested asset alone while the scene still references it", () => {
    // The save dialog's list can be stale by the time the author confirms: an
    // asset that was unused when it was asked can be placed before the prune.
    const assetManager = managerWith([imageAsset("logo")]);
    const document = documentWith(undefined, {
      assetManager,
      objects: [placedObject("logo")],
    });
    const changed = vi.fn();
    document.subscribeDocumentChange(changed);

    document.pruneAssets(["logo"]);

    expect(assetManager.declarations.map((asset) => asset.id)).toEqual([
      "logo",
    ]);
    expect(assetManager.assets["assets/logo.png"]).toEqual(new Uint8Array([1]));
    expect(changed).not.toHaveBeenCalled();
    document.destroy();
  });
});

describe("EditorDocument asset truth", () => {
  it("ships no declarations once the last one is pruned, and still packages", () => {
    // An opened package's envelope carries its declarations; the manager is the
    // live list. Spreading the envelope when the live list is empty resurrects
    // the file the author just removed.
    const photo: LocalAssetReference = {
      ...imageAsset("photo"),
      sha256: "0".repeat(64),
    };
    const assetManager = managerWith([photo]);
    const document = documentWith(undefined, {
      assetManager,
      envelope: {
        ...bareEnvelope(),
        assets: [...assetManager.declarations],
      } as unknown as FabricThemeEnvelopeInput,
    });

    document.pruneAssets([photo.id]);

    expect(document.snapshot().assets).toEqual([]);
    // The same serializer the save path uses: a stale declaration is exactly
    // the refusal that left the files already in the Recycle Bin.
    expect(serializeThemePackage(document.snapshot(), {})).toMatchObject({
      ok: true,
    });
    document.destroy();
  });
});

describe("EditorDocument save cleanup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("does not ask when there is nothing unused", async () => {
    // A cleanup answer that would stop the save, so a save that wrote anyway is
    // the proof the question was never asked.
    cleanupMock.mockResolvedValue("cancel");
    const save = vi
      .spyOn(PersistenceManager.prototype, "save")
      .mockResolvedValue(undefined);
    const onSaved = vi.fn();
    const document = documentWith(undefined, { onSaved });

    await document.save();

    expect(cleanupMock).not.toHaveBeenCalled();
    expect(save).toHaveBeenCalledTimes(1);
    expect(onSaved).toHaveBeenCalledWith("Theme package saved");
    document.destroy();
  });

  it("cancel writes nothing and keeps the file", async () => {
    const assetManager = managerWith([imageAsset("photo")]);
    const onSaved = vi.fn();
    cleanupMock.mockResolvedValue("cancel");
    const save = vi
      .spyOn(PersistenceManager.prototype, "save")
      .mockResolvedValue(undefined);
    const document = documentWith(undefined, { assetManager, onSaved });

    await document.save();

    expect(cleanupMock).toHaveBeenCalledWith(
      expect.objectContaining({
        title: uiCopy.file.savePackage,
        documentName: "System dashboard",
        files: [
          expect.objectContaining({
            name: "photo.png",
            kind: "image",
            sizeBytes: 1,
            reason: uiCopy.saveCleanup.reason.image,
            previewUrl: expect.stringMatching(/^blob:/),
          }),
        ],
        themeBytes: expect.any(Number),
      }),
    );
    expect(save).not.toHaveBeenCalled();
    expect(onSaved).not.toHaveBeenCalled();
    expect(assetManager.declarations.map((asset) => asset.id)).toEqual([
      "photo",
    ]);
    document.destroy();
  });

  it("keep saves and keeps the assets and their credits", async () => {
    const assetManager = managerWith([imageAsset("photo")]);
    const linked: ThemeCreditsEntry = {
      ...entry("photo", "https://example.test/photo"),
      assetId: "photo",
    };
    cleanupMock.mockResolvedValue("keep");
    const save = vi
      .spyOn(PersistenceManager.prototype, "save")
      .mockResolvedValue(undefined);
    const document = documentWith([linked], { assetManager });

    await document.save();

    expect(save).toHaveBeenCalledTimes(1);
    const [current, assets] = save.mock.calls[0] ?? [];
    expect(current?.assets?.map((asset) => asset.id)).toEqual(["photo"]);
    expect(Object.keys(assets ?? {})).toEqual(["assets/photo.png"]);
    expect(assetManager.declarations.map((asset) => asset.id)).toEqual([
      "photo",
    ]);
    expect(document.credits()).toEqual([linked]);
    document.destroy();
  });

  it("remove trashes then prunes, and saves without the file", async () => {
    const assetManager = managerWith([imageAsset("photo")]);
    const linked: ThemeCreditsEntry = {
      ...entry("photo", "https://example.test/photo"),
      assetId: "photo",
    };
    const unlinked = entry("house", "https://lucide.dev/icons/house");
    cleanupMock.mockResolvedValue("remove");
    trashAssetsMock.mockResolvedValue({ ok: true });
    const save = vi
      .spyOn(PersistenceManager.prototype, "save")
      .mockResolvedValue(undefined);
    const document = documentWith([linked, unlinked], {
      assetManager,
      envelope: bareEnvelope(),
    });

    await document.save();

    expect(trashAssetsMock).toHaveBeenCalledWith([
      { name: "photo.png", bytes: new Uint8Array([1]) },
    ]);
    expect(assetManager.declarations).toEqual([]);
    expect(document.credits()).toEqual([unlinked]);
    expect(save).toHaveBeenCalledTimes(1);
    // A valid candidate used to be compressed only to be discarded; the check
    // answers the asset rule without the writer ever running.
    expect(writeThemePackageMock).not.toHaveBeenCalled();
    const [current, assets] = save.mock.calls[0] ?? [];
    expect(current?.assets?.map((asset) => asset.id)).not.toContain("photo");
    expect(assets).toEqual({});
    document.destroy();
  });

  it("refuses before trashing when the post-prune package would not build", async () => {
    // A package the serializer refuses must cost nothing but the refusal: the
    // trash move is ordered last, after the cleanup's own result is buildable.
    const photo: LocalAssetReference = {
      ...imageAsset("photo"),
      sha256: "0".repeat(64),
    };
    const broken: LocalAssetReference = {
      ...imageAsset("logo"),
      sha256: "0".repeat(64),
    };
    const assetManager = new AssetManager();
    // `logo` is still referenced and has no bytes; pruning the unused `photo`
    // leaves a declaration the serializer cannot match.
    assetManager.load(
      { assets: [photo, broken] },
      { "assets/photo.png": new Uint8Array([1]) },
    );
    const onError = vi.fn();
    cleanupMock.mockResolvedValue("remove");
    trashAssetsMock.mockResolvedValue({ ok: true });
    const save = vi
      .spyOn(PersistenceManager.prototype, "save")
      .mockResolvedValue(undefined);
    const document = documentWith(undefined, {
      assetManager,
      objects: [placedObject("logo")],
      envelope: bareEnvelope(),
      onError,
    });

    await document.save();

    expect(trashAssetsMock).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledWith(
      "Package assets must exactly match the theme declaration.",
    );
    expect(assetManager.declarations.map((asset) => asset.id)).toEqual([
      "photo",
      "logo",
    ]);
    expect(assetManager.assets["assets/photo.png"]).toEqual(
      new Uint8Array([1]),
    );
    document.destroy();
  });

  it("a refused trash aborts the save and reports the host's own sentence", async () => {
    const assetManager = managerWith([imageAsset("photo")]);
    const linked: ThemeCreditsEntry = {
      ...entry("photo", "https://example.test/photo"),
      assetId: "photo",
    };
    const onSaved = vi.fn();
    const onError = vi.fn();
    cleanupMock.mockResolvedValue("remove");
    trashAssetsMock.mockResolvedValue({
      ok: false,
      message: "The Recycle Bin is not available on this machine.",
    });
    const save = vi
      .spyOn(PersistenceManager.prototype, "save")
      .mockResolvedValue(undefined);
    const document = documentWith([linked], {
      assetManager,
      envelope: bareEnvelope(),
      onSaved,
      onError,
    });

    await document.save();

    expect(onError).toHaveBeenCalledWith(
      "The Recycle Bin is not available on this machine.",
    );
    expect(save).not.toHaveBeenCalled();
    expect(onSaved).not.toHaveBeenCalled();
    // Nothing pruned: the declaration, its bytes and its credit are all there.
    expect(assetManager.declarations.map((asset) => asset.id)).toEqual([
      "photo",
    ]);
    expect(assetManager.assets["assets/photo.png"]).toEqual(
      new Uint8Array([1]),
    );
    expect(document.credits()).toEqual([linked]);
    document.destroy();
  });

  it("does not announce a release whose cleanup was cancelled", async () => {
    // A valid declaration, so the release's own export check passes and the
    // cancelled cleanup is the only thing that stops the write.
    const assetManager = managerWith([RELEASABLE_IMAGE]);
    const onSaved = vi.fn();
    const onError = vi.fn();
    cleanupMock.mockResolvedValue("cancel");
    const save = vi
      .spyOn(PersistenceManager.prototype, "save")
      .mockResolvedValue(undefined);
    vi.spyOn(window, "prompt").mockReturnValue("patch");
    const document = documentWith(undefined, {
      assetManager,
      envelope: bareEnvelope(),
      onSaved,
      onError,
    });
    // The version bump alone makes it dirty, so the state before the release is
    // the control: the guard must not report a release that never wrote.
    expect(document.isDirty()).toBe(false);

    await document.release();

    expect(onError.mock.calls).toEqual([]);
    expect(save).not.toHaveBeenCalled();
    expect(onSaved).not.toHaveBeenCalled();
    expect(document.isDirty()).toBe(true);
    document.destroy();
  });

  it("announces a release that was actually written", async () => {
    const assetManager = managerWith([RELEASABLE_IMAGE]);
    const onSaved = vi.fn();
    cleanupMock.mockResolvedValue("keep");
    // A save writes its snapshot back, which is what clears the dirty state; the
    // real method is what the guard re-reads.
    const markSaved = vi.spyOn(PersistenceManager.prototype, "markSaved");
    const save = vi
      .spyOn(PersistenceManager.prototype, "save")
      .mockImplementation(async (theme, assets) => {
        // The instance the document called is the one whose saved baseline
        // moves, which is the state `release()` re-reads.
        const instance = save.mock.contexts.at(-1) as
          | PersistenceManager
          | undefined;
        instance?.markSaved(theme, assets);
      });
    vi.spyOn(window, "prompt").mockReturnValue("patch");
    const document = documentWith(undefined, {
      assetManager,
      envelope: bareEnvelope(),
      onSaved,
    });

    await document.release();

    expect(save).toHaveBeenCalledTimes(1);
    expect(markSaved).toHaveBeenCalledTimes(1);
    expect(onSaved).toHaveBeenCalledWith("Released 0.1.0");
    expect(document.isDirty()).toBe(false);
    document.destroy();
  });

  it("a replacement's save asks too, and a cancel aborts the replacement", async () => {
    const assetManager = managerWith([imageAsset("photo")]);
    const onError = vi.fn();
    replacementMock.mockResolvedValue("save");
    cleanupMock.mockResolvedValue("cancel");
    const save = vi
      .spyOn(PersistenceManager.prototype, "save")
      .mockResolvedValue(undefined);
    const document = documentWith(undefined, {
      assetManager,
      unsaved: true,
      onError,
    });

    expect(await document.confirmReplacement()).toBe(false);

    expect(cleanupMock).toHaveBeenCalledWith(
      expect.objectContaining({
        title: uiCopy.file.savePackage,
        documentName: "System dashboard",
        files: [
          expect.objectContaining({
            name: "photo.png",
            kind: "image",
            sizeBytes: 1,
            reason: uiCopy.saveCleanup.reason.image,
            previewUrl: expect.stringMatching(/^blob:/),
          }),
        ],
        themeBytes: expect.any(Number),
      }),
    );
    expect(save).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
    expect(assetManager.declarations.map((asset) => asset.id)).toEqual([
      "photo",
    ]);
    document.destroy();
  });

  it("a refused trash aborts a replacement's save", async () => {
    const assetManager = managerWith([imageAsset("photo")]);
    const onError = vi.fn();
    replacementMock.mockResolvedValue("save");
    cleanupMock.mockResolvedValue("remove");
    trashAssetsMock.mockResolvedValue({
      ok: false,
      message: "The Recycle Bin refused it.",
    });
    const save = vi
      .spyOn(PersistenceManager.prototype, "save")
      .mockResolvedValue(undefined);
    const document = documentWith(undefined, {
      assetManager,
      envelope: bareEnvelope(),
      unsaved: true,
      onError,
    });

    expect(await document.confirmReplacement()).toBe(false);

    expect(onError).toHaveBeenCalledWith("The Recycle Bin refused it.");
    expect(save).not.toHaveBeenCalled();
    expect(assetManager.declarations.map((asset) => asset.id)).toEqual([
      "photo",
    ]);
    document.destroy();
  });
});

describe("EditorDocument globals commits", () => {
  it("records the discrete globals commits and leaves the live palette samples alone", () => {
    // A live colour gesture publishes per sample and records once at its settle
    // callback, so saving inside `setPalette` would make every sample an entry.
    // The discrete commits have no gesture to settle: they are an entry the
    // moment they are written, or they are unundoable and a later undo reverts
    // them silently.
    const saveState = vi.fn();
    const document = new EditorDocument({
      source: {
        shell: {
          snapshot: (value: unknown) => value,
          setGlobals: vi.fn(),
          setBackground: vi.fn(),
          editor: {
            errorManager: { report: () => {} },
            historyManager: { attachGlobals: () => {}, saveState },
            canvas: { getObjects: () => [] },
          },
        } as unknown as EditorShell,
        envelope: createNewFabricTheme() as unknown as FabricThemeEnvelopeInput,
        assetManager: new AssetManager(),
        onNew: async () => {},
        onNewFromStarter: async () => {},
        onSaved: () => {},
      },
      consumers: {
        palette: () => ({ render: () => {} }),
        types: () => ({ render: () => {} }),
        runtime: () => ({ setGlobals: () => {} }),
        charts: () => ({
          setGlobals: () => {},
          reassignPaletteReferences: () => {},
        }),
        newObjects: () => ({ setGlobals: () => {} }),
        selection: () => ({ setGlobals: () => {} }),
      } as never,
    });

    document.setPalette({
      accent: {
        name: "Accent",
        value: { kind: "solid", color: "rgb(200 0 0)" },
      },
    } as never);
    expect(
      saveState,
      "a live palette sample waits for its settle",
    ).not.toHaveBeenCalled();

    document.setTypes({});
    expect(saveState).toHaveBeenCalledTimes(1);

    document.deleteType("type", "other");
    expect(saveState).toHaveBeenCalledTimes(2);

    document.deletePalette("accent", "none");
    expect(saveState).toHaveBeenCalledTimes(3);
    document.destroy();
  });
});

describe("EditorDocument's unsaved mark", () => {
  it("reads the document once per change, however many surfaces ask", () => {
    // Three subscribers ask on every document change — the identity chip, the
    // status line and the publish control — and each read used to serialise and
    // validate the whole scene. A live palette sample during a picker drag pays
    // that for every pointer move, which is what made the drag sluggish.
    const snapshot = vi.fn((value: unknown) => value);
    const document = new EditorDocument({
      source: {
        shell: {
          snapshot,
          setGlobals: vi.fn(),
          setBackground: vi.fn(),
          editor: {
            errorManager: { report: () => {} },
            historyManager: { attachGlobals: () => {}, saveState: vi.fn() },
            canvas: { getObjects: () => [] },
          },
        } as unknown as EditorShell,
        envelope: createNewFabricTheme() as unknown as FabricThemeEnvelopeInput,
        assetManager: new AssetManager(),
        onNew: async () => {},
        onNewFromStarter: async () => {},
        onSaved: () => {},
      },
      consumers: {
        palette: () => ({ render: () => {} }),
        types: () => ({ render: () => {} }),
        runtime: () => ({ setGlobals: () => {} }),
        charts: () => ({
          setGlobals: () => {},
          reassignPaletteReferences: () => {},
        }),
        newObjects: () => ({ setGlobals: () => {} }),
        selection: () => ({ setGlobals: () => {} }),
      } as never,
    });
    snapshot.mockClear();

    document.isDirty();
    document.isDirty();
    document.isDirty();
    expect(
      snapshot,
      "three readers of one change read the scene once",
    ).toHaveBeenCalledTimes(1);

    document.setPalette({
      accent: {
        name: "Accent",
        value: { kind: "solid", color: "rgb(200 0 0)" },
      },
    } as never);
    document.isDirty();
    document.isDirty();
    expect(
      snapshot,
      "and the next change recomputes exactly once",
    ).toHaveBeenCalledTimes(2);
    document.destroy();
  });
});

describe("EditorDocument undo", () => {
  it("re-renders the types panel when an undo restores the globals", () => {
    let port: HistoryGlobalsPort | undefined;
    const typesRender = vi.fn();
    const setGlobals = vi.fn();
    const document = new EditorDocument({
      source: {
        shell: {
          snapshot: (value: unknown) => value,
          setGlobals,
          editor: {
            errorManager: { report: () => {} },
            historyManager: {
              attachGlobals: (attached: HistoryGlobalsPort) => {
                port = attached;
              },
            },
          },
        } as unknown as EditorShell,
        envelope: createNewFabricTheme() as unknown as FabricThemeEnvelopeInput,
        assetManager: new AssetManager(),
        onNew: async () => {},
        onNewFromStarter: async () => {},
        onSaved: () => {},
      },
      consumers: {
        palette: () => ({ render: () => {} }),
        types: () => ({ render: typesRender }),
        runtime: () => ({ setGlobals }),
        charts: () => ({ setGlobals }),
        newObjects: () => ({ setGlobals }),
        selection: () => ({ setGlobals }),
      } as never,
    });
    if (port === undefined) throw new Error("no globals port was attached");

    // A type-preset edit records an entry, so undo restores the whole bag: the
    // envelope would hold the old presets while the pane still drew the new.
    const presets = { heading: { name: "Heading", value: {} } } as never;
    port.write({ typeTokens: presets });

    expect(typesRender).toHaveBeenCalledWith(presets);
    document.destroy();
  });
});

/** A document whose only state is its type presets, with stubs for the fan-out
 *  `setTypes` performs. */
function presetDocument(presets: TypeTokens): {
  readonly document: EditorDocument;
  readonly onError: ReturnType<typeof vi.fn>;
  readonly saveState: ReturnType<typeof vi.fn>;
} {
  const onError = vi.fn();
  const saveState = vi.fn();
  const document = new EditorDocument({
    source: {
      shell: {
        snapshot: (value: unknown) => value,
        setGlobals: vi.fn(),
        editor: {
          errorManager: { report: () => {} },
          historyManager: { attachGlobals: () => {}, saveState },
        },
      } as unknown as EditorShell,
      envelope: {
        ...createNewFabricTheme(),
        globals: { typeTokens: presets },
      } as unknown as FabricThemeEnvelopeInput,
      assetManager: new AssetManager(),
      onNew: async () => {},
      onNewFromStarter: async () => {},
      onSaved: () => {},
      onError,
    },
    consumers: {
      palette: () => ({ render: () => {} }),
      types: () => ({ render: () => {} }),
      runtime: () => ({ setGlobals: () => {} }),
      charts: () => ({ setGlobals: () => {} }),
      newObjects: () => ({ setGlobals: () => {} }),
      selection: () => ({ setGlobals: () => {} }),
    } as never,
  });
  return { document, onError, saveState };
}

function cutFor(
  role: "heading" | "body" | "mono",
  family: string,
  weight: number,
): FontCut {
  const url = `https://example.test/${role}.woff2`;
  return {
    id: `cut:${role}-${weight}`,
    source: "google-fonts",
    family,
    weight,
    style: "normal",
    subset: "latin",
    format: "woff2",
    previewUrl: url,
    licence: "OFL",
    sourceUrl: url,
  };
}

const trio: FontTrioInfo = {
  id: "fixture",
  name: "Fixture",
  description: "",
  roles: {
    heading: cutFor("heading", "Manrope", 700),
    body: cutFor("body", "Inter", 400),
    mono: cutFor("mono", "Fira Code", 400),
  },
};

function presetsOf(document: EditorDocument): TypeTokens {
  return document.snapshot().globals?.typeTokens as TypeTokens;
}

describe("EditorDocument preset actions", () => {
  it("apply rewrites role tokens, keeps an unroled token and creates a missing role", async () => {
    const authored: TypeTokens = {
      heading: { family: "Segoe UI" },
      body: { family: "Segoe UI" },
      custom: { family: "Georgia" },
    };
    const { document } = presetDocument(authored);
    assetBytesMock.mockResolvedValue({
      bytes: new Uint8Array([1, 2, 3]),
      filename: "face.woff2",
    });

    await document.applyFontTrio(trio);

    const written = presetsOf(document);
    // A role token is rewritten to the trio's face; a token whose id is not a
    // role is not touched.
    expect(written.heading).toEqual({
      family: "Manrope",
      weight: 700,
      face: { assetId: fontAssetId(trio.roles.heading!) },
    });
    expect(written.body).toEqual({
      family: "Inter",
      weight: 400,
      face: { assetId: fontAssetId(trio.roles.body!) },
    });
    expect(written.custom).toEqual(authored.custom);
    expect(written.mono).toEqual({
      family: "Fira Code",
      weight: 400,
      face: { assetId: fontAssetId(trio.roles.mono!) },
    });
    // Bytes are addressed by the cut's source and id, never the trio's.
    expect(assetBytesMock).toHaveBeenCalledWith(
      "google-fonts",
      "cut:heading-700",
    );
    document.destroy();
  });

  it("add three creates the missing role tokens and leaves an existing role alone", async () => {
    const existing: TypeTokens = {
      heading: { family: "Segoe UI" },
      custom: { family: "Georgia" },
    };
    const { document } = presetDocument(existing);
    assetBytesMock.mockResolvedValue({
      bytes: new Uint8Array([1]),
      filename: "face.woff2",
    });

    await document.addTypeTokensFromTrio(trio);

    const written = presetsOf(document);
    // A role is the token's id: the heading already exists, so there is no
    // second id to mint and no `heading-2` unroled token.
    expect(written.heading).toEqual(existing.heading);
    expect(written["heading-2"]).toBeUndefined();
    expect(written.custom).toEqual(existing.custom);
    expect(written.body).toEqual({
      family: "Inter",
      weight: 400,
      face: { assetId: fontAssetId(trio.roles.body!) },
    });
    expect(written.mono).toEqual({
      family: "Fira Code",
      weight: 400,
      face: { assetId: fontAssetId(trio.roles.mono!) },
    });
    document.destroy();
  });

  it("a single cut creates a role-first token", async () => {
    const { document } = presetDocument({});
    assetBytesMock.mockResolvedValue({
      bytes: new Uint8Array([1]),
      filename: "code.woff2",
    });

    const id = await document.addTypeTokenFromCut(
      cutFor("mono", "Fira Code", 400),
      "mono",
    );

    expect(id).toBe("mono");
    expect(presetsOf(document).mono).toEqual({
      family: "Fira Code",
      weight: 400,
      face: { assetId: fontAssetId(trio.roles.mono!) },
    });
    expect(assetBytesMock).toHaveBeenCalledWith("google-fonts", "cut:mono-400");
    document.destroy();
  });

  it("a cut with no role takes a free unroled id", async () => {
    const { document } = presetDocument({});
    assetBytesMock.mockResolvedValue({
      bytes: new Uint8Array([1]),
      filename: "body.woff2",
    });

    const id = await document.addTypeTokenFromCut(
      cutFor("body", "Inter", 400),
      null,
    );

    // No role chosen means no role id: `body` is the Body token, and minting a
    // second `body-2` would read as a second role.
    expect(id).toBe("type");
    const value = presetsOf(document).type;
    expect(value).toMatchObject({ family: "Inter", weight: 400 });
    document.destroy();
  });

  it("points at an existing face instead of adding a duplicate token", async () => {
    const authored: TypeTokens = {
      body: { family: "Inter", weight: 400 },
    };
    const { document, saveState } = presetDocument(authored);
    saveState.mockClear();
    assetBytesMock.mockClear();

    const id = await document.addTypeTokenFromCut(
      cutFor("body", "Inter", 400),
      null,
    );

    // Two tokens with the same family and weight would compute one name, so
    // the add is refused and the existing token is the answer. Nothing is
    // written and no bytes are adopted.
    expect(id).toBe("body");
    expect(presetsOf(document)).toEqual(authored);
    expect(saveState).not.toHaveBeenCalled();
    expect(assetBytesMock).not.toHaveBeenCalled();
    document.destroy();
  });

  it("a failed host bytes read writes nothing and reports the failure", async () => {
    const authored: TypeTokens = {
      body: { family: "Segoe UI" },
    };
    const { document, onError } = presetDocument(authored);
    const before = document.snapshot();
    // The heading read succeeds; the body read is the one the host drops. No
    // adoption may survive that, because a half-applied trio is a theme the
    // author never chose.
    assetBytesMock
      .mockResolvedValueOnce({
        bytes: new Uint8Array([1]),
        filename: "h.woff2",
      })
      .mockResolvedValueOnce(undefined)
      .mockResolvedValue({ bytes: new Uint8Array([2]), filename: "m.woff2" });

    await document.runFontAction(() => document.applyFontTrio(trio));

    expect(onError).toHaveBeenCalledWith(expect.stringContaining("Inter"));
    expect(presetsOf(document)).toEqual(authored);
    expect(document.snapshot().assets).toEqual(before.assets);
    document.destroy();
  });

  it("applies a cut to the selected token and keeps the rest of it", async () => {
    const authored: TypeTokens = {
      metric: { family: "Segoe UI", weight: "500" },
    };
    const { document, saveState } = presetDocument(authored);
    saveState.mockClear();
    const cut = cutFor("heading", "Manrope", 700);
    assetBytesMock.mockResolvedValue({
      bytes: new Uint8Array([9]),
      filename: "manrope.woff2",
    });

    await document.applyCutToPreset("metric", cut);

    // The explicit target keeps what the author set; only the face treatment
    // moves, and the write is one history entry.
    expect(presetsOf(document).metric).toEqual({
      family: "Manrope",
      weight: 700,
      face: { assetId: fontAssetId(cut) },
    });
    expect(saveState).toHaveBeenCalledTimes(1);
    document.destroy();
  });

  it("brings the family's other weights with the chosen cut", async () => {
    const authored: TypeTokens = {
      metric: { family: "Segoe UI", weight: "500" },
    };
    const { document } = presetDocument(authored);
    const light = cutFor("body", "Manrope", 400);
    const bold = cutFor("body", "Manrope", 700);
    assetBytesMock.mockResolvedValue({
      bytes: new Uint8Array([7]),
      filename: "manrope.woff2",
    });

    await document.applyCutToPreset("metric", light, [light, bold]);

    // Both faces are declared, so the preset's weight field can draw either;
    // the preset itself keeps the weight the author picked.
    expect(assetBytesMock).toHaveBeenCalledTimes(2);
    expect(presetsOf(document).metric).toMatchObject({
      family: "Manrope",
      weight: 400,
    });

    assetBytesMock.mockClear();
    await document.applyCutToPreset("metric", bold, [light, bold]);
    expect(assetBytesMock).not.toHaveBeenCalled();
    document.destroy();
  });

  it("one apply declares every weight and subset of the family, once", async () => {
    const authored: TypeTokens = {
      metric: { family: "Segoe UI", weight: "500" },
    };
    const { document } = presetDocument(authored);
    const family = [400, 700, 900].flatMap((weight) =>
      ["latin", "vietnamese"].map((subset) => ({
        ...cutFor("body", "Manrope", weight),
        id: `cut:manrope-${subset}-${weight}`,
        subset,
      })),
    );
    assetBytesMock.mockResolvedValue({
      bytes: new Uint8Array([7]),
      filename: "manrope.woff2",
    });

    await document.applyCutToPreset("metric", family[0]!, family);

    // Three weights × two subsets: every face the family published, each read
    // once, so the weight field and the Vietnamese subset both resolve.
    expect(assetBytesMock).toHaveBeenCalledTimes(6);
    expect(assetBytesMock.mock.calls.map((call) => call[1])).toEqual(
      family.map((entry) => entry.id),
    );
    expect((document.snapshot().assets ?? []).map((asset) => asset.id)).toEqual(
      family.map((entry) => fontAssetId(entry)),
    );

    // The declarations are the only dedupe: a second apply from the same
    // family asks the host for nothing.
    assetBytesMock.mockClear();
    await document.applyCutToPreset("metric", family[3]!, family);
    expect(assetBytesMock).not.toHaveBeenCalled();
    document.destroy();
  });

  it("a family read the host drops declares nothing", async () => {
    const authored: TypeTokens = {
      metric: { family: "Segoe UI", weight: "500" },
    };
    const { document, onError } = presetDocument(authored);
    const before = document.snapshot();
    const family = [400, 700].map((weight) => ({
      ...cutFor("body", "Manrope", weight),
      id: `cut:manrope-latin-${weight}`,
    }));
    // The first read succeeds and the second is the one the host drops: no
    // adoption may survive that, even though the first bytes already arrived.
    assetBytesMock
      .mockResolvedValueOnce({
        bytes: new Uint8Array([7]),
        filename: "a.woff2",
      })
      .mockResolvedValueOnce(undefined);

    await document.runFontAction(() =>
      document.applyCutToPreset("metric", family[0]!, family),
    );

    expect(onError).toHaveBeenCalledWith(expect.stringContaining("Manrope"));
    expect(presetsOf(document)).toEqual(authored);
    expect(document.snapshot().assets).toEqual(before.assets);
    document.destroy();
  });

  it("unbinding leaves family and weight editable", async () => {
    const { document } = presetDocument({
      heading: {
        family: "Manrope",
        weight: 700,
        face: { assetId: "face-id" },
      },
    });

    document.unbindPresetFace("heading");

    const value = presetsOf(document).heading;
    expect(value === undefined ? true : "face" in value).toBe(false);
    expect(value).toMatchObject({ family: "Manrope", weight: 700 });
    document.destroy();
  });
});
