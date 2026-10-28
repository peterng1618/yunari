import { expect, type Page, test } from "@playwright/test";
import { captureVisualReview } from "./editor-canvas.js";
import { isDesktopSurface } from "./surface.js";

/**
 * The Wallpaper Engine library at the browser boundary.
 *
 * The host is routed, not real: the listing and the project route are fixtures,
 * so the proof is the finder body's own behaviour — the card each kind gets, the
 * action it offers, the guide, and the one status line. The real library, its
 * count and its unpack are driven from Node, because a browser test cannot read
 * this PC's Steam install without either launching Wallpaper Engine or
 * asserting a count that moves.
 */

const EDITOR = process.env["YUNARI_EDITOR_URL"] ?? "http://127.0.0.1:4174/";

const wallpaperEngine = {
  id: "wallpaper-engine",
  label: "Wallpaper Engine",
  category: "local",
  body: "wallpaper-engine",
  requires: null,
  configurable: false,
  presetKind: null,
  host: null,
} as const;

/** Four cards, one per kind-and-text combination the finder must draw
 *  differently. `203` carries no `hasText` at all: an unclassified scene is
 *  never read as text-free. */
const items = [
  {
    workshopId: "102",
    title: "Rain Loop",
    kind: "video",
    previewUrl: "/api/wallpaper-engine/item/102/preview",
    filesize: 5_000_000,
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

/** A 1×1 transparent PNG, so a routed card's preview is a picture and the
 *  capture shows a preview box rather than a broken-image icon. */
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
  await page.route("**/api/wallpaper-engine/item/*/project", (route) =>
    route.fulfill({ json: { ok: true, name: "201", reused: false } }),
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
  await expect(page.locator("[data-yunari-finder-card]")).toHaveCount(
    items.length,
  );
}

function card(page: Page, id: string) {
  return page.locator(`[data-yunari-finder-card="${id}"]`);
}

/** The pane's one action is the footer's, so choosing a card is what makes it
 *  name that card's own write. */
async function actionOf(
  page: Page,
  id: string,
): Promise<ReturnType<Page["locator"]>> {
  await card(page, id).click();
  return page.locator("[data-yunari-asset-action]");
}

test("each card offers the action it can actually take, and the kind filters narrow the grid", async ({
  page,
}, testInfo) => {
  test.skip(!isDesktopSurface(testInfo), "the editor is a desktop surface");

  await stubLibrary(page);
  await openLibrary(page);

  await expect(await actionOf(page, "102")).toHaveText("Set as background");
  for (const id of ["201", "202", "203"]) {
    await expect(await actionOf(page, id)).toHaveText(
      "Convert to local project",
    );
  }

  await page
    .locator('[data-yunari-wallpaper-engine-kind-filter="video"]')
    .click();
  await expect(page.locator("[data-yunari-finder-card]")).toHaveCount(1);

  await page
    .locator('[data-yunari-wallpaper-engine-kind-filter="scene"]')
    .click();
  await expect(page.locator("[data-yunari-finder-card]")).toHaveCount(3);

  await page
    .locator('[data-yunari-wallpaper-engine-kind-filter="all"]')
    .click();
  await expect(page.locator("[data-yunari-finder-card]")).toHaveCount(
    items.length,
  );
});

test("opens the guide with the convert use case and the export steps", async ({
  page,
}, testInfo) => {
  test.skip(!isDesktopSurface(testInfo), "the editor is a desktop surface");

  await stubLibrary(page);
  await openLibrary(page);
  await page.locator("[data-yunari-wallpaper-engine-guide]").click();

  const guide = page.locator("[data-yunari-wallpaper-engine-guide-dialog]");
  await expect(guide).toBeVisible();
  await expect(guide).toContainText("Why convert to a local project");
  await expect(guide).toContainText("Send to Mobile Device");
  await expect(guide).toContainText("Export .mpkg");
  await expect(guide).toContainText("Keep original aspect ratio");
  await expect(guide).toContainText("Import a .mpkg video");
});

test("reports a converted scene on the status line", async ({
  page,
}, testInfo) => {
  test.skip(!isDesktopSurface(testInfo), "the editor is a desktop surface");

  await stubLibrary(page);
  await openLibrary(page);
  await expect(page.locator("[data-yunari-asset-status]")).toHaveText("");

  await (await actionOf(page, "201")).click();

  await expect(
    card(page, "201").locator("[data-yunari-finder-card-done]"),
  ).toBeVisible();
  await expect(page.locator("[data-yunari-asset-status]")).toContainText("201");
  await expect(page.locator("[data-yunari-asset-status]")).toContainText(
    "My Projects",
  );
});

test("captures the finder on Wallpaper Engine", async ({ page }, testInfo) => {
  test.skip(!isDesktopSurface(testInfo), "the editor is a desktop surface");

  await stubLibrary(page);
  await openLibrary(page);
  await expect(card(page, "201")).toContainText("Scene");
  await expect(card(page, "102")).toContainText("Video");

  await captureVisualReview(
    page,
    testInfo,
    "editor-finder-wallpaper-engine",
    page.locator("[data-yunari-asset-grid]"),
  );
});
