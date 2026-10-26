import { expect, type Locator, type Page, test } from "@playwright/test";
import { uiCopy } from "../../packages/editor/src/ui-copy.js";
import { chooseAssetFile } from "./editor-canvas.js";
import { chooseAssetCard, openPane } from "./editor-rail.js";
import { isDesktopSurface } from "./surface.js";

/**
 * The asset preview, measured in a browser.
 *
 * The unit suite proves the modal's classes and attributes, but jsdom lays
 * nothing out: a stylesheet regression in the box, the panel's fixed width or
 * the foot's one accent verb would pass every gate. This reads the drawing's
 * numbers off the rendered product instead.
 *
 * **The same 20×20 PNG `editor.spec.ts` imports**, and for the same reason: a
 * truncated fixture is rejected by `libpng`, and a preview with no decodable
 * image has no `naturalWidth` to caption.
 */

const EDITOR = "http://127.0.0.1:4174/";

const LOGO = {
  name: "logo.png",
  mimeType: "image/png",
  buffer: Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAABQAAAAUCAYAAACNiR0NAAAABmJLR0QA/wD/AP+gvaeTAAAAIklEQVQ4jWNk2HHzPwMVARM1DRs1cNTAUQNHDRw1cCgZCAC1HQK4IWYK+QAAAABJRU5ErkJggg==",
    "base64",
  ),
};

const MODAL = "[data-yunari-asset-preview-modal]";

/** The chosen card's row: its action buttons are siblings of the choose
 *  button `assetCard` names, not children of it. Matched on the `<li>`, which
 *  holds both, because a button's own text is the card's, not the row's. */
function cardRow(page: Page, fileName: string): Locator {
  return page.locator('[data-yunari-panel="assets"] li', {
    hasText: fileName,
  });
}

/** Imports `logo.png`, chooses its card and leaves the pane showing. **The pane
 *  is opened first, because an author opens it first** — a control behind a
 *  closed pane is not one a person can press. */
async function importLogo(page: Page): Promise<void> {
  await page.goto(EDITOR);
  await openPane(page, "Assets");
  await chooseAssetFile(page, "import", LOGO);
  await chooseAssetCard(page, "logo.png");
}

test("opens the preview at the Finder's box and gives an image one primary verb", async ({
  page,
}, testInfo) => {
  test.skip(!isDesktopSurface(testInfo), "the editor is a desktop surface");
  await importLogo(page);
  // **The card's own control, never the hidden input**: the preview must be
  // reachable the way an author reaches it.
  await cardRow(page, "logo.png")
    .getByRole("button", {
      name: uiCopy.panels.assetCard.preview,
      exact: true,
    })
    .click();

  const modal = page.locator(MODAL);
  await expect(modal).toBeVisible();

  // The viewer's box: the finder's inset-24 rule, capped by the drawing's own
  // 1132 and 852. Measured on the dialog popup, not the flex body inside it —
  // the popup owns the drawing's width and height, and its 1px border twice is
  // why the body reads 1130 inside a 1132 box. The height's subtraction is
  // written here so a changed dialog rule cannot pass by matching itself.
  const viewport = page.viewportSize() ?? { width: 1280, height: 720 };
  const box = await modal.evaluate((element) => {
    const popup = element.closest(".editor-shell-dialog");
    if (popup === null) throw new Error("the preview drew no dialog box");
    const rect = popup.getBoundingClientRect();
    return { width: rect.width, height: rect.height };
  });
  const panelWidth = await modal
    .locator("[data-yunari-asset-preview-panel]")
    .evaluate((element) => element.getBoundingClientRect().width);
  const expectedHeight = Math.min(852, viewport.height - 48);

  const image = modal.locator("[data-yunari-asset-preview-image]");
  await expect(image).toBeVisible();
  const caption = modal.locator("[data-yunari-asset-preview-caption]");
  await expect(caption).toHaveText("20 × 20 · fit");

  const reading = `asset-preview box ${box.width}x${box.height}px panel ${panelWidth}px viewport ${viewport.width}x${viewport.height} caption "${(await caption.textContent()) ?? ""}"`;
  console.log(reading);
  testInfo.annotations.push({ type: "asset-preview", description: reading });

  expect(
    box.width,
    `the box is not the width the drawing fixes (${reading})`,
  ).toBe(1132);
  expect(box.height, `the box is not the inset-24 cap (${reading})`).toBe(
    expectedHeight,
  );
  expect(panelWidth, `the panel is not the drawing's 270px (${reading})`).toBe(
    270,
  );

  // One primary verb: a picture's Place box takes the accent and its
  // Background does not.
  const place = modal.locator('[data-yunari-asset-preview-action="place"]');
  const background = modal.locator(
    '[data-yunari-asset-preview-action="background"]',
  );
  await expect(place).toHaveClass(/border-accent/);
  await expect(background).not.toHaveClass(/border-accent/);

  await page.locator(".editor-shell-dialog-close").click();
  await expect(modal).toBeHidden();
  await expect(page.locator('[data-yunari-panel="assets"]')).toBeVisible();
});

test("disables Remove once the canvas holds the file", async ({
  page,
}, testInfo) => {
  test.skip(!isDesktopSurface(testInfo), "the editor is a desktop surface");
  await importLogo(page);
  const row = cardRow(page, "logo.png");
  // The pane's own place control, so the canvas holds the file by the route
  // an author takes.
  await row
    .getByRole("button", {
      name: uiCopy.assets.placeOnCanvas,
      exact: true,
    })
    .click();
  await expect(row.locator("[data-yunari-asset-badge]")).toHaveText(
    uiCopy.panels.assetCard.inUse,
  );

  await row
    .getByRole("button", {
      name: uiCopy.panels.assetCard.preview,
      exact: true,
    })
    .click();
  const modal = page.locator(MODAL);
  await expect(modal).toBeVisible();

  const remove = modal.locator('[data-yunari-asset-preview-action="remove"]');
  await expect(remove).toBeDisabled();
  await expect(remove).toHaveAttribute(
    "aria-describedby",
    "asset-preview-usage",
  );
  const describedBy = await remove.getAttribute("aria-describedby");
  if (describedBy === null) throw new Error("Remove gives no reason element");
  await expect(modal.locator(`[id="${describedBy}"]`)).toHaveText(
    uiCopy.assets.preview.usedBySome,
  );
  await expect(modal.locator("[data-yunari-asset-preview-badge]")).toHaveText(
    uiCopy.panels.assetCard.inUse,
  );
});
