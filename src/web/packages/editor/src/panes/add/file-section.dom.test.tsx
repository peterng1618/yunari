// @vitest-environment jsdom

/**
 * The Add pane's file section: the declared-asset library the Assets pane used
 * to be.
 *
 * **The list is the declarations, not the placed objects.** That is the whole
 * rule the four cases below are about: an image or an SVG is declared *and*
 * placed, a video or a font is declared only, and both are listed — a font
 * imported once stays removable, and a video the artboard paints as background
 * media stays reachable. A list built from what is on the canvas keeps the
 * placeable files and silently loses the rest.
 *
 * **Replace acts on the chosen asset, never on the shown object.** Choosing a
 * row and swapping its bytes re-points every use of that id; the capability the
 * old panel only ever *claimed* — re-pointing one selected image — is not what
 * this is, and the case below says so.
 */
import { setObjectAssetReference } from "@yunari/scene-fabric";
import { FabricImage, Group } from "fabric/es";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  type Mock,
  vi,
} from "vitest";
import {
  ASSET_FILE_EXTENSIONS,
  AssetManager,
  type LocalAssetReference,
} from "../../asset-manager/index.js";
import type { EditorInteraction } from "../../editor-interaction.js";
import { uiCopy } from "../../ui-copy.js";
import { FileSection } from "./file-section.js";

// Base UI's select popup needs three browser APIs jsdom has none of — the same
// three `paint-list.dom.test.tsx` supplies, for the same reason.
globalThis.ResizeObserver ??= class {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
} as never;
Element.prototype.getAnimations ??= (): never[] => [];
window.PointerEvent ??= MouseEvent as never;

