// @vitest-environment jsdom

/**
 * The Assets pane: the declared files, grouped by kind, one card each.
 *
 * **The list is the declarations, not the placed objects.** A font or a video is
 * declared only, so a list built from the canvas would lose them — the cases
 * here mount declarations that no object holds and still expect a card.
 *
 * **In use is the scene's reference OR the envelope's.** The envelope-side
 * references are the artboard's background media and a type preset's face, which
 * no Fabric object carries; `isReferenced` is how the pane hears them, and it is
 * optional so the pane mounts where there is no envelope to ask.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  AssetManager,
  LocalAssetReference,
} from "../../asset-manager/index.js";
import type { EditorInteraction } from "../../editor-interaction.js";
import { uiCopy } from "../../ui-copy.js";
import { AssetsPane } from "./assets-pane.js";

// React only flushes work scheduled inside `act` when it has been told it is in
// a test; without this, `act` warns and the update lands after the assertion.
(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

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
 *  what the pane is given. */
function managerStub(
  declarations: readonly LocalAssetReference[],
): AssetManager {
  return {
    declarations,
    assets: {},
    previewUrl: () => undefined,
    placeImage: vi.fn(),
    replace: vi.fn(),
    hydrate: vi.fn(),
    remove: vi.fn(),
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
});

function mount(
  declarations: readonly LocalAssetReference[],
  isReferenced?: (assetId: string) => boolean,
): HTMLElement {
  const host = document.createElement("div");
  document.body.append(host);
  const mounted = createRoot(host);
  root = mounted;
  act(() =>
    mounted.render(
      <AssetsPane
        manager={managerStub(declarations)}
        editor={editorStub()}
        {...(isReferenced === undefined ? {} : { isReferenced })}
      />,
    ),
  );
  return host;
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

/** Points the pane at one asset, the way a press on its row does. */
async function choose(host: HTMLElement, name: string): Promise<void> {
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
    const host = mount([IMAGE, OTHER_IMAGE, FONT]);

    // The mockup's order: Fonts, then Images. The font is declared even though
    // no object can hold it, which is the list-is-declarations rule.
    expect(headings(host)).toEqual([
      uiCopy.assets.category.font,
      uiCopy.assets.category.image,
    ]);

    await choose(host, "photo.jpg");

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
    const host = mount([FONT]);

    expect(badgeOf(host, "body.woff2")).toBe(uiCopy.panels.assetCard.unused);

    await choose(host, "body.woff2");
    expect(actionNames(host, "body.woff2")).toContain(
      uiCopy.panels.assetCard.createTypePreset,
    );
  });

  it("badges an asset In use when only the envelope references it", () => {
    // No object holds `logo`; the envelope-side reference is the artboard's
    // background media or a preset's face, and the pane has to hear it.
    const host = mount([IMAGE], (assetId) => assetId === IMAGE.id);

    expect(badgeOf(host, "logo.png")).toBe(uiCopy.panels.assetCard.inUse);
  });
});
