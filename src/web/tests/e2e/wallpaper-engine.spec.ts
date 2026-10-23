import { expect, type Page, test } from "@playwright/test";
import { captureVisualReview } from "./editor-canvas.js";
import { isDesktopSurface } from "./surface.js";

/**
 * The Wallpaper Engine library at the browser boundary.
 *
 * The host is routed, not real: the listing and the item routes are fixtures,
 * so the proof is the finder body's own behaviour — the action each kind gets,
 * and the export sheet each kind of scene is guided through. The real library,
 * its count and its unpack are driven from Node (`task-9-report.md`), because
 * a browser test cannot read this PC's Steam install without either launching
 * Wallpaper Engine or asserting a count that moves.
 */

const EDITOR = "http://127.0.0.1:4174/";

const wallpaperEngine = {
  id: "wallpaper-engine",
  label: "Wallpaper Engine",
  category: "local",
  body: "wallpaper-engine",
  requires: null,
  configurable: false,
  host: null,
} as const;

/** Six rows, one per kind the finder must draw differently. `203` carries no
 *  `hasText` at all: an unclassified scene is never read as text-free. */
const items = [
  {
    workshopId: "101",
    title: "Neon Still",
    kind: "image",
    previewUrl: "/api/wallpaper-engine/item/101/preview",
    filesize: 2048,
    tags: [],
  },
  {
    workshopId: "102",
    title: "Rain Loop",
    kind: "video",
    previewUrl: "/api/wallpaper-engine/item/102/preview",
    filesize: 5_000_000,
    tags: [],
  },
  {
    workshopId: "103",
    title: "Clock Page",
    kind: "web",
    previewUrl: "/api/wallpaper-engine/item/103/preview",
    filesize: 1024,
    tags: [],
  },
  {
    workshopId: "201",
    title: "Still With Clock",
    kind: "scene",
    previewUrl: "/api/wallpaper-engine/item/201/preview",
    filesize: 4096,
    tags: [],
    stillAtRest: true,
    hasText: true,
  },
  {
    workshopId: "202",
    title: "Moving Scene",
    kind: "scene",
    previewUrl: "/api/wallpaper-engine/item/202/preview",
    filesize: 8192,
    tags: [],
    stillAtRest: false,
    hasText: false,
  },
  {
    workshopId: "203",
    title: "Unclassified Scene",
    kind: "scene",
    previewUrl: "/api/wallpaper-engine/item/203/preview",
    filesize: 4096,
    tags: [],
  },
];

/** A 1×1 transparent PNG, so a routed row's preview is a picture and the
 *  capture shows a box rather than a broken-image icon. */
const PREVIEW_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

async function stubLibrary(page: Page): Promise<void> {
  // The base listing is routed last: Playwright matches the most recently
  // registered handler first, and the item routes share its prefix.
  await page.route("**/api/wallpaper-engine/item/*/preview", (route) =>
    route.fulfill({ body: PREVIEW_PNG, contentType: "image/png" }),
  );
  await page.route("**/api/wallpaper-engine/exports*", (route) =>
    route.fulfill({ json: { files: [] } }),
  );
  await page.route("**/api/wallpaper-engine", (route) =>
    route.fulfill({ json: { available: true, items, skipped: 0 } }),
  );
  await page.route("**/api/assets/sources", (route) =>
    route.fulfill({ json: { sources: [wallpaperEngine] } }),
  );
}

async function openLibrary(page: Page): Promise<void> {
  await page.goto(EDITOR);
  await page.waitForFunction(() => "yunariEditorBridge" in window);
  await page.keyboard.press("Control+Shift+F");
  const dialog = page.getByRole("dialog", { name: "Assets" });
  await expect(dialog).toBeVisible();
  await page.locator('[data-yunari-asset-tab="local"]').click();
  await expect(page.locator("[data-yunari-wallpaper-engine-item]")).toHaveCount(
    items.length,
  );
}

function row(page: Page, id: string) {
  return page.locator(`[data-yunari-wallpaper-engine-item="${id}"]`);
}

async function openSheet(page: Page, id: string): Promise<void> {
  await openLibrary(page);
  await row(page, id).locator("[data-yunari-wallpaper-engine-open]").click();
  await expect(page.locator("[data-yunari-export-sheet]")).toBeVisible();
}

