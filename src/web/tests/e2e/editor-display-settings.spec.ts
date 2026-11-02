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
    // A typed ratio keeps its own spelling, and its portrait twin is derived:
    // `21:9` stays `21:9`, with `9:21` beside it. One row, one token.
    expect(await ratioRows(page)).toContain("21:9");
    await closeSettings(page);
    const added = await displayMenuItems(page);
    expect(added).toContain("21:9");
    expect(added).toContain("9:21");

    await openSettings(page, uiCopy.settings.previews);
    // `7:3` is the same rect shape as the listed `21:9`, so it would add no
    // lens: it is refused, the reason names both tokens, and nothing is stored.
    await addRatio(page, "7:3");
    await expect(
      page.locator("[data-yunari-preview-ratio-reason]"),
      "the refusal names both tokens",
    ).toHaveText(uiCopy.settings.previewRatioEquivalent("7:3", "21:9"));
    expect(await ratioRows(page), "a refused ratio is not added").not.toContain(
      "7:3",
    );

    await removeRatio(page, "21:9");
    expect(
      await ratioRows(page),
      "removing the row removes its token once",
    ).not.toContain("21:9");
    await addRatio(page, "21:9");
    await resetRatios(page);
    expect(await ratioRows(page)).toEqual([
      "19.5:9",
      "16:9",
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
    expect(reset).not.toContain("21:9");
  });

  test("an empty catalogue leaves no lens to choose", async ({ page }) => {
    await openSettings(page, uiCopy.settings.previews);
    await resetRatios(page);
    for (const row of await ratioRows(page)) await removeRatio(page, row);
    await closeSettings(page);

    expect(
      await displayMenuItems(page),
      "the camera commands are not lenses, so they are not in the radio group",
    ).toEqual([]);
    await expect(
      page.locator(SCREEN),
      "there is no screen to draw around a display nobody offers",
    ).toBeHidden();
  });
});
