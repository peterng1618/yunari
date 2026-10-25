// @vitest-environment jsdom

/**
 * The Assets pane: the declared files, grouped by kind, one card each, and the
 * import that puts them there.
 *
 * **The list is the declarations, not the placed objects.** A font or a video is
 * declared only, so a list built from the canvas would lose them — the cases
 * here mount declarations that no object holds and still expect a card.
 *
 * **In use is the scene's reference OR the envelope's.** The envelope-side
 * references are the artboard's background media and a type preset's face, which
 * no Fabric object carries; `isReferenced` is how the pane hears them, and it is
 * optional so the pane mounts where there is no envelope to ask.
 *
 * **Import routes by kind, and the author can override it.** A picture is placed
 * on the canvas, a video becomes the artboard's background media, and a font is
 * only declared. *Import as background* forces a picture or a video into the
 * background and refuses a font, because a face has no background form.
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
import { AssetsPane } from "./assets-pane.js";

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

const IMAGE: LocalAssetReference = {
  id: "logo",
  kind: "image",
  path: "assets/logo.png",
};
const OTHER_IMAGE: LocalAssetReference = {
  id: "photo",
  kind: "image",
  path: "assets/photo.jpg",
};
const FONT: LocalAssetReference = {
  id: "body",
  kind: "font",
  path: "assets/body.woff2",
  family: "Manrope",
  weight: 700,
  style: "normal",
  format: "woff2",
};

/** A manager that declares what the case names and nothing else: no action the
 *  cases press reaches the byte store, so a structural double is the whole of
 *  what the pane is given. Its two answers a case can steer are the preview URL
 *  and the removal result. */
function managerStub(
  declarations: readonly LocalAssetReference[],
  previewUrl: (assetId: string) => string | undefined = () => undefined,
): AssetManager {
  return {
    declarations,
    assets: {},
    previewUrl,
    placeImage: vi.fn(),
    replace: vi.fn(),
    hydrate: vi.fn(),
    remove: vi.fn(() => true),
  } as unknown as AssetManager;
}

function editorStub(): EditorInteraction {
  return {
    canvas: { getObjects: () => [], requestRenderAll: vi.fn() },
    historyManager: { saveState: vi.fn() },
    errorManager: { error: vi.fn(), warn: vi.fn() },
  } as unknown as EditorInteraction;
}

let root: Root | undefined;