test("each kind of wallpaper row offers the action it can actually take", async ({
  page,
}, testInfo) => {
  test.skip(!isDesktopSurface(testInfo), "the editor is a desktop surface");

  await stubLibrary(page);
  await openLibrary(page);

  // A picture and a video are both one file, so both are imported as they are.
  for (const id of ["101", "102"]) {
    await expect(
      row(page, id).locator("[data-yunari-wallpaper-engine-import]"),
    ).toBeVisible();
  }

  // Web wallpapers are a page: the row states the refusal and offers no import.
  const web = row(page, "103");
  await expect(
    web.locator("[data-yunari-wallpaper-engine-import]"),
  ).toHaveCount(0);
  await expect(web).toContainText(
    "A web wallpaper is a page, not a file Yunari can put in a theme.",
  );

  // A scene cannot be imported until it has been exported, so it opens the
  // sheet instead of offering the import the other kinds offer.
  for (const id of ["201", "202", "203"]) {
    await expect(
      row(page, id).locator("[data-yunari-wallpaper-engine-open]"),
    ).toBeVisible();
    await expect(
      row(page, id).locator("[data-yunari-wallpaper-engine-import]"),
    ).toHaveCount(0);
  }
});

test("captures the finder on Wallpaper Engine", async ({ page }, testInfo) => {
  test.skip(!isDesktopSurface(testInfo), "the editor is a desktop surface");

  await stubLibrary(page);
  await openLibrary(page);
  await expect(row(page, "201")).toContainText("Scene");
  await expect(row(page, "101")).toContainText("Image");

  await captureVisualReview(page, testInfo, "editor-finder-wallpaper-engine");
});

test("captures a still scene's export sheet", async ({ page }, testInfo) => {
  test.skip(!isDesktopSurface(testInfo), "the editor is a desktop surface");

  await stubLibrary(page);
  await openSheet(page, "201");
  const sheet = page.locator("[data-yunari-export-sheet]");

  // A still scene is one frame: PNG, no clip, no frame rate.
  await expect(page.locator("[data-yunari-export-format-name]")).toHaveText(
    "PNG",
  );
  await expect(page.locator("[data-yunari-export-duration]")).toHaveCount(0);
  await expect(page.locator("[data-yunari-export-fps]")).toHaveCount(0);
  // The text step is the instruction this scene needs, and it comes first.
  await expect(page.locator("[data-yunari-export-text-step]")).toContainText(
    "Delete the clock and any other dynamic text",
  );
  await expect(sheet).toContainText(
    "The unpack leaves a project in Wallpaper Engine's own project list.",
  );

  await captureVisualReview(page, testInfo, "editor-finder-scene-still");
});

test("captures an animated scene's export sheet", async ({
  page,
}, testInfo) => {
  test.skip(!isDesktopSurface(testInfo), "the editor is a desktop surface");

  await stubLibrary(page);
  await openSheet(page, "202");

  await expect(page.locator("[data-yunari-export-format-name]")).toHaveText(
    "MP4",
  );
  await expect(page.locator("[data-yunari-export-fps]")).toHaveText("30 fps");
  await expect(page.locator("[data-yunari-export-duration]")).toHaveText("5 s");
  await expect(page.locator("[data-yunari-export-blend]")).toHaveText("1 s");
  // This scene is classified as holding no text, so the step is not offered.
  await expect(page.locator("[data-yunari-export-text-step]")).toHaveCount(0);

  await captureVisualReview(page, testInfo, "editor-finder-scene-animated");
});

test("an unclassified scene gets no text step rather than a guessed one", async ({
  page,
}, testInfo) => {
  test.skip(!isDesktopSurface(testInfo), "the editor is a desktop surface");

  await stubLibrary(page);
  await openSheet(page, "203");

  // The listing said nothing about text; the sheet must not read that as
  // "no text" and must not print the instruction either.
  await expect(page.locator("[data-yunari-export-text-step]")).toHaveCount(0);
  await expect(page.locator("[data-yunari-export-format-name]")).toHaveText(
    "MP4",
  );
});