// React only flushes work scheduled inside `act` when it has been told it is in
// a test; without this, `act` warns and the update lands after the assertion.
(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

beforeAll(() => {
  const matches = Element.prototype.matches;
  Element.prototype.matches = Object.assign(function (
    this: Element,
    selector: string,
  ): boolean {
    if (selector === ":modal" || selector === ":popover-open") return false;
    return matches.call(this, selector);
  }, matches);
});

/**
 * The root the current case mounted, so it is unmounted rather than only
 * detached.
 *
 * The control set's popup is portalled to `body`, and a root left mounted can
 * re-commit that portal into the next case's document — `paint-list.dom.test.tsx`
 * unmounts for the same reason.
 */
let root: Root | undefined;

afterEach(async () => {
  if (root !== undefined) await act(async () => root?.unmount());
  root = undefined;
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

/**
 * A local file the manager accepts: bytes, a name, and the MIME its extension
 * claims.
 *
 * `arrayBuffer` is answered from the bytes because jsdom's `File` does not
 * implement it — the same shim `asset-manager/index.dom.test.ts` uses, for the
 * same reason.
 */
function file(name: string, type: string, bytes: string): File {
  const source = new TextEncoder().encode(bytes);
  return Object.assign(
    new File([source as unknown as BlobPart], name, { type }),
    {
      arrayBuffer: async () =>
        source.buffer.slice(
          source.byteOffset,
          source.byteOffset + source.byteLength,
        ),
    },
  );
}

const IMAGE_FILE = file("logo.png", "image/png", "png-one");
const OTHER_IMAGE_FILE = file("logo.png", "image/png", "png-two");
const SVG_FILE = file("mark.svg", "image/svg+xml", "<svg/>");
const FONT_FILE = file("body.woff2", "font/woff2", "woff2");
const VIDEO_FILE = file("clip.mp4", "video/mp4", "mp4");

interface Harness {
  readonly host: HTMLElement;
  readonly manager: AssetManager;
  readonly placeImage: Mock;
  readonly replace: Mock;
  readonly hydrate: Mock;
  readonly remove: Mock;
  readonly saveState: Mock;
  readonly error: Mock;
  readonly changed: Mock;
  readonly onFindAssets: Mock;
}

/** The file section over a real `AssetManager`, on an editor stub that answers
 *  only what the section asks it: the canvas walk, the history and the errors. */
async function mount(
  isReferenced: (assetId: string) => boolean = () => false,
  objects: readonly unknown[] = [],
): Promise<Harness> {
  const host = document.createElement("div");
  document.body.append(host);
  inflight = [];
  const manager = new AssetManager();
  const placeImage = vi
    .spyOn(manager, "placeImage")
    .mockResolvedValue(undefined);
  const realImport = manager.import.bind(manager);
  vi.spyOn(manager, "import").mockImplementation((chosen) =>
    track(realImport(chosen)),
  );
  const realReplace = manager.replace.bind(manager);
  const replace = vi
    .spyOn(manager, "replace")
    .mockImplementation((assetId, chosen) =>
      track(realReplace(assetId, chosen)),
    );
  const hydrate = vi.spyOn(manager, "hydrate").mockResolvedValue(undefined);
  const remove = vi.spyOn(manager, "remove");
  const saveState = vi.fn();
  const error = vi.fn();
  const changed = vi.fn();
  const onFindAssets = vi.fn();
  const editor = {
    canvas: {
      getObjects: () => objects,
      requestRenderAll: vi.fn(),
    },
    // The artboard `cover` is pressed against, not a constant in the section.
    artboard: () => ({ width: 1920, height: 1080 }),
    historyManager: { saveState },
    errorManager: { error, warn: vi.fn() },
  } as unknown as EditorInteraction;

  const mounted = createRoot(host);
  root = mounted;
  await act(async () => {
    mounted.render(
      <FileSection
        manager={manager}
        editor={editor}
        changed={changed}
        isReferenced={isReferenced}
        onFindAssets={onFindAssets}
      />,
    );
  });

  return {
    host,
    manager,
    placeImage,
    replace,
    hydrate,
    remove,
    saveState,
    error,
    changed,
    onFindAssets,
  };
}

/** The trigger the asset list's hook now names — the control set's own button,
 *  not the native `<select>` it replaced. */
const selectControl = (host: HTMLElement): HTMLElement =>
  host.querySelector<HTMLElement>("[data-yunari-asset-select]")!;

/** The id the control is standing on, read from the hook `Select.Value` prints
 *  it with: that element carries both the words and the committed id, so this
 *  is the native `.value` read in the only place it still exists. */
const chosenId = (host: HTMLElement): string | null =>
  selectControl(host)
    .querySelector("[data-yunari-value]")
    ?.getAttribute("data-yunari-value") ?? null;

/** React and floating-ui schedule outside `act`, so a popup is flushed with
 *  macrotasks rather than one — `paint-list.dom.test.tsx`'s rule. */
async function flush(): Promise<void> {
  for (let round = 0; round < 3; round += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

async function click(target: Element, detail = 0): Promise<void> {
  await act(async () => {
    target.dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true, detail }),
    );
  });
}

/** Base UI commits a list item only when the press that precedes the click
 *  started on it, so the press is part of the interaction. */
async function pointerDown(target: Element): Promise<void> {
  await act(async () => {
    target.dispatchEvent(
      new PointerEvent("pointerdown", {
        bubbles: true,
        cancelable: true,
        pointerType: "mouse",
        button: 0,
      }),
    );
  });
}

/** Opens the popup, which is the only state in which its options exist. */
async function openPopup(host: HTMLElement): Promise<void> {
  await click(selectControl(host));
  await flush();
}

/** Closes it again, so the next read opens rather than toggles. */
async function closePopup(host: HTMLElement): Promise<void> {
  await click(selectControl(host));
  await flush();
}

/**
 * The open popup's options, in the order it draws them.
 *
 * **Scoped by the `aria-controls` the trigger carries only while it is open.**
 * A bare `[role="option"]` lookup is not the same question: a popup from an
 * earlier case can still be in the document, and its rows would be counted here
 * — the failure `control-set.ts`'s `openList` names, measured in jsdom.
 */
function popupOptions(host: HTMLElement): readonly HTMLElement[] {
  const list = selectControl(host).getAttribute("aria-controls");
  const container = list === null ? null : document.getElementById(list);
  if (container === null) return [];
  return [...container.querySelectorAll<HTMLElement>('[role="option"]')];
}

/** The words the declared list is drawing, read from the opened popup because a
 *  plan-1 select renders none until it is. */
async function listedNames(host: HTMLElement): Promise<readonly string[]> {
  await openPopup(host);
  const names = popupOptions(host).map((option) => option.textContent ?? "");
  await closePopup(host);
  return names;
}

const alert = (host: HTMLElement): HTMLElement =>
  host.querySelector<HTMLElement>('[role="alert"]')!;

/** Points the list at one asset the way choosing it from the popup does. */
async function selectAsset(host: HTMLElement, assetId: string): Promise<void> {
  await openPopup(host);
  const option = popupOptions(host).find(
    (candidate) => candidate.getAttribute("data-yunari-option") === assetId,
  );
  if (option === undefined) {
    throw new Error(`no option ${assetId} in the asset list`);
  }
  await pointerDown(option);
  await click(option, 1);
  await flush();
}

/**
 * The promises the manager handed back since the last `mount`, so a case can
 * wait for the real async work — `import` and `replace` hash the bytes with
 * `crypto.subtle`, which takes more than one turn under a loaded worker —
 * rather than guessing a turn count and flaking when it is wrong.
 */
let inflight: Promise<unknown>[] = [];

function track<T>(promise: Promise<T>): Promise<T> {
  inflight.push(promise);
  return promise;
}

/**
 * Waits for every tracked submission to land, then one turn for the render.
 *
 * A refusal is a rejection, and the component already turns it into a message;
 * this only waits, so it settles rather than rejects.
 */
async function drain(): Promise<void> {
  while (inflight.length > 0) {
    const batch = inflight;
    inflight = [];
    await Promise.allSettled(batch);
  }
  // Several turns, because the byte swap hashes with `crypto.subtle` and the
  // fetch answer is another promise chain on top of it.
  for (let round = 0; round < 3; round += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

/**
 * Fires a picker's `change` with the given file, the way a browser does once a
 * control opens it, without waiting for the submission it starts. Must be called
 * inside `act`.
 */
function pick(host: HTMLElement, selector: string, chosen: File): void {
  const input = host.querySelector<HTMLInputElement>(selector)!;
  Object.defineProperty(input, "files", {
    value: [chosen],
    configurable: true,
  });
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

/** Fires a picker's `change` and waits out the submission it starts. */
async function choose(
  host: HTMLElement,
  selector: string,
  chosen: File,
): Promise<void> {
  await act(async () => {
    pick(host, selector, chosen);
    await drain();
  });
}

/** Imports through the control the author presses. */
async function importFile(host: HTMLElement, chosen: File): Promise<void> {
  await choose(host, "[data-yunari-asset-import-input]", chosen);
}

/** Chooses an asset and swaps its bytes, in that order. */
async function replaceFile(
  host: HTMLElement,
  assetId: string,
  chosen: File,
): Promise<void> {
  await selectAsset(host, assetId);
  await choose(host, "[data-yunari-asset-replace-input]", chosen);
}

const removeControl = (host: HTMLElement): HTMLButtonElement =>
  host.querySelector<HTMLButtonElement>("[data-yunari-asset-remove]")!;

describe("the Add pane's file section", () => {
  it("opens the finder from its own control", async () => {
    const { host, onFindAssets } = await mount();

    const control = host.querySelector<HTMLButtonElement>(
      "[data-yunari-find-assets]",
    );
    if (control === null) throw new Error("no Find assets control.");
    expect(control.textContent).toContain(uiCopy.file.findAssets);

    await click(control);
    expect(onFindAssets).toHaveBeenCalledTimes(1);
  });

  it("places an image or an SVG, and declares a video or a font without placing it", async () => {
    const { host, manager, placeImage } = await mount();

    await importFile(host, IMAGE_FILE);
    expect(manager.declarations.map((asset) => asset.id)).toEqual(["logo"]);
    expect(placeImage).toHaveBeenCalledTimes(1);
    expect(placeImage.mock.calls[0]?.[2]).toMatchObject({
      id: "logo",
      kind: "image",
    });

    await importFile(host, FONT_FILE);
    expect(manager.declarations.map((asset) => asset.id)).toEqual([
      "logo",
      "body",
    ]);
    // The font is declared and never placed: there is no image object for it.
    expect(placeImage).toHaveBeenCalledTimes(1);

    await importFile(host, VIDEO_FILE);
    expect(manager.declarations.map((asset) => asset.kind)).toEqual([
      "image",
      "font",
      "video",
    ]);
    expect(placeImage).toHaveBeenCalledTimes(1);

    await importFile(host, SVG_FILE);
    expect(manager.declarations.at(-1)).toMatchObject({ kind: "svg" });
    expect(placeImage).toHaveBeenCalledTimes(2);
  });

  it("says a video was declared and not placed, and the canvas is untouched", async () => {
    const { host, placeImage } = await mount();

    await importFile(host, VIDEO_FILE);

    // `vg-155`: the two outcomes stay different, so the pane has to say which
    // one it took rather than leaving the canvas's silence to say it.
    expect(alert(host).textContent).toBe(uiCopy.panels.assetDeclaredVideo);
    expect(placeImage).not.toHaveBeenCalled();
  });

  it("says an image was placed on the canvas", async () => {
    const { host, placeImage } = await mount();

    await importFile(host, IMAGE_FILE);

    expect(alert(host).textContent).toBe(uiCopy.panels.assetPlaced);
    expect(placeImage).toHaveBeenCalledTimes(1);
  });

  it("keeps a declared-but-unplaced asset in the list, because it has no layer to hang on", async () => {
    const { host } = await mount();

    await importFile(host, FONT_FILE);

    // Review Focus 5: the list is the declarations, not the placed objects —
    // which is what keeps a font imported once removable.
    expect(await listedNames(host)).toEqual(["body.woff2"]);
    expect(
      await listedNames(host),
      "the file's name, never the id the package keys it by",
    ).not.toContain("body");
  });

  it("refuses to remove an asset the scene or the document still references, in words", async () => {
    const image = new FabricImage(document.createElement("img"), {
      id: "image-1",
    });
    setObjectAssetReference(image, { assetId: "logo", kind: "image" });
    const group = new Group([image]);
    group.set("id", "group-1");
    const { host, remove } = await mount(() => false, [group]);

    await importFile(host, IMAGE_FILE);
    await selectAsset(host, "logo");
    await act(async () => removeControl(host).click());

    expect(remove).not.toHaveBeenCalled();
    expect(alert(host).textContent).toBe(uiCopy.panels.assetReferenced);
    // Nothing was removed, so the list is untouched.
    expect(await listedNames(host)).toEqual(["logo.png"]);
  });

  it("refuses a removal the document's own references ask for, which the canvas cannot see", async () => {
    const { host, remove } = await mount((assetId) => assetId === "logo");

    await importFile(host, IMAGE_FILE);
    await selectAsset(host, "logo");
    await act(async () => removeControl(host).click());

    expect(remove).not.toHaveBeenCalled();
    expect(alert(host).textContent).toBe(uiCopy.panels.assetReferenced);
  });

  it("removes an unreferenced asset, and the list follows the declarations", async () => {
    const { host, manager, changed } = await mount();

    await importFile(host, IMAGE_FILE);
    await selectAsset(host, "logo");
    await act(async () => removeControl(host).click());

    expect(manager.declarations).toEqual([]);
    expect(await listedNames(host)).toEqual([]);
    expect(alert(host).textContent).toBe("");
    expect(changed).toHaveBeenCalled();
  });

  it("leaves the author's selection alone when a second file is imported", async () => {
    const { host } = await mount();

    // Nothing was selected and the list was empty, so the first import is the
    // one the list falls back to.
    await importFile(host, IMAGE_FILE);
    expect(chosenId(host)).toBe("logo");

    await importFile(host, FONT_FILE);
    // Parity with the panel this replaces: adding a file never moved the list
    // off the asset the author was pointing at.
    expect(chosenId(host)).toBe("logo");
  });

  it("drops a second pick while one import is in flight, and commits the first once", async () => {
    const { host, manager, saveState } = await mount();

    await act(async () => {
      // Both picks land before the first import has finished, which is the
      // window `submit`'s guard closes: a second import into the same manager
      // would interleave declarations and hashes.
      pick(host, "[data-yunari-asset-import-input]", IMAGE_FILE);
      pick(host, "[data-yunari-asset-import-input]", FONT_FILE);
      await drain();
    });

    // The drop is silent by design — the ceiling named at `submit` — so the
    // evidence is that the second file never reached the manager.
    expect(manager.declarations.map((asset) => asset.id)).toEqual(["logo"]);
    expect(await listedNames(host)).toEqual(["logo.png"]);
    expect(saveState).toHaveBeenCalledTimes(1);
  });

  it("keeps replace as the chosen asset's own byte swap, which is what it always meant", async () => {
    const { host, replace, hydrate, saveState } = await mount();

    await importFile(host, IMAGE_FILE);
    // The import is one committed edit; the replace below is what this case is
    // about, so the counter starts from the import.
    const afterImport = saveState.mock.calls.length;
    await replaceFile(host, "logo", OTHER_IMAGE_FILE);

    expect(replace).toHaveBeenCalledTimes(1);
    expect(
      replace.mock.calls[0]?.[0],
      "the chosen asset, never the selected one",
    ).toBe("logo");
    expect(replace.mock.calls[0]?.[1]).toBe(OTHER_IMAGE_FILE);
    // Rehydration is what carries the new pixels to every object bound to the
    // id; one committed edit.
    expect(hydrate).toHaveBeenCalledTimes(1);
    expect(saveState.mock.calls.length - afterImport).toBe(1);
  });

  it("swaps the chosen asset's bytes without declaring a second asset", async () => {
    // `vg-154`'s remaining work is "re-point the *selected object* at a new
    // asset" — the opposite shape to this, and the shape that would declare one.
    // What this case can pin is the declaration side only: `replace` swaps bytes
    // under the id instead of declaring a second asset. It cannot pin "the
    // object kept that id", because `hydrate` is mocked below and nothing here
    // reads the reference back.
    const image = new FabricImage(document.createElement("img"), {
      id: "image-1",
    });
    setObjectAssetReference(image, { assetId: "logo", kind: "image" });
    const { host, manager, hydrate } = await mount(() => false, [image]);

    await importFile(host, IMAGE_FILE);
    await replaceFile(host, "logo", OTHER_IMAGE_FILE);

    // The id and path survive and no second declaration appears: the bytes under
    // the same id are all that moved.
    expect(manager.declarations.map((asset) => [asset.id, asset.path])).toEqual(
      [["logo", "assets/logo.png"]],
    );
    // And the edit commits once, rehydrating every object bound to the id.
    expect(hydrate).toHaveBeenCalledTimes(1);
  });

  it("replaces the asset the author chose, not the one a rebuild happened to leave selected", async () => {
    const { host, replace } = await mount();

    await importFile(host, IMAGE_FILE);
    await importFile(host, file("mark.svg", "image/svg+xml", "<svg/>"));
    await replaceFile(
      host,
      "mark",
      file("mark.svg", "image/svg+xml", "<svg><g/></svg>"),
    );

    expect(replace.mock.calls[0]?.[0]).toBe("mark");
  });

  it("shows a refused replacement's reason without touching the document", async () => {
    const { host, manager, saveState, error } = await mount();

    await importFile(host, IMAGE_FILE);
    const afterImport = saveState.mock.calls.length;
    await replaceFile(host, "logo", FONT_FILE);

    // A `.png` replaced by a `.woff2` keeps its path but not its format, and
    // `replace` refuses before it writes.
    expect(alert(host).textContent).toBe(uiCopy.panels.assetImportFailed);
    expect(error).toHaveBeenCalledWith(
      "image",
      uiCopy.panels.assetImportFailed,
      expect.any(Error),
    );
    // The refusal wrote nothing, so the import's own entry is all there is.
    expect(saveState.mock.calls.length).toBe(afterImport);
    expect(manager.declarations.map((asset) => asset.id)).toEqual(["logo"]);
  });

  it("reports a refused import without touching the document", async () => {
    const { host, manager, saveState, error } = await mount();

    // The extension is not one the package accepts at all.
    await importFile(host, file("notes.txt", "text/plain", "hi"));

    expect(manager.declarations).toEqual([]);
    expect(alert(host).textContent).toBe(uiCopy.panels.assetImportFailed);
    expect(error).toHaveBeenCalledWith(
      "image",
      uiCopy.panels.assetImportFailed,
      expect.any(Error),
    );
    expect(saveState).not.toHaveBeenCalled();
  });

  it("records exactly one history entry for an imported image", async () => {
    const { host, saveState } = await mount();

    await importFile(host, IMAGE_FILE);

    expect(saveState).toHaveBeenCalledTimes(1);
  });

  it("names each asset by the file it came from and previews the selection", async () => {
    const { host } = await mount();

    await importFile(host, IMAGE_FILE);
    await importFile(host, VIDEO_FILE);

    expect(await listedNames(host)).toEqual(["logo.png", "clip.mp4"]);
    // The trigger is named by the row's `<label for>`, as every other control in
    // these panes is; the native element's own name left with it.
    expect(host.querySelector("label")?.textContent).toBe(
      uiCopy.panels.assetList,
    );
    expect(host.querySelector("label")?.htmlFor).toBe(selectControl(host).id);

    const preview = host.querySelector<HTMLImageElement>(
      "[data-yunari-asset-preview]",
    )!;
    await selectAsset(host, "logo");
    expect(preview.getAttribute("src")).toBeTruthy();
    expect(preview.alt).toBe("logo.png");

    // A video has nothing to preview, and the section says so by clearing the
    // image rather than leaving the previous asset's picture standing.
    await selectAsset(host, "clip");
    expect(preview.getAttribute("src")).toBeNull();
    expect(preview.hidden).toBe(true);
  });

  it("opens each file input from a visible, named control", async () => {
    const { host } = await mount();

    const importInput = host.querySelector<HTMLInputElement>(
      "[data-yunari-asset-import-input]",
    )!;
    const replaceInput = host.querySelector<HTMLInputElement>(
      "[data-yunari-asset-replace-input]",
    )!;
    const importButton = host.querySelector<HTMLElement>(
      "[data-yunari-asset-import]",
    )!;
    const replaceButton = host.querySelector<HTMLElement>(
      "[data-yunari-asset-replace]",
    )!;

    expect(importButton.textContent).toBe(uiCopy.panels.importFile);
    expect(replaceButton.textContent).toBe(uiCopy.panels.replaceAsset);

    // **The accept rule, derived rather than restated.** Both pickers carry the
    // manager's own extension list, so adding an extension to `TYPES` moves the
    // string and this case with it; a hand-kept second list could widen only by
    // drifting silently.
    expect(ACCEPT).not.toBe("");
    expect(importInput.accept).toBe(ACCEPT);
    expect(replaceInput.accept).toBe(ACCEPT);

    const opened = [
      vi.spyOn(importInput, "click"),
      vi.spyOn(replaceInput, "click"),
    ];
    await act(async () => {
      importButton.click();
      replaceButton.click();
    });

    expect(opened[0]).toHaveBeenCalledOnce();
    expect(opened[1]).toHaveBeenCalledOnce();
  });

  /**
   * **Only a video, and only one action.** Normalizing brings the file inside
   * the publish envelope and keeps the whole frame: cropping is the background
   * layer's job at render time (0095), so there is no second mode. An image, an
   * SVG or a font has no video envelope to normalize, so no control may appear
   * for it.
   */
  it("offers the normalize control only for a declared video", async () => {
    const { host } = await mount();

    await importFile(host, IMAGE_FILE);
    await selectAsset(host, "logo");
    expect(normalizeControl(host)).toBeNull();

    await importFile(host, FONT_FILE);
    await selectAsset(host, "body");
    expect(normalizeControl(host)).toBeNull();

    await importFile(host, VIDEO_FILE);
    await selectAsset(host, "clip");
    expect(normalizeControl(host)).not.toBeNull();
    expect(normalizeControl(host)?.textContent).toBe(
      uiCopy.panels.normalizeVideo,
    );
  });

  /**
   * **A refusal is the host's own sentence, and nothing was written.** The host
   * knows which envelope rule the video broke; a sentence composed here would
   * hide it, and a master swapped for a refused result would be a silent loss.
   */
  it("shows the host's refusal beside the control and leaves the master alone", async () => {
    const sentence = "That video is not an H.264 MP4.";
    const fetchStub = stubNormalize(() =>
      normalizeAnswer({ ok: false, message: sentence }),
    );
    const { host, manager, saveState } = await mount();

    await importFile(host, VIDEO_FILE);
    await selectAsset(host, "clip");
    const afterImport = saveState.mock.calls.length;
    await press(host, "[data-yunari-asset-normalize]");

    expect(alert(host).textContent).toBe(sentence);
    expect(bytesOf(manager.assets["assets/clip.mp4"])).toEqual(
      bytesOf(new TextEncoder().encode("mp4")),
    );
    expect(useControl(host)).toBeNull();
    expect(saveState.mock.calls.length).toBe(afterImport);
    // No `fit` is sent, so the host keeps the source's own shape.
    expect(postedBody(fetchStub)).not.toHaveProperty("fit");
  });

  /**
   * **The master is never replaced silently.** The run's result is held, and the
   * bytes move only on the second press — an author who normalizes to inspect
   * the result must not find the original already gone.
   */
  it("holds the normalized copy until the author presses Use the normalized copy", async () => {
    const normalized = new TextEncoder().encode("mp4-normalized");
    stubNormalize(() => normalizeAnswer({ ok: true, bytes: normalized }));
    const { host, manager, hydrate, saveState } = await mount();

    await importFile(host, VIDEO_FILE);
    await selectAsset(host, "clip");
    const afterImport = saveState.mock.calls.length;
    await press(host, "[data-yunari-asset-normalize]");

    // Held, not applied: the master still carries the file the author imported.
    expect(bytesOf(manager.assets["assets/clip.mp4"])).toEqual(
      bytesOf(new TextEncoder().encode("mp4")),
    );
    expect(useControl(host)?.textContent).toBe(
      uiCopy.panels.useNormalizedVideo,
    );
    expect(saveState.mock.calls.length).toBe(afterImport);

    await press(host, "[data-yunari-asset-use-normalized]");

    // The second press is the one that writes, and it keeps the declaration.
    expect(bytesOf(manager.assets["assets/clip.mp4"])).toEqual(
      bytesOf(normalized),
    );
    expect(manager.declarations.map((asset) => [asset.id, asset.path])).toEqual(
      [["clip", "assets/clip.mp4"]],
    );
    expect(hydrate).toHaveBeenCalledTimes(1);
    expect(saveState.mock.calls.length - afterImport).toBe(1);
    expect(useControl(host)).toBeNull();
  });

  it("previews the held copy before the press that writes it", async () => {
    const normalized = new TextEncoder().encode("mp4-normalized");
    stubNormalize(() => normalizeAnswer({ ok: true, bytes: normalized }));
    const { host, manager } = await mount();

    await importFile(host, VIDEO_FILE);
    await selectAsset(host, "clip");
    await press(host, "[data-yunari-asset-normalize]");

    // Spec rule 4: the author inspects the normalized asset, not the master.
    const preview = host.querySelector<HTMLVideoElement>(
      "[data-yunari-asset-normalized-preview]",
    );
    expect(preview).not.toBeNull();
    expect(preview?.getAttribute("src")).toMatch(/^blob:/);
    expect(preview?.controls).toBe(true);
    // Previewing wrote nothing.
    expect(bytesOf(manager.assets["assets/clip.mp4"])).toEqual(
      bytesOf(new TextEncoder().encode("mp4")),
    );
  });

  /** A held copy belongs to the press that produced it: a refused second press
   *  must not leave the previous mode's result armed for the write. */
  it("clears a held copy when a later normalize press is refused", async () => {
    const sentence = "That video is not an H.264 MP4.";
    const fetchStub = vi.fn<typeof fetch>();
    fetchStub.mockResolvedValueOnce(
      normalizeAnswer({
        ok: true,
        bytes: new TextEncoder().encode("mp4-normalized"),
      }),
    );
    fetchStub.mockResolvedValueOnce(
      normalizeAnswer({ ok: false, message: sentence }),
    );
    vi.stubGlobal("fetch", fetchStub);
    const { host, manager, saveState } = await mount();

    await importFile(host, VIDEO_FILE);
    await selectAsset(host, "clip");
    await press(host, "[data-yunari-asset-normalize]");
    expect(useControl(host)).not.toBeNull();
    const afterImport = saveState.mock.calls.length;

    await press(host, "[data-yunari-asset-normalize]");

    expect(alert(host).textContent).toBe(sentence);
    expect(useControl(host)).toBeNull();
    expect(bytesOf(manager.assets["assets/clip.mp4"])).toEqual(
      bytesOf(new TextEncoder().encode("mp4")),
    );
    expect(saveState.mock.calls.length).toBe(afterImport);
  });

  /** The early return before the host is called is still a press that starts a
   *  run: the previous copy must not stay armed for the write. */
  it("clears a held copy when a press finds the declared bytes gone", async () => {
    stubNormalize(() =>
      normalizeAnswer({
        ok: true,
        bytes: new TextEncoder().encode("mp4-normalized"),
      }),
    );
    const { host, manager } = await mount();

    await importFile(host, VIDEO_FILE);
    await selectAsset(host, "clip");
    await press(host, "[data-yunari-asset-normalize]");
    expect(useControl(host)).not.toBeNull();

    vi.spyOn(manager, "assets", "get").mockReturnValue({});
    await press(host, "[data-yunari-asset-normalize]");

    expect(useControl(host)).toBeNull();
  });

  it("drops a removal while the held copy is being written", async () => {
    stubNormalize(() =>
      normalizeAnswer({
        ok: true,
        bytes: new TextEncoder().encode("mp4-normalized"),
      }),
    );
    const { host, manager, remove } = await mount();

    await importFile(host, VIDEO_FILE);
    await selectAsset(host, "clip");
    await press(host, "[data-yunari-asset-normalize]");

    // The write is held open, which is the window a removal would splice a
    // stale index through (`replaceBytes` splices after an await).
    const declared = manager.declarations[0];
    if (declared === undefined) throw new Error("no declaration");
    let finish: () => void = () => {};
    const write = new Promise<LocalAssetReference>((resolve) => {
      finish = () => resolve(declared);
    });
    vi.spyOn(manager, "replaceBytes").mockReturnValue(write);
    await act(async () => {
      useControl(host)!.click();
      await flush();
    });

    await act(async () => removeControl(host).click());
    expect(remove).not.toHaveBeenCalled();

    await act(async () => {
      finish();
      await flush();
    });
    expect(manager.declarations.map((asset) => asset.id)).toEqual(["clip"]);
  });

  it("names a failed write of the held copy apart from an import failure", async () => {
    stubNormalize(() =>
      normalizeAnswer({
        ok: true,
        bytes: new TextEncoder().encode("mp4-normalized"),
      }),
    );
    const { host, manager, saveState, error } = await mount();

    await importFile(host, VIDEO_FILE);
    await selectAsset(host, "clip");
    await press(host, "[data-yunari-asset-normalize]");
    const afterImport = saveState.mock.calls.length;
    vi.spyOn(manager, "replaceBytes").mockRejectedValue(new Error("disk full"));

    await press(host, "[data-yunari-asset-use-normalized]");

    expect(alert(host).textContent).toBe(uiCopy.panels.useNormalizedFailed);
    expect(error).toHaveBeenCalledWith(
      "image",
      uiCopy.panels.useNormalizedFailed,
      expect.any(Error),
    );
    expect(saveState.mock.calls.length).toBe(afterImport);
  });

  /** The press asks for no crop: the host's `contain` path keeps the source's
   *  own shape, so the published file still has the pixels a pan can move. */
  it("asks the host for the whole frame, not a crop", async () => {
    const fetchStub = stubNormalize(() =>
      normalizeAnswer({
        ok: false,
        message: "refused to keep the case simple",
      }),
    );
    const { host } = await mount();

    await importFile(host, VIDEO_FILE);
    await selectAsset(host, "clip");
    await press(host, "[data-yunari-asset-normalize]");

    expect(postedBody(fetchStub)).not.toHaveProperty("fit");
    expect(postedBody(fetchStub)).not.toHaveProperty("aspect");
  });

  /** The author sees the wait, because a re-encode of a large video outlives the
   *  press that started it. */
  it("says it is normalizing while the host has not answered", async () => {
    let answer: (response: Response) => void = () => {};
    const pending = new Promise<Response>((resolve) => {
      answer = resolve;
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(() => pending),
    );
    const { host } = await mount();

    await importFile(host, VIDEO_FILE);
    await selectAsset(host, "clip");
    await act(async () => {
      normalizeControl(host)!.click();
    });

    expect(normalizeControl(host)?.textContent).toBe(
      uiCopy.panels.normalizingVideo,
    );

    await act(async () => {
      answer(normalizeAnswer({ ok: false, message: "done" }));
      await pending;
      await drain();
    });
  });
});

/** An asset's bytes as plain numbers. The jsdom `File` shim and the manager's
 *  own arrays come from different realms, so two identical contents are not
 *  deep-equal by constructor. */
const bytesOf = (bytes: Uint8Array | undefined): number[] =>
  bytes === undefined ? [] : [...bytes];

/** A normalize answer in the host's own shape. */
function normalizeAnswer(
  answer: { ok: true; bytes: Uint8Array } | { ok: false; message: string },
): Response {
  return new Response(
    JSON.stringify(
      answer.ok
        ? {
            ok: true,
            bytesBase64: btoa(String.fromCharCode(...answer.bytes)),
            reencoded: true,
          }
        : { ok: false, message: answer.message },
    ),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

/** Answers the host route from `answer`, and records the body it was posted. */
function stubNormalize(
  answer: () => Response,
): ReturnType<typeof vi.fn<typeof fetch>> {
  const fetchStub = vi.fn<typeof fetch>(async () => answer());
  vi.stubGlobal("fetch", fetchStub);
  return fetchStub;
}

/** The JSON one normalize press posted. */
function postedBody(fetchStub: ReturnType<typeof vi.fn>): unknown {
  const init = fetchStub.mock.calls[0]?.[1] as RequestInit | undefined;
  return JSON.parse(String(init?.body));
}

const normalizeControl = (host: HTMLElement): HTMLButtonElement | null =>
  host.querySelector<HTMLButtonElement>("[data-yunari-asset-normalize]");
const useControl = (host: HTMLElement): HTMLButtonElement | null =>
  host.querySelector<HTMLButtonElement>("[data-yunari-asset-use-normalized]");

/** Presses a control and waits out the submission it starts. */
async function press(host: HTMLElement, selector: string): Promise<void> {
  const target = host.querySelector<HTMLButtonElement>(selector);
  if (target === null) throw new Error(`no control ${selector}`);
  await act(async () => {
    target.click();
    await drain();
  });
}

/** The file types both pickers offer — derived from the manager's own exported
 *  list, so an extension added to `TYPES` and not offered here, or offered here
 *  and not readable there, is red. */
const ACCEPT = ASSET_FILE_EXTENSIONS.map((ext) => `.${ext}`).join(",");