afterEach(async () => {
  if (root !== undefined) await act(async () => root?.unmount());
  root = undefined;
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

function mount(
  declarations: readonly LocalAssetReference[],
  options: {
    readonly isReferenced?: (assetId: string) => boolean;
    readonly previewUrl?: (assetId: string) => string | undefined;
  } = {},
): { readonly host: HTMLElement; readonly manager: AssetManager } {
  const host = document.createElement("div");
  document.body.append(host);
  const manager = managerStub(declarations, options.previewUrl);
  const mounted = createRoot(host);
  root = mounted;
  act(() =>
    mounted.render(
      <AssetsPane
        manager={manager}
        editor={editorStub()}
        {...(options.isReferenced === undefined
          ? {}
          : { isReferenced: options.isReferenced })}
      />,
    ),
  );
  return { host, manager };
}

/** The pane's section headings, in the order it drew them. */
function headings(host: HTMLElement): readonly (string | null)[] {
  return [...host.querySelectorAll("h3")].map((heading) => heading.textContent);
}

/** The card a file's name sits on, reached through the row's own select. */
function cardOf(host: HTMLElement, name: string): HTMLElement | null {
  const row = [...host.querySelectorAll("button")].find(
    (button) =>
      button.hasAttribute("data-yunari-asset-select") &&
      button.textContent?.includes(name),
  );
  return row?.closest<HTMLElement>("li") ?? null;
}

/** The accessible names of the actions a card drew, in the order it drew them. */
function actionNames(
  host: HTMLElement,
  name: string,
): readonly (string | null)[] {
  const card = cardOf(host, name);
  if (card === null) return [];
  return [...card.querySelectorAll("button[aria-label]")].map((button) =>
    button.getAttribute("aria-label"),
  );
}

function badgeOf(host: HTMLElement, name: string): string | null | undefined {
  return cardOf(host, name)?.querySelector("[data-yunari-asset-badge]")
    ?.textContent;
}

/** One named action on a card, or nothing where the card did not draw it. */
function actionOf(
  host: HTMLElement,
  name: string,
  label: string,
): HTMLButtonElement | null {
  const card = cardOf(host, name);
  if (card === null) return null;
  return (
    [...card.querySelectorAll<HTMLButtonElement>("button[aria-label]")].find(
      (button) => button.getAttribute("aria-label") === label,
    ) ?? null
  );
}

/** Points the pane at one asset, the way a press on its row does. */
async function selectCard(host: HTMLElement, name: string): Promise<void> {
  const card = cardOf(host, name);
  if (card === null) throw new Error(`no card for ${name}`);
  const row = card.querySelector<HTMLButtonElement>(
    "[data-yunari-asset-select]",
  );
  if (row === null) throw new Error(`no row control on ${name}`);
  await act(async () => row.click());
}

describe("the Assets pane", () => {
  it("groups cards by kind and marks the chosen row's actions", async () => {
    const { host } = mount([IMAGE, OTHER_IMAGE, FONT]);

    // The mockup's order: Fonts, then Images. The font is declared even though
    // no object can hold it, which is the list-is-declarations rule.
    expect(headings(host)).toEqual([
      uiCopy.assets.category.font,
      uiCopy.assets.category.image,
    ]);

    await selectCard(host, "photo.jpg");

    // Five actions on the chosen image, in the drawing's order, and none on the
    // row the author moved off. A font's own row draws Create type preset
    // instead of the two canvas writes it cannot perform.
    expect(actionNames(host, "photo.jpg")).toEqual([
      uiCopy.panels.assetCard.preview,
      uiCopy.assets.placeOnCanvas,
      uiCopy.assets.action.image,
      uiCopy.panels.assetCard.replace,
      uiCopy.panels.assetCard.remove,
    ]);
    expect(actionNames(host, "logo.png")).toEqual([]);
    expect(actionNames(host, "body.woff2")).toEqual([]);
  });

  it("shows an unused font without a preset as Unused", async () => {
    const { host } = mount([FONT]);

    expect(badgeOf(host, "body.woff2")).toBe(uiCopy.panels.assetCard.unused);

    await selectCard(host, "body.woff2");
    expect(actionNames(host, "body.woff2")).toContain(
      uiCopy.panels.assetCard.createTypePreset,
    );
  });

  it("badges an asset In use when only the envelope references it", () => {
    // No object holds `logo`; the envelope-side reference is the artboard's
    // background media or a preset's face, and the pane has to hear it.
    const { host } = mount([IMAGE], {
      isReferenced: (assetId) => assetId === IMAGE.id,
    });

    expect(badgeOf(host, "logo.png")).toBe(uiCopy.panels.assetCard.inUse);
  });

  it("draws the manager's own preview as a picture card's thumbnail", () => {
    // A card that built no `<img>` from `previewUrl` would still pass every
    // other case, because the thumbnail is presentation only — this one asks
    // the manager for the URL and the card for the picture it made of it.
    const { host } = mount([IMAGE], {
      previewUrl: (assetId) =>
        assetId === IMAGE.id ? "blob:logo-preview" : undefined,
    });

    expect(
      cardOf(host, "logo.png")
        ?.querySelector("img[data-yunari-asset-preview]")
        ?.getAttribute("src"),
    ).toBe("blob:logo-preview");
  });

  it("reaches the manager from an action, and marks an unwired one disabled", async () => {
    const { host, manager } = mount([IMAGE]);

    const remove = actionOf(host, "logo.png", uiCopy.panels.assetCard.remove);
    if (remove === null) throw new Error("the chosen card drew no Remove");
    await act(async () => remove.click());
    expect(manager.remove).toHaveBeenCalledWith(IMAGE.id);

    // No `onPreview` was handed in, so the control says so rather than pressing
    // onto nothing. Task 20 supplies it from the session.
    expect(
      actionOf(host, "logo.png", uiCopy.panels.assetCard.preview)?.disabled,
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// The import and the behaviours the Add pane's file section used to own.
// ---------------------------------------------------------------------------

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
  readonly onBackground: Mock;
}

/** The file section over a real `AssetManager`, on an editor stub that answers
 *  only what the pane asks it: the canvas walk, the history and the errors. */
async function mountWithManager(
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
  const onBackground = vi.fn();
  const editor = {
    canvas: {
      getObjects: () => objects,
      requestRenderAll: vi.fn(),
    },
    historyManager: { attachGlobals: () => {}, saveState },
    errorManager: { error, warn: vi.fn() },
  } as unknown as EditorInteraction;

  const mounted = createRoot(host);
  root = mounted;
  await act(async () => {
    mounted.render(
      <AssetsPane
        manager={manager}
        editor={editor}
        isReferenced={isReferenced}
        onChanged={changed}
        onFindAssets={onFindAssets}
        onBackground={onBackground}
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
    onBackground,
  };
}

/** The promises the manager handed back since the last mount, so a case can
 *  wait for the real async work — `import` and `replace` hash the bytes with
 *  `crypto.subtle`, which takes more than one turn under a loaded worker —
 *  rather than guessing a turn count and flaking when it is wrong. */
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
async function pickFile(
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
  await pickFile(host, "[data-yunari-asset-import-input]", chosen);
}

/** Imports through *Import as background*. */
async function importAsBackground(
  host: HTMLElement,
  chosen: File,
): Promise<void> {
  const control = host.querySelector<HTMLButtonElement>(
    "[data-yunari-asset-import-background]",
  );
  if (control === null) throw new Error("no Import as background control.");
  await act(async () => control.click());
  await pickFile(host, "[data-yunari-asset-import-input]", chosen);
}

/** Chooses an asset and swaps its bytes, in that order. */
async function replaceFile(
  host: HTMLElement,
  name: string,
  chosen: File,
): Promise<void> {
  await selectCard(host, name);
  await pickFile(host, "[data-yunari-asset-replace-input]", chosen);
}

const removeControl = (host: HTMLElement): HTMLButtonElement =>
  host.querySelector<HTMLButtonElement>("[data-yunari-asset-remove]")!;

const alert = (host: HTMLElement): HTMLElement =>
  host.querySelector<HTMLElement>('[role="alert"]')!;

/** Whether a named card is the one the pane is pointing at. */
const isChosen = (host: HTMLElement, name: string): boolean =>
  cardOf(host, name)
    ?.querySelector("[data-yunari-asset-select]")
    ?.getAttribute("aria-pressed") === "true";

describe("the Assets pane's import", () => {
  it("opens the finder from its own control", async () => {
    const { host, onFindAssets } = await mountWithManager();

    const control = host.querySelector<HTMLButtonElement>(
      "[data-yunari-find-assets]",
    );
    if (control === null) throw new Error("no Find assets control.");
    expect(control.textContent).toContain(uiCopy.file.findAssets);

    await act(async () => control.click());
    expect(onFindAssets).toHaveBeenCalledTimes(1);
  });

  it("places an imported image through the canvas, as one history entry", async () => {
    const { host, manager, placeImage, saveState } = await mountWithManager();

    await importFile(host, IMAGE_FILE);

    expect(manager.declarations.map((asset) => asset.id)).toEqual(["logo"]);
    expect(placeImage).toHaveBeenCalledTimes(1);
    expect(placeImage.mock.calls[0]?.[2]).toMatchObject({
      id: "logo",
      kind: "image",
    });
    expect(saveState).toHaveBeenCalledTimes(1);
    expect(alert(host).textContent).toBe(uiCopy.panels.assetPlaced);
  });

  it("sets an imported video as background media, and places nothing", async () => {
    const { host, manager, placeImage, onBackground, changed } =
      await mountWithManager();

    await importFile(host, VIDEO_FILE);

    expect(manager.declarations.map((asset) => asset.kind)).toEqual(["video"]);
    expect(placeImage).not.toHaveBeenCalled();
    expect(onBackground).toHaveBeenCalledWith(
      expect.objectContaining({ id: "clip", kind: "video" }),
    );
    expect(alert(host).textContent).toBe(uiCopy.panels.assetBackgroundSet);
    expect(changed).toHaveBeenCalled();
  });

  it("declares an imported font and places nothing", async () => {
    const { host, manager, placeImage, onBackground } =
      await mountWithManager();

    await importFile(host, FONT_FILE);

    expect(manager.declarations.map((asset) => asset.kind)).toEqual(["font"]);
    expect(placeImage).not.toHaveBeenCalled();
    expect(onBackground).not.toHaveBeenCalled();
    expect(alert(host).textContent).toBe(uiCopy.panels.assetDeclaredFont);
    expect(cardOf(host, "body.woff2")).not.toBeNull();
  });

  it("places an imported SVG through the canvas", async () => {
    const { host, manager, placeImage } = await mountWithManager();

    await importFile(host, SVG_FILE);

    expect(manager.declarations.at(-1)).toMatchObject({ kind: "svg" });
    expect(placeImage).toHaveBeenCalledTimes(1);
    expect(alert(host).textContent).toBe(uiCopy.panels.assetPlaced);
  });

  it("forces an image into background media with Import as background", async () => {
    const { host, manager, placeImage, onBackground } =
      await mountWithManager();

    await importAsBackground(host, IMAGE_FILE);

    expect(manager.declarations.map((asset) => asset.kind)).toEqual(["image"]);
    expect(placeImage).not.toHaveBeenCalled();
    expect(onBackground).toHaveBeenCalledWith(
      expect.objectContaining({ id: "logo", kind: "image" }),
    );
    expect(alert(host).textContent).toBe(uiCopy.panels.assetBackgroundSet);
  });

  it("refuses Import as background for a font, and declares nothing", async () => {
    const { host, manager, onBackground } = await mountWithManager();

    await importAsBackground(host, FONT_FILE);

    // Refused before the manager sees it: the library would otherwise collect
    // a file the author asked not to import.
    expect(manager.declarations).toEqual([]);
    expect(onBackground).not.toHaveBeenCalled();
    expect(alert(host).textContent).toBe(
      uiCopy.panels.assetBackgroundFontRefused,
    );
  });

  it("keeps a declared-but-unplaced font in the list, because it has no layer", async () => {
    const { host } = await mountWithManager();

    await importFile(host, FONT_FILE);

    // Review Focus 5: the list is the declarations, not the placed objects —
    // which is what keeps a font imported once removable. The card is reached
    // by its **file name**, never by the id the package keys it by.
    expect(cardOf(host, "body.woff2")).not.toBeNull();
  });

  it("leaves the author's card alone when a second file is imported", async () => {
    const { host } = await mountWithManager();

    await importFile(host, IMAGE_FILE);
    expect(isChosen(host, "logo.png")).toBe(true);

    await importFile(host, FONT_FILE);
    // Parity with the section this replaces: adding a file never moved the
    // chosen card off the asset the author was pointing at.
    expect(isChosen(host, "logo.png")).toBe(true);
    expect(isChosen(host, "body.woff2")).toBe(false);
  });

  it("drops a second pick while one import is in flight, and commits the first once", async () => {
    const { host, manager, saveState } = await mountWithManager();

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
    expect(cardOf(host, "logo.png")).not.toBeNull();
    expect(saveState).toHaveBeenCalledTimes(1);
  });

  it("reports a refused import without touching the document", async () => {
    const { host, manager, saveState, error } = await mountWithManager();

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
});

describe("the behaviours the file section carried", () => {
  it("refuses to remove an asset the scene or the document still references, in words", async () => {
    const image = new FabricImage(document.createElement("img"), {
      id: "image-1",
    });
    setObjectAssetReference(image, { assetId: "logo", kind: "image" });
    const group = new Group([image]);
    group.set("id", "group-1");
    const { host, remove } = await mountWithManager(() => false, [group]);

    await importFile(host, IMAGE_FILE);
    await selectCard(host, "logo.png");
    await act(async () => removeControl(host).click());

    expect(remove).not.toHaveBeenCalled();
    expect(alert(host).textContent).toBe(uiCopy.panels.assetReferenced);
    // Nothing was removed, so the list is untouched.
    expect(cardOf(host, "logo.png")).not.toBeNull();
  });

  it("refuses a removal the document's own references ask for, which the canvas cannot see", async () => {
    const { host, remove } = await mountWithManager(
      (assetId) => assetId === "logo",
    );

    await importFile(host, IMAGE_FILE);
    await selectCard(host, "logo.png");
    await act(async () => removeControl(host).click());

    expect(remove).not.toHaveBeenCalled();
    expect(alert(host).textContent).toBe(uiCopy.panels.assetReferenced);
  });

  it("removes an unreferenced asset, and the list follows the declarations", async () => {
    const { host, manager, changed } = await mountWithManager();

    await importFile(host, IMAGE_FILE);
    await selectCard(host, "logo.png");
    await act(async () => removeControl(host).click());

    expect(manager.declarations).toEqual([]);
    expect(cardOf(host, "logo.png")).toBeNull();
    expect(alert(host).textContent).toBe("");
    expect(changed).toHaveBeenCalled();
  });

  it("keeps replace as the chosen asset's own byte swap, which is what it always meant", async () => {
    const { host, replace, hydrate, saveState } = await mountWithManager();

    await importFile(host, IMAGE_FILE);
    // The import is one committed edit; the replace below is what this case is
    // about, so the counter starts from the import.
    const afterImport = saveState.mock.calls.length;
    await replaceFile(host, "logo.png", OTHER_IMAGE_FILE);

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
    const image = new FabricImage(document.createElement("img"), {
      id: "image-1",
    });
    setObjectAssetReference(image, { assetId: "logo", kind: "image" });
    const { host, manager, hydrate } = await mountWithManager(
      () => false,
      [image],
    );

    await importFile(host, IMAGE_FILE);
    await replaceFile(host, "logo.png", OTHER_IMAGE_FILE);

    // The id and path survive and no second declaration appears: the bytes under
    // the same id are all that moved.
    expect(manager.declarations.map((asset) => [asset.id, asset.path])).toEqual(
      [["logo", "assets/logo.png"]],
    );
    expect(hydrate).toHaveBeenCalledTimes(1);
  });

  it("replaces the asset the author chose, not the one a rebuild happened to leave selected", async () => {
    const { host, replace } = await mountWithManager();

    await importFile(host, IMAGE_FILE);
    await importFile(host, SVG_FILE);
    await replaceFile(
      host,
      "mark.svg",
      file("mark.svg", "image/svg+xml", "<svg><g/></svg>"),
    );

    expect(replace.mock.calls[0]?.[0]).toBe("mark");
  });

  it("shows a refused replacement's reason without touching the document", async () => {
    const { host, manager, saveState, error } = await mountWithManager();

    await importFile(host, IMAGE_FILE);
    const afterImport = saveState.mock.calls.length;
    await replaceFile(host, "logo.png", FONT_FILE);

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

  it("opens each file input from a visible, named control", async () => {
    const { host } = await mountWithManager();
    // The replace control belongs to the chosen card, which needs a file.
    await importFile(host, IMAGE_FILE);

    const importInput = host.querySelector<HTMLInputElement>(
      "[data-yunari-asset-import-input]",
    )!;
    const replaceInput = host.querySelector<HTMLInputElement>(
      "[data-yunari-asset-replace-input]",
    )!;
    const importButton = host.querySelector<HTMLElement>(
      "[data-yunari-asset-import]",
    )!;
    const backgroundButton = host.querySelector<HTMLElement>(
      "[data-yunari-asset-import-background]",
    )!;
    const replaceButton = host.querySelector<HTMLElement>(
      "[data-yunari-asset-replace]",
    )!;

    expect(importButton.textContent).toBe(uiCopy.panels.importFile);
    expect(backgroundButton.textContent).toBe(uiCopy.panels.importAsBackground);
    // The card's actions are glyph-led, so the name is the accessible one.
    expect(replaceButton.getAttribute("aria-label")).toBe(
      uiCopy.panels.assetCard.replace,
    );

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
      backgroundButton.click();
      replaceButton.click();
    });

    // Import and Import as background are one picker with two intents.
    expect(opened[0]).toHaveBeenCalledTimes(2);
    expect(opened[1]).toHaveBeenCalledOnce();
  });
});

/**
 * **Only a video, and only one action.** Normalizing brings the file inside
 * the publish envelope and keeps the whole frame: cropping is the background
 * layer's job at render time (0095), so there is no second mode. An image, an
 * SVG or a font has no video envelope to normalize, so no control may appear
 * for it.
 */
describe("normalizing a declared video", () => {
  it("offers the normalize control only for a declared video", async () => {
    const { host } = await mountWithManager();

    await importFile(host, IMAGE_FILE);
    await selectCard(host, "logo.png");
    expect(normalizeControl(host)).toBeNull();

    await importFile(host, FONT_FILE);
    await selectCard(host, "body.woff2");
    expect(normalizeControl(host)).toBeNull();

    await importFile(host, VIDEO_FILE);
    await selectCard(host, "clip.mp4");
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
    const { host, manager, saveState } = await mountWithManager();

    await importFile(host, VIDEO_FILE);
    await selectCard(host, "clip.mp4");
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
    const { host, manager, hydrate, saveState } = await mountWithManager();

    await importFile(host, VIDEO_FILE);
    await selectCard(host, "clip.mp4");
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
    const { host, manager } = await mountWithManager();

    await importFile(host, VIDEO_FILE);
    await selectCard(host, "clip.mp4");
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
    const { host, manager, saveState } = await mountWithManager();

    await importFile(host, VIDEO_FILE);
    await selectCard(host, "clip.mp4");
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
    const { host, manager } = await mountWithManager();

    await importFile(host, VIDEO_FILE);
    await selectCard(host, "clip.mp4");
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
    const { host, manager, remove } = await mountWithManager();

    await importFile(host, VIDEO_FILE);
    await selectCard(host, "clip.mp4");
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
    const { host, manager, saveState, error } = await mountWithManager();

    await importFile(host, VIDEO_FILE);
    await selectCard(host, "clip.mp4");
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
    const { host } = await mountWithManager();

    await importFile(host, VIDEO_FILE);
    await selectCard(host, "clip.mp4");
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
    const { host } = await mountWithManager();

    await importFile(host, VIDEO_FILE);
    await selectCard(host, "clip.mp4");
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

/** React and floating-ui schedule outside `act`, so a popup is flushed with
 *  macrotasks rather than one — `paint-list.dom.test.tsx`'s rule. */
async function flush(): Promise<void> {
  for (let round = 0; round < 3; round += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
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
