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
import {
  AssetsPane,
  type FontCommit,
  type FontCommitInput,
} from "./assets-pane.js";

// Base UI's select popup needs three browser APIs jsdom has none of — the same
// three `paint-list.dom.test.tsx` supplies, for the same reason.
globalThis.ResizeObserver ??= class {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
} as never;
Element.prototype.getAnimations ??= (): never[] => [];
window.PointerEvent ??= MouseEvent as never;
HTMLMediaElement.prototype.pause = () => undefined;

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
const VIDEO: LocalAssetReference = {
  id: "clip",
  kind: "video",
  path: "assets/clip.mp4",
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
    subscribe: vi.fn(() => () => {}),
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
        onFontCommit={async () => ({ ok: true, message: "" })}
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

/** The card for `name`: a declaration's id, or the file name its title carries.
 *  A face is titled by its family and weight, so its id is how a case names it. */
function cardOf(host: HTMLElement, name: string): HTMLElement | null {
  const byId = host.querySelector<HTMLElement>(
    `[data-yunari-asset-card="${name}"]`,
  );
  if (byId !== null) return byId;
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

    // The pane's order: Fonts, then Images. The font is declared even though
    // no object can hold it, which is the list-is-declarations rule.
    expect(headings(host)).toEqual([
      uiCopy.assets.category.font,
      uiCopy.assets.category.image,
    ]);

    await selectCard(host, "photo.jpg");

    // Five actions on the chosen image, in the pane's order, and none on the
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
    expect(actionNames(host, "body")).toEqual([]);
  });

  it("shows an unused font without a preset as Unused", async () => {
    const { host } = mount([FONT]);

    expect(badgeOf(host, "body")).toBe(uiCopy.panels.assetCard.unused);

    await selectCard(host, "body");
    expect(actionNames(host, "body")).toContain(
      uiCopy.panels.assetCard.createTypeToken,
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

  it("reaches the manager from an action", async () => {
    const { host, manager } = mount([IMAGE]);

    const remove = actionOf(host, "logo.png", uiCopy.panels.assetCard.remove);
    if (remove === null) throw new Error("the chosen card drew no Remove");
    await act(async () => remove.click());
    expect(manager.remove).toHaveBeenCalledWith(IMAGE.id);
  });

  it("opens the preview from a picture's card, and offers none for a font", async () => {
    const { host } = mount([IMAGE, FONT], {
      previewUrl: (assetId) =>
        assetId === IMAGE.id ? "blob:logo-preview" : undefined,
    });

    await selectCard(host, "logo.png");
    const preview = actionOf(host, "logo.png", uiCopy.panels.assetCard.preview);
    expect(preview?.disabled).toBe(false);
    await act(async () => {
      preview?.click();
      await drain();
    });

    // The pane owns the surface: pressing Preview opened it rather than
    // reporting to a second owner.
    expect(
      document.querySelector("[data-yunari-asset-preview-modal]"),
    ).not.toBeNull();
    await act(async () => {
      document
        .querySelector<HTMLButtonElement>(".editor-shell-dialog-close")
        ?.click();
      await drain();
    });
    expect(
      document.querySelector("[data-yunari-asset-preview-modal]"),
    ).toBeNull();

    // A face has no preview here: the finder owns its specimen.
    await selectCard(host, "body");
    expect(actionOf(host, "body", uiCopy.panels.assetCard.preview)).toBeNull();
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
const OTHER_FONT_FILE = file("Roboto-Light.ttf", "font/ttf", "ttf");
const VIDEO_FILE = file("clip.mp4", "video/mp4", "mp4");
const PACKAGE_FILE = file("night.mpkg", "application/octet-stream", "PKGM0014");

interface Harness {
  readonly host: HTMLElement;
  readonly manager: AssetManager;
  readonly importSpy: Mock;
  readonly importVideo: Mock;
  readonly placeImage: Mock;
  readonly replace: Mock;
  readonly hydrate: Mock;
  readonly remove: Mock;
  readonly saveState: Mock;
  readonly error: Mock;
  readonly changed: Mock;
  readonly onFindAssets: Mock;
  readonly onBackground: Mock;
  readonly fontCommit: Mock;
  /** Fires a canvas event at the handlers the pane registered, so a case can
   *  move the scene the way Fabric does. */
  readonly fire: (event: string) => void;
}

/** The file section over a real `AssetManager`, on an editor stub that answers
 *  only what the pane asks it: the canvas walk, the history and the errors. */
async function mountWithManager(
  isReferenced: (assetId: string) => boolean = () => false,
  objects: readonly unknown[] = [],
  withBackground = true,
  options: {
    readonly subscribeDocumentChange?: (listener: () => void) => () => void;
  } = {},
): Promise<Harness> {
  const host = document.createElement("div");
  document.body.append(host);
  inflight = [];
  const manager = new AssetManager();
  const placeImage = vi
    .spyOn(manager, "placeImage")
    .mockResolvedValue(undefined);
  const realImport = manager.import.bind(manager);
  const importSpy = vi
    .spyOn(manager, "import")
    .mockImplementation((chosen) => track(realImport(chosen)));
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
  /** The session's video route: the pane hands the pick over and declares
   *  nothing itself. */
  const importVideo = vi.fn(async () => ({ ok: true as const }));
  /** The canvas's own events, kept so a case can fire the ones Fabric fires. */
  const handlers = new Map<string, Set<() => void>>();
  const fire = (event: string): void => {
    for (const handler of handlers.get(event) ?? []) handler();
  };
  /** The session's own declaration, minus the document: a Cancel declares and
   *  a Create reports success, so a case can read what the pane asked for. */
  const fontCommit = vi.fn<FontCommit>(async (input: FontCommitInput) => {
    if (!input.withPreset && "file" in input.source) {
      await manager.importFont(input.source.file, input.metadata);
      return { ok: true, message: uiCopy.panels.assetDeclaredFont };
    }
    return { ok: true, message: "" };
  });
  const editor = {
    canvas: {
      // A fresh array per read: a caller that kept one render's answer must not
      // see a later object through it.
      getObjects: () => [...objects],
      requestRenderAll: vi.fn(),
      on: (event: string, handler: () => void) => {
        const set = handlers.get(event) ?? new Set<() => void>();
        set.add(handler);
        handlers.set(event, set);
      },
      off: (event: string, handler: () => void) => {
        handlers.get(event)?.delete(handler);
      },
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
        onFontCommit={fontCommit}
        onImportVideo={importVideo}
        {...(options.subscribeDocumentChange === undefined
          ? {}
          : { subscribeDocumentChange: options.subscribeDocumentChange })}
        {...(withBackground ? { onBackground } : {})}
      />,
    );
  });

  return {
    host,
    manager,
    importSpy,
    importVideo,
    placeImage,
    replace,
    hydrate,
    remove,
    saveState,
    error,
    changed,
    onFindAssets,
    onBackground,
    fontCommit,
    fire,
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

/** jsdom has no parser; a font's bytes are declared at the form's commit, so a
 *  case that needs a declared card stubs the loader. */
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

/** A font pick followed by Cancel — the route that declares without a preset. */
async function declareFont(host: HTMLElement): Promise<void> {
  await importFile(host, FONT_FILE);
  const cancel = host.querySelector<HTMLButtonElement>(
    "[data-yunari-font-cancel]",
  );
  if (cancel === null) throw new Error("no Cancel control.");
  await act(async () => {
    cancel.click();
    await drain();
  });
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
    const { host, manager, importVideo, placeImage, saveState } =
      await mountWithManager();

    await importFile(host, IMAGE_FILE);

    expect(manager.declarations.map((asset) => asset.id)).toEqual(["logo"]);
    expect(placeImage).toHaveBeenCalledTimes(1);
    expect(placeImage.mock.calls[0]?.[2]).toMatchObject({
      id: "logo",
      kind: "image",
    });
    expect(saveState).toHaveBeenCalledTimes(1);
    // A picture keeps the direct path: only a video-shaped pick opens the modal.
    expect(importVideo).not.toHaveBeenCalled();
    expect(alert(host).textContent).toBe(uiCopy.panels.assetPlaced);
  });

  it("offers a picked video's trim before handing it to the video import", async () => {
    const { host, importSpy, importVideo } = await mountWithManager();

    await importFile(host, VIDEO_FILE);

    const trim = document.querySelector("[data-yunari-video-trim-modal]");
    expect(trim).not.toBeNull();
    expect(importVideo).not.toHaveBeenCalled();
    expect(importSpy).not.toHaveBeenCalled();

    const whole = trim?.querySelector<HTMLButtonElement>(
      "[data-yunari-video-trim-whole]",
    );
    if (whole === null || whole === undefined)
      throw new Error("no whole-video control.");
    await act(async () => {
      whole.click();
    });

    expect(importVideo).toHaveBeenCalledTimes(1);
    expect(importVideo.mock.calls[0]?.[0]).toBe(VIDEO_FILE);
    expect(importVideo.mock.calls[0]?.[1]).toBe(false);
    expect(importVideo.mock.calls[0]?.[2]).toEqual(expect.any(Function));
    expect(importSpy).not.toHaveBeenCalled();
  });

  it("hands a picked .mpkg to the video import, flagged as a package", async () => {
    const { host, importSpy, importVideo } = await mountWithManager();

    await importFile(host, PACKAGE_FILE);

    expect(importVideo).toHaveBeenCalledTimes(1);
    expect(importVideo.mock.calls[0]?.[0]).toBe(PACKAGE_FILE);
    expect(importVideo.mock.calls[0]?.[1]).toBe(true);
    expect(importSpy).not.toHaveBeenCalled();
  });

  it("disables Import as background where no callback can set one", async () => {
    const { host } = await mountWithManager(() => false, [], false);
    // The same disabled treatment the cards' unwired actions get: a control
    // that offers a write the pane cannot perform stays off.
    const control = host.querySelector<HTMLButtonElement>(
      "[data-yunari-asset-import-background]",
    )!;
    expect(control.disabled).toBe(true);
  });

  it("opens the font details form on a pick and declares nothing yet", async () => {
    const { host, manager, placeImage, onBackground } =
      await mountWithManager();

    await importFile(host, FONT_FILE);

    // The pick is not a declaration: the form is where the author confirms the
    // metadata, and Cancel or Create type preset is what writes the file.
    expect(manager.declarations).toEqual([]);
    expect(placeImage).not.toHaveBeenCalled();
    expect(onBackground).not.toHaveBeenCalled();
    expect(host.querySelector("[data-yunari-font-details]")).not.toBeNull();
    expect(
      host.querySelector<HTMLInputElement>("[data-yunari-font-family]")?.value,
    ).toBe("body");
  });

  it("reports a cancelled pick to the commit, which keeps the file declared", async () => {
    // The stub commit declares the way the session does, so the assertion is
    // about the request the pane makes — one fresh file with no preset.
    stubFontParser();
    const { host, manager, fontCommit } = await mountWithManager();

    await importFile(host, FONT_FILE);
    expect(manager.declarations).toEqual([]);
    await act(async () => {
      host
        .querySelector<HTMLButtonElement>("[data-yunari-font-cancel]")!
        .click();
      await drain();
    });

    expect(fontCommit).toHaveBeenCalledWith({
      source: { file: FONT_FILE },
      metadata: {
        family: "body",
        weight: 400,
        style: "normal",
        licence: "unknown",
      },
      role: null,
      withPreset: false,
    });
    // The declaration is written in a promise chain `drain` cannot bound: on a
    // loaded CI runner the three turns it gives were not enough, and the case
    // read an empty list while the commit had already been made. Waiting for
    // the state is the assertion; the request above is the cause.
    await vi.waitFor(() =>
      expect(manager.declarations.map((asset) => asset.kind)).toEqual(["font"]),
    );
    expect(host.querySelector("[data-yunari-font-details]")).toBeNull();
    expect(cardOf(host, "body")).not.toBeNull();
  });

  it("re-prefills the form from a second pick", async () => {
    const { host } = await mountWithManager();

    await importFile(host, FONT_FILE);
    await importFile(host, OTHER_FONT_FILE);

    // The file under the form changed, so every field follows it — otherwise
    // Create would declare Roboto's bytes as the first file's family.
    expect(
      host.querySelector<HTMLInputElement>("[data-yunari-font-family]")?.value,
    ).toBe("Roboto");
    expect(
      host.querySelector<HTMLInputElement>("[data-yunari-font-weight]")?.value,
    ).toBe("300");
  });

  it("draws one card for a family's weights and removes them together", async () => {
    // Six weights imported from a finder are one font to the author; the
    // weight is a preset's choice, so six cards would bury the list.
    const face = (weight: number): LocalAssetReference => ({
      id: `manrope-${weight}`,
      kind: "font",
      path: `assets/manrope-${weight}.woff2`,
      family: "Manrope",
      weight,
      style: "normal",
      format: "woff2",
    });
    const { host, manager } = mount([face(400), face(700)]);

    const cards = [
      ...host.querySelectorAll<HTMLElement>("[data-yunari-asset-card]"),
    ];
    expect(cards).toHaveLength(1);
    expect(cards[0]?.textContent).toContain("Manrope");
    expect(cards[0]?.textContent).toContain("400 normal");
    expect(cards[0]?.textContent).toContain("700 normal");

    await selectCard(host, "Manrope");
    const remove = host.querySelector<HTMLElement>(
      "[data-yunari-asset-remove]",
    );
    if (remove === null) throw new Error("no remove control.");
    await act(async () =>
      remove.dispatchEvent(new MouseEvent("click", { bubbles: true })),
    );

    // Removing the family removes every face it holds, not the 400 alone.
    expect(manager.remove).toHaveBeenCalledWith("manrope-400");
    expect(manager.remove).toHaveBeenCalledWith("manrope-700");
  });

  it("opens the form on a declared face from the card's Create type preset", async () => {
    const { host } = await mount([
      {
        id: "heading",
        kind: "font",
        path: "assets/Manrope-Variable.woff2",
        family: "Manrope",
        weight: 700,
        style: "normal",
        format: "woff2",
      },
    ]);
    await selectCard(host, "heading");

    // The card names the family once and lists the faces it holds: the path
    // tail is the packaged id, which for a provider cut carries the source's
    // name.
    expect(cardOf(host, "heading")?.textContent).toContain("Manrope");
    expect(cardOf(host, "heading")?.textContent).toContain("700 normal");

    const open = cardOf(host, "heading")?.querySelector(
      "[data-yunari-font-open]",
    );
    if (open === null || open === undefined)
      throw new Error("no Create type preset control.");
    await act(async () =>
      open.dispatchEvent(new MouseEvent("click", { bubbles: true })),
    );

    expect(host.querySelector("[data-yunari-font-details]")).not.toBeNull();
    expect(
      host.querySelector<HTMLInputElement>("[data-yunari-font-family]")?.value,
    ).toBe("Manrope");
    expect(
      host.querySelector<HTMLInputElement>("[data-yunari-font-weight]")?.value,
    ).toBe("700");
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
    stubFontParser();
    const { host } = await mountWithManager();

    await declareFont(host);

    // Review Focus 5: the list is the declarations, not the placed objects —
    // which is what keeps a font imported once removable. The card is reached
    // by its **file name**, never by the id the package keys it by.
    expect(cardOf(host, "body")).not.toBeNull();
  });

  it("leaves the author's card alone when a second file is imported", async () => {
    const { host } = await mountWithManager();

    await importFile(host, IMAGE_FILE);
    expect(isChosen(host, "logo.png")).toBe(true);

    await importFile(host, FONT_FILE);
    // Parity with the section this replaces: adding a file never moved the
    // chosen card off the asset the author was pointing at.
    expect(isChosen(host, "logo.png")).toBe(true);
    expect(isChosen(host, "body")).toBe(false);
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

  it("flips a deleted object's asset to Unused, and removes it on a press", async () => {
    // The pane is mounted once and hidden, never unmounted, so a reachability
    // read taken at mount would still say In use after the object is gone.
    const image = new FabricImage(document.createElement("img"), {
      id: "image-1",
    });
    setObjectAssetReference(image, { assetId: "logo", kind: "image" });
    const objects: unknown[] = [image];
    const { host, remove, fire } = await mountWithManager(() => false, objects);

    await importFile(host, IMAGE_FILE);
    expect(badgeOf(host, "logo.png")).toBe(uiCopy.panels.assetCard.inUse);

    await act(async () => {
      objects.pop();
      fire("object:removed");
    });

    expect(badgeOf(host, "logo.png")).toBe(uiCopy.panels.assetCard.unused);
    await act(async () => removeControl(host).click());

    expect(remove).toHaveBeenCalledWith(IMAGE.id);
  });

  it("refuses a press made after an object re-references the asset", async () => {
    // No event is fired: the scene moved and the render did not. The press
    // must read the canvas itself rather than a render's object list.
    const image = new FabricImage(document.createElement("img"), {
      id: "image-1",
    });
    setObjectAssetReference(image, { assetId: "logo", kind: "image" });
    const objects: unknown[] = [];
    const { host, remove } = await mountWithManager(() => false, objects);

    await importFile(host, IMAGE_FILE);
    expect(badgeOf(host, "logo.png")).toBe(uiCopy.panels.assetCard.unused);

    objects.push(image);
    await act(async () => removeControl(host).click());

    expect(remove).not.toHaveBeenCalled();
    expect(alert(host).textContent).toBe(uiCopy.panels.assetReferenced);
  });

  it("re-reads reachability when the document announces a change", async () => {
    // A cleared background or an undone preset edit moves the envelope half of
    // reachability without touching a declaration, and the pane must follow it.
    let holds = true;
    let notify: () => void = () => {};
    const { host } = await mountWithManager(() => holds, [], true, {
      subscribeDocumentChange: (listener) => {
        notify = listener;
        return () => {};
      },
    });

    await importFile(host, IMAGE_FILE);
    expect(badgeOf(host, "logo.png")).toBe(uiCopy.panels.assetCard.inUse);

    holds = false;
    await act(async () => notify());

    expect(badgeOf(host, "logo.png")).toBe(uiCopy.panels.assetCard.unused);
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

  it("repaints when the manager's declarations move outside the pane", async () => {
    // A save's cleanup prunes without a press here; the cards follow because
    // the manager itself is the notifier.
    const { host, manager } = await mountWithManager();
    await importFile(host, IMAGE_FILE);
    expect(cardOf(host, "logo.png")).not.toBeNull();

    act(() => {
      manager.remove("logo");
    });

    expect(cardOf(host, "logo.png")).toBeNull();
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
    // drifting silently. The Replace picker takes that list alone: a `.mpkg` is
    // a container the import path intercepts, never a declared asset.
    expect(ACCEPT).not.toBe("");
    expect(importInput.accept).toBe(ACCEPT);
    expect(replaceInput.accept).toBe(ASSET_ACCEPT);
    expect(replaceInput.accept).not.toContain(".mpkg");

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
 * **The manual normalize control is gone.** Normalization is the modal's
 * business now: a pick runs the host once and declares what it answers with,
 * so the pane draws no button, no held copy and no confirmation for it.
 */
describe("the removed manual normalize control", () => {
  it("draws none for a declared video", async () => {
    const { host } = mount([VIDEO]);
    await selectCard(host, "clip.mp4");

    expect(host.querySelector("[data-yunari-asset-normalize]")).toBeNull();
    expect(host.querySelector("[data-yunari-asset-use-normalized]")).toBeNull();
  });
});

/** The file types both pickers offer: the manager's own exported list plus the
 *  `.mpkg` the pane intercepts before the manager sees it — derived here so an
 *  extension added to `TYPES` and not offered, or offered and not readable, is
 *  red. */
const ASSET_ACCEPT = ASSET_FILE_EXTENSIONS.map((ext) => `.${ext}`).join(",");
const ACCEPT = `${ASSET_ACCEPT},.mpkg`;
