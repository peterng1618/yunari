// @vitest-environment jsdom

/**
 * The asset preview: one surface for a picture and a video, opened through
 * `openModal`.
 *
 * **The layout is the target, but jsdom does not lay out.** The fourth case
 * asserts the classes that carry the fixed 270px panel and the unwrapped labels;
 * the measured geometry is the browser sweep's, not this test's.
 *
 * **A video is not an image with a different glyph.** It drops Place and draws
 * a player, and Background becomes its primary command.
 */
import { act } from "react";
import { afterEach, expect, it } from "vitest";
import { assetFileName } from "../../asset-manager/index.js";
import { uiCopy } from "../../ui-copy.js";
import {
  type AssetPreviewInput,
  openAssetPreview,
  type PlacedOrLocalAsset,
} from "./preview-modal.js";

// Base UI's dialog needs the three browser APIs jsdom has none of — the same
// shims `assets-pane.dom.test.tsx` supplies, for the same reason.
globalThis.ResizeObserver ??= class {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
} as never;
Element.prototype.getAnimations ??= (): never[] => [];
window.PointerEvent ??= MouseEvent as never;

// React only flushes work scheduled inside `act` when it has been told it is in
// a test.
(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const IMAGE: PlacedOrLocalAsset = {
  id: "studio",
  kind: "image",
  path: "assets/studio.png",
  license: { name: "CC BY 4.0" },
};
const VIDEO: PlacedOrLocalAsset = {
  id: "clip",
  kind: "video",
  path: "assets/clip.mp4",
};

/** The default input, with a case overriding only what it is about. */
function inputFor(
  asset: PlacedOrLocalAsset,
  overrides: Partial<AssetPreviewInput> = {},
): AssetPreviewInput {
  return {
    asset,
    credit: undefined,
    previewUrl: asset.kind === "video" ? "blob:clip" : "blob:studio",
    inUse: false,
    sizeBytes: 840 * 1024,
    onRemove: async () => {},
    onReplace: () => {},
    onBackground: () => {},
    onPlace: () => {},
    onClose: () => {},
    ...overrides,
  };
}

/** Opens the surface and returns the body it drew. */
async function open(
  asset: PlacedOrLocalAsset,
  overrides: Partial<AssetPreviewInput> = {},
): Promise<HTMLElement> {
  await act(async () => {
    void openAssetPreview(inputFor(asset, overrides));
    await flush();
  });
  const modal = document.querySelector<HTMLElement>(
    "[data-yunari-asset-preview-modal]",
  );
  if (modal === null) throw new Error("the preview drew no surface");
  return modal;
}

/** React and Base UI schedule outside `act`, so a popup is flushed with
 *  macrotasks rather than one. */
async function flush(): Promise<void> {
  for (let round = 0; round < 3; round += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

/** The action ids the foot drew, in the order it drew them. */
function actionIds(modal: HTMLElement): readonly (string | null)[] {
  return [...modal.querySelectorAll("[data-yunari-asset-preview-action]")].map(
    (button) => button.getAttribute("data-yunari-asset-preview-action"),
  );
}

afterEach(async () => {
  const close = document.querySelector<HTMLButtonElement>(
    ".editor-shell-dialog-close",
  );
  if (close !== null) {
    await act(async () => {
      close.click();
      await flush();
    });
  }
  document.body.replaceChildren();
});

it("draws the stage and a 270px right panel", async () => {
  const modal = await open(IMAGE);

  expect(
    modal.querySelector("[data-yunari-asset-preview-stage]"),
  ).not.toBeNull();
  const panel = modal.querySelector<HTMLElement>(
    "[data-yunari-asset-preview-panel]",
  );
  // jsdom computes no width; the class carries the 270px token.
  expect(panel?.className).toContain("w-[var(--asset-preview-panel-width)]");
  expect(modal.closest(".editor-shell-dialog")?.className).toContain(
    "editor-shell-dialog--asset-preview",
  );

  expect(modal.textContent).toContain(assetFileName(IMAGE));
  expect(
    modal.querySelector("[data-yunari-asset-preview-caption]"),
  ).not.toBeNull();
  expect(
    modal.querySelector("[data-yunari-asset-preview-group='file']"),
  ).toBeNull();
  expect(
    modal.querySelector("[data-yunari-asset-preview-group='attribution']"),
  ).not.toBeNull();
  // A long name wraps instead of being cut with an ellipsis.
  const heading = [...modal.querySelectorAll("span")].find(
    (candidate) => candidate.textContent === assetFileName(IMAGE),
  );
  expect(heading?.className).toContain("break-words");
  expect(heading?.className).not.toContain("truncate");
});

it("draws no redundant file or usage prose", async () => {
  const modal = await open(IMAGE);

  expect(modal.textContent).not.toContain("Local file");
  expect(modal.textContent).not.toContain(
    "No object, background or type token",
  );
  expect(modal.textContent).not.toContain("Recycle Bin");
});

it("offers Remove, Replace, Background and Place for an image", async () => {
  const modal = await open(IMAGE);

  expect(actionIds(modal)).toEqual([
    "remove",
    "replace",
    "background",
    "place",
  ]);
  expect(
    [...modal.querySelectorAll("[data-yunari-asset-preview-action]")].map(
      (button) => button.textContent,
    ),
  ).toEqual([
    uiCopy.panels.assetCard.remove,
    uiCopy.panels.assetCard.replace,
    uiCopy.assets.preview.background,
    uiCopy.assets.preview.place,
  ]);
});

it("drops Place and draws a player for a video", async () => {
  const modal = await open(VIDEO);

  expect(actionIds(modal)).toEqual(["remove", "replace", "background"]);
  expect(actionIds(modal)).not.toContain("place");

  const player = modal.querySelector<HTMLVideoElement>(
    "[data-yunari-asset-preview-player]",
  );
  expect(player).not.toBeNull();
  expect(player?.controls).toBe(true);
  expect(player?.muted).toBe(true);
  expect(player?.loop).toBe(true);
  // Background is the video's primary: its box takes the accent rather than a
  // filled ground, the same treatment the pane's primary import wears.
  expect(
    modal.querySelector<HTMLElement>(
      "[data-yunari-asset-preview-action='background']",
    )?.className,
  ).toContain("border-accent");
  // Remove carries the destructive mark, which `ActionBox` now owns.
  expect(
    modal
      .querySelector<HTMLElement>("[data-yunari-asset-preview-action='remove']")
      ?.hasAttribute("data-yunari-destructive"),
  ).toBe(true);
});

it("reads a Wallpaper Engine video's licence and source, never None recorded", async () => {
  const workshopUrl =
    "https://steamcommunity.com/sharedfiles/filedetails/?id=202";
  const modal = await open({
    ...VIDEO,
    license: { name: "unknown" },
    sourceUrl: workshopUrl,
  });

  expect(modal.textContent).toContain("unknown");
  expect(modal.textContent).toContain(workshopUrl);
  expect(modal.textContent).not.toContain(uiCopy.assets.preview.noneRecorded);
});

it("reads the package credit's licence and author, never None recorded", async () => {
  // A finder image's declaration has no author, and its licence may be absent
  // too; the credit is the only member that knows who made it.
  const modal = await open(
    { id: "studio", kind: "image", path: "assets/studio.png" },
    {
      credit: {
        kind: "image",
        title: "studio",
        author: { name: "Jane Doe" },
        license: "CC BY 4.0",
        changes: "Imported unchanged",
        assetId: "studio",
      },
    },
  );

  expect(modal.textContent).toContain("CC BY 4.0");
  expect(modal.textContent).toContain("Jane Doe");
  expect(modal.textContent).not.toContain(uiCopy.assets.preview.noneRecorded);
});

it("draws Place as an image's one primary command", async () => {
  const modal = await open(IMAGE);

  // A picture has exactly one canvas write, so its Place box is the accent one
  // — and its Background is the secondary.
  expect(
    modal.querySelector<HTMLElement>(
      "[data-yunari-asset-preview-action='place']",
    )?.className,
  ).toContain("border-accent");
  expect(
    modal.querySelector<HTMLElement>(
      "[data-yunari-asset-preview-action='background']",
    )?.className,
  ).not.toContain("border-accent");
  // Remove carries the destructive mark, which `ActionBox` now owns.
  expect(
    modal
      .querySelector<HTMLElement>("[data-yunari-asset-preview-action='remove']")
      ?.hasAttribute("data-yunari-destructive"),
  ).toBe(true);
});

it("disables Remove for a referenced asset and points at the reason", async () => {
  const modal = await open(IMAGE, { inUse: true });

  expect(
    modal.querySelector<HTMLSpanElement>("#asset-preview-usage")?.textContent,
  ).toBe(uiCopy.assets.preview.usedBySome);
  const remove = modal.querySelector<HTMLButtonElement>(
    "[data-yunari-asset-preview-action='remove']",
  );
  expect(remove?.disabled).toBe(true);
  expect(remove?.getAttribute("aria-describedby")).toBe("asset-preview-usage");
});

it("leaves Remove enabled and unannotated for an unused asset", async () => {
  const modal = await open(IMAGE);

  const remove = modal.querySelector<HTMLButtonElement>(
    "[data-yunari-asset-preview-action='remove']",
  );
  expect(remove?.disabled).toBe(false);
  expect(remove?.hasAttribute("aria-describedby")).toBe(false);
});

it("reports a command to the pane and closes", async () => {
  // The modal writes nothing itself: Remove is the pane's closure, and the
  // surface settles so the caller can release what it minted.
  let removed = 0;
  let closed = 0;
  const modal = await open(IMAGE, {
    onRemove: async () => {
      removed += 1;
    },
    onClose: () => {
      closed += 1;
    },
  });

  const remove = modal.querySelector<HTMLButtonElement>(
    "[data-yunari-asset-preview-action='remove']",
  );
  expect(remove).not.toBeNull();
  await act(async () => {
    remove?.click();
    await flush();
  });

  expect(removed).toBe(1);
  expect(closed).toBe(1);
  expect(
    document.querySelector("[data-yunari-asset-preview-modal]"),
  ).toBeNull();
});

it("keeps every action label on one line at the fixed panel width", async () => {
  const modal = await open(IMAGE);

  const panel = modal.querySelector<HTMLElement>(
    "[data-yunari-asset-preview-panel]",
  );
  expect(panel?.className).toContain("w-[var(--asset-preview-panel-width)]");
  const labels = [
    ...modal.querySelectorAll("[data-yunari-asset-preview-action] span"),
  ];
  expect(labels).toHaveLength(4);
  for (const label of labels) {
    expect(label.className).toContain("whitespace-nowrap");
  }
  // The geometry itself — scrollWidth <= clientWidth at a laid-out width — is
  // the browser sweep's assertion; jsdom has no layout to measure.
});
