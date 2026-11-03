import { test } from "@playwright/test";
import { writeThemePackage } from "@yunari/theme-package";
import { GLASS_ENVELOPE, glassStripesPng } from "./glass-fixture.js";
import { assertBlur, assertMediaOffset, readGlass } from "./glass-probe.js";
import { openThemeFromStore, storedThemeOfPackage } from "./store-library.js";

const EDITOR = "http://127.0.0.1:4174/?mode=editor";

/**
 * Frosted glass in the real editor: the interactive `Canvas` mount, through the
 * editor's own file-open path, rendering the authored scene
 * `host-glass.spec.ts` also drives.
 *
 * This is where the media can load at all. The host cannot serve a packaged
 * asset to the player - its asset route and the player's asset resolver disagree
 * about the `assets/` prefix, so a hosted theme's media 404s (recorded in
 * [issue #3](https://github.com/peterng1618/yunari/issues/3); the two owners are
 * outside this task). So the blur and the media-offset claims are proved here, on the
 * mount that can load the media.
 *
 * The foreground-text half is not measured: this container has no usable font
 * and renders "FROST" as a placeholder dash, so it is Task 11's, where font work
 * is already in scope.
 */
test.describe("frosted glass in the editor", () => {
  test("composites the backdrop under its panel, at the right place in the media", async ({
    page,
  }, testInfo) => {
    test.skip(
      testInfo.project.name !== "desktop-chromium",
      "the editor is a desktop surface",
    );
    const fixture = writeThemePackage({
      envelope: GLASS_ENVELOPE,
      assets: { "assets/stripes.png": glassStripesPng() },
    });
    if (!fixture.ok)
      throw new Error(`the glass fixture is invalid: ${fixture.message}`);

    await page.goto(EDITOR);
    await openThemeFromStore(page, storedThemeOfPackage(fixture.bytes));

    const reading = await readGlass(page);
    assertBlur(reading, "editor");
    assertMediaOffset(reading, "editor");
  });
});
