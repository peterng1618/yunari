import { expect, test } from "@playwright/test";
import { isDesktopSurface } from "./surface.js";

/**
 * The URL's say in which surface opens, on the real editor.
 *
 * The host's tray opens the editor's existing surfaces by opening a URL, so the
 * query has to reach the shell at mount. `shell-entry.test.ts` pins the parse;
 * this pins that the parsed answer is what the shell actually opens on — the
 * mode region, the publish popup, and the editor body when the URL names
 * nothing or something unknown.
 */

const EDITOR = "http://127.0.0.1:4174/";

/**
 * **No case may reach the host or the public catalogue.**
 *
 * The preview server answers neither route, and the store region's online read
 * would otherwise ask the network. A 404 on `**\/index.json` is the honest
 * "there is no catalogue here", as `editor-rail.spec.ts` establishes — an empty
 * catalogue would be a fact the read did not answer.
 *
 * `/api/hosting` is stubbed because a build with no host behind it answers
 * nothing, which makes the header's publish control render no control at all —
 * the popup would then be absent for a reason this task is not about. The stub
 * is the host's shape with the LAN off, so the control exists and opens.
 *
 * `/api/themes` is stubbed empty for the same reason at the store's local half;
 * the store case reads only the mode region, so the empty catalogue changes
 * nothing it asserts.
 */
test.beforeEach(async ({ page }) => {
  await page.route("**/index.json", (route) =>
    route.fulfill({
      status: 404,
      headers: { "access-control-allow-origin": "*" },
    }),
  );
  await page.route("**/api/themes", (route) =>
    route.fulfill({ json: { themes: [] } }),
  );
  await page.route("**/api/hosting", (route) =>
    route.fulfill({
      json: { lan: false, address: null, port: null, refusal: null },
    }),
  );
});

test("opens the store from the URL", async ({ page }, testInfo) => {
  test.skip(!isDesktopSurface(testInfo), "the editor is a desktop surface");
  await page.goto(`${EDITOR}?mode=themes`);
  await expect(page.locator("[data-yunari-mode-region]")).toHaveAttribute(
    "data-yunari-mode-region",
    "themes",
  );
});

test("opens Host Settings from the URL", async ({ page }, testInfo) => {
  test.skip(!isDesktopSurface(testInfo), "the editor is a desktop surface");
  await page.goto(`${EDITOR}?mode=this-pc`);
  await expect(page.locator("[data-yunari-mode-region]")).toHaveAttribute(
    "data-yunari-mode-region",
    "this-pc",
  );
});

test("opens the publish surface from the URL", async ({ page }, testInfo) => {
  test.skip(!isDesktopSurface(testInfo), "the editor is a desktop surface");
  await page.goto(`${EDITOR}?publish=1`);
  await expect(page.locator(".editor-shell-publish-popup")).toBeVisible();
});

// Themes mode draws no publish control at all, so this proves the surface is
// absent, not that `publish` was refused; shell-entry.test.ts pins the rule.
test("draws no publish surface in a non-editor mode", async ({
  page,
}, testInfo) => {
  test.skip(!isDesktopSurface(testInfo), "the editor is a desktop surface");
  await page.goto(`${EDITOR}?mode=themes&publish=1`);
  await expect(page.locator(".editor-shell-publish-popup")).toHaveCount(0);
});

test("ignores an unknown mode", async ({ page }, testInfo) => {
  test.skip(!isDesktopSurface(testInfo), "the editor is a desktop surface");
  await page.goto(`${EDITOR}?mode=bogus`);
  await expect(page.locator("[data-yunari-mode-region]")).toHaveCount(0);
  await expect(page.locator(".editor-shell-body")).toBeVisible();
});
