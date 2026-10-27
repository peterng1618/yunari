import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
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

const EDITOR = process.env.YUNARI_EDITOR_URL ?? "http://127.0.0.1:4174/";

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

/**
 * The picker path, measured in a browser: an `.mpkg` pick opens the one modal,
 * which runs the host's single package call and closes on success.
 *
 * The route is answered here because this preview serves no host; the package
 * buffer is the shape an author's export has, and the video in the answer is
 * the suite's conforming fixture.
 */
const PKGM = Buffer.concat([Buffer.from("PKGM0014"), Buffer.from("night")]);
const CONFORMING_MP4 = readFileSync(
  fileURLToPath(
    new URL(
      "../../packages/theme-package/test-fixtures/conforming.mp4",
      import.meta.url,
    ),
  ),
);

test("imports a picked .mpkg through the modal and declares its video", async ({
  page,
}, testInfo) => {
  test.skip(!isDesktopSurface(testInfo), "the editor is a desktop surface");
  await page.goto(EDITOR);
  await openPane(page, "Assets");

  let packageCalls = 0;
  let normalizeCalls = 0;
  await page.route("**/api/wallpaper-engine/mpkg", async (route) => {
    packageCalls += 1;
    // Held, so the running sentence is observable before the surface closes.
    await new Promise((resolve) => setTimeout(resolve, 500));
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        videoBase64: CONFORMING_MP4.toString("base64"),
        reencoded: false,
        title: "Night street",
        workshopId: "202",
      }),
    });
  });
  await page.route("**/api/themes/normalize-video", async (route) => {
    normalizeCalls += 1;
    await route.fulfill({ status: 500, body: "" });
  });

  await page.locator("[data-yunari-asset-import-input]").setInputFiles({
    name: "night.mpkg",
    mimeType: "application/octet-stream",
    buffer: PKGM,
  });

  const modal = page.locator("[data-yunari-import-video-modal]");
  await expect(modal).toBeVisible();
  await expect(modal).toContainText(uiCopy.panels.importVideo.preparingPackage);
  await expect(modal).toBeHidden();

  // The host extracts and normalizes in the one call, never a second route.
  expect(packageCalls).toBe(1);
  expect(normalizeCalls).toBe(0);
  // The package's title is the credit's; the declaration is named through the
  // manager's own file-name derivation, which slugs the space.
  await expect(
    page.locator('[data-yunari-panel="assets"] li', {
      hasText: "Night-street.mp4",
    }),
  ).toBeVisible();
});

test("keeps the modal open with the package refusal and declares nothing", async ({
  page,
}, testInfo) => {
  test.skip(!isDesktopSurface(testInfo), "the editor is a desktop surface");
  await page.goto(EDITOR);
  await openPane(page, "Assets");

  const sentence = "No video in this package.";
  await page.route("**/api/wallpaper-engine/mpkg", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: false, message: sentence }),
    });
  });

  await page.locator("[data-yunari-asset-import-input]").setInputFiles({
    name: "night.mpkg",
    mimeType: "application/octet-stream",
    buffer: PKGM,
  });

  const modal = page.locator("[data-yunari-import-video-modal]");
  await expect(modal).toBeVisible();
  await expect(modal).toContainText(sentence);
  // The editor opens a starter document with its own picture; this import adds
  // nothing beside it.
  await expect(
    page.locator('[data-yunari-panel="assets"] li', {
      hasText: "Night-street.mp4",
    }),
  ).toHaveCount(0);
});
