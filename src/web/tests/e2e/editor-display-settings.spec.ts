import { expect, test } from "@playwright/test";
import { uiCopy } from "../../packages/editor/src/ui-copy.js";
import { openDisplayStage } from "./editor-display-entry.js";
import {
  addRatio,
  closeSettings,
  displayMenuItems,
  openSettings,
  ratioRows,
  removeRatio,
  resetRatios,
  SCREEN,
} from "./editor-stage.js";

/**
 * The display catalogue the menu offers: the ratio rows settings can add,
 * remove and reset, and what the menu does when that catalogue is empty.
 *
 * The stage's framing and lens drawing are the sibling display specs; this one
 * only owns the values the product lets an author put in the menu.
 */

test.describe("the stage looks through a display", () => {
  test.beforeEach(async ({ page }) => {
    await openDisplayStage(page);
  });

  test("settings add, remove and reset ratios", async ({ page }) => {
    await openSettings(page, uiCopy.settings.previews);
    await addRatio(page, "21:9");
    // `21:9` enters as `7:3`, whose portrait twin is `3:7`. One row, one token.
    expect(await ratioRows(page)).toContain("7:3");
    await closeSettings(page);
    const added = await displayMenuItems(page);
    expect(added).toContain("7:3");
    expect(added).toContain("3:7");

    await openSettings(page, uiCopy.settings.previews);
    await removeRatio(page, "7:3");
    expect(
      await ratioRows(page),
      "removing the row removes its token once",
    ).not.toContain("7:3");
    await addRatio(page, "21:9");
    await resetRatios(page);
    expect(await ratioRows(page)).toEqual([
      "16:9",
      "19.5:9",
      "4:3",
      "1:1",
      "Circle",
    ]);
    await closeSettings(page);

    const reset = await displayMenuItems(page);
    for (const label of [
      "16:9",
      "19.5:9",
      "4:3",
      "1:1",
      "Circle",
      "9:16",
      "9:19.5",
      "3:4",
    ]) {
      expect(reset).toContain(label);
    }
    expect(reset).not.toContain("7:3");
  });

  test("an empty catalogue leaves Fit as the only menu entry", async ({
    page,
  }) => {
    await openSettings(page, uiCopy.settings.previews);
    await resetRatios(page);
    for (const row of await ratioRows(page)) await removeRatio(page, row);
    await closeSettings(page);

    expect(await displayMenuItems(page)).toEqual([uiCopy.display.fit]);
    await expect(
      page.locator(SCREEN),
      "there is no screen to draw around a display nobody offers",
    ).toBeHidden();
  });
});
